import { describe,expect,it } from 'vitest';
import {
  createWorldTaskScheduler,nextWorldTileBatch,splitWorldTiles,WORLD_FRAME_BUDGET_MS,
  WORLD_RECORDS_PER_BATCH,WORLD_TASKS_PER_FRAME,WORLD_TILES_PER_BATCH,
} from '../../src/rendering/campaign/worldLoadScheduler';

function fakeFrames(){
  let time=0,id=0;
  const frames=new Map<number,FrameRequestCallback>(),cancelled:number[]=[];
  const driver={now:()=>time,request:(callback:FrameRequestCallback)=>{frames.set(++id,callback);return id;},
    cancel:(frame:number)=>{cancelled.push(frame);frames.delete(frame);}};
  return {driver,frames,cancelled,advance:(ms:number)=>{time+=ms;},
    step:()=>{const ready=[...frames.values()];frames.clear();ready.forEach(callback=>callback(time));}};
}

describe('地图共享帧预算',()=>{
  it('所有来源共用每帧两个任务，空队列不请求帧',()=>{
    const clock=fakeFrames(),scheduler=createWorldTaskScheduler(clock.driver),done:string[]=[];
    expect(clock.frames.size).toBe(0);
    for(const key of ['forest','grass','buildings','clouds','tree'])scheduler.schedule(()=>done.push(key));
    expect(clock.frames.size).toBe(1);
    clock.step();expect(done).toEqual(['forest','grass']);
    expect(done).toHaveLength(WORLD_TASKS_PER_FRAME);
    clock.step();expect(done).toEqual(['forest','grass','buildings','clouds']);
    clock.step();expect(done).toEqual(['forest','grass','buildings','clouds','tree']);
    expect(clock.frames.size).toBe(0);
  });

  it('达到四毫秒预算就把剩余任务留到下一帧',()=>{
    const clock=fakeFrames(),scheduler=createWorldTaskScheduler(clock.driver),done:number[]=[];
    scheduler.schedule(()=>{done.push(1);clock.advance(WORLD_FRAME_BUDGET_MS);});
    scheduler.schedule(()=>done.push(2));
    clock.step();expect(done).toEqual([1]);
    clock.step();expect(done).toEqual([1,2]);
  });

  it('任务中新增的任务不在同一帧执行',()=>{
    const clock=fakeFrames(),scheduler=createWorldTaskScheduler(clock.driver),done:number[]=[];
    scheduler.schedule(()=>{done.push(1);scheduler.schedule(()=>done.push(2));});
    clock.step();expect(done).toEqual([1]);
    expect(clock.frames.size).toBe(1);
    clock.step();expect(done).toEqual([1,2]);
  });

  it('卸载取消最后任务同时取消预约帧，重复取消无副作用',()=>{
    const clock=fakeFrames(),scheduler=createWorldTaskScheduler(clock.driver),done:number[]=[];
    const cancel=scheduler.schedule(()=>done.push(1));
    cancel();cancel();
    expect(clock.frames.size).toBe(0);
    expect(clock.cancelled).toHaveLength(1);
    clock.step();expect(done).toEqual([]);
    scheduler.schedule(()=>done.push(2));clock.step();expect(done).toEqual([2]);
  });

  it('前一任务取消同帧候选后不会执行失效任务',()=>{
    const clock=fakeFrames(),scheduler=createWorldTaskScheduler(clock.driver),done:number[]=[];
    let cancel=():void=>{};
    scheduler.schedule(()=>{done.push(1);cancel();});
    cancel=scheduler.schedule(()=>done.push(2));
    clock.step();expect(done).toEqual([1]);expect(clock.frames.size).toBe(0);
  });

  it('拖拽暂停加载且后续较短暂停不缩短已有等待',()=>{
    const clock=fakeFrames(),scheduler=createWorldTaskScheduler(clock.driver),done:number[]=[];
    scheduler.pause();scheduler.schedule(()=>done.push(1));
    clock.step();expect(done).toEqual([]);
    clock.advance(50);scheduler.pause(20);
    clock.advance(99);clock.step();expect(done).toEqual([]);
    clock.advance(1);clock.step();expect(done).toEqual([1]);
    expect(clock.frames.size).toBe(0);
  });

  it('空队列连续两帧才通知就绪，中途补交批次重新计时',()=>{
    const clock=fakeFrames(),scheduler=createWorldTaskScheduler(clock.driver),done:string[]=[];
    scheduler.schedule(()=>done.push('first'));
    scheduler.whenIdle(()=>done.push('idle'));
    clock.step();expect(done).toEqual(['first']);
    clock.step();expect(done).toEqual(['first']);
    scheduler.schedule(()=>done.push('second'));
    clock.step();expect(done).toEqual(['first','second']);
    clock.step();expect(done).toEqual(['first','second']);
    clock.step();expect(done).toEqual(['first','second','idle']);
    expect(clock.frames.size).toBe(0);
  });

  it('尚未执行的就绪通知可取消，且不遗留空帧循环',()=>{
    const clock=fakeFrames(),scheduler=createWorldTaskScheduler(clock.driver),done:string[]=[];
    const cancel=scheduler.whenIdle(()=>done.push('idle'));
    clock.step();expect(done).toEqual([]);
    cancel();expect(clock.frames.size).toBe(0);
    clock.step();expect(done).toEqual([]);
  });

  it('暂停期间取消最后任务仍会停止帧循环',()=>{
    const clock=fakeFrames(),scheduler=createWorldTaskScheduler(clock.driver);
    scheduler.pause();const cancel=scheduler.schedule(()=>{});
    clock.step();expect(clock.frames.size).toBe(1);
    cancel();expect(clock.frames.size).toBe(0);
  });
});

describe('地图实例上传批次',()=>{
  it('密集空间块拆成至多256条记录，并保留全部实例与唯一键',()=>{
    const records=Array.from({length:1000},(_,id)=>({id}));
    const tiles=splitWorldTiles([['0:0',records]]);
    expect(tiles.map(tile=>tile.records.length)).toEqual([256,256,256,232]);
    expect(tiles.flatMap(tile=>tile.records)).toEqual(records);
    expect(tiles[0]!.records[0]).toBe(records[0]);
    expect(new Set(tiles.map(tile=>tile.key)).size).toBe(tiles.length);
  });

  it('每次揭示同时受四块和256实例上限约束',()=>{
    const groups=Array.from({length:19},(_,index)=>[String(index),Array.from({length:20+index*23},(_,i)=>i)] as const);
    const tiles=splitWorldTiles(groups);
    let start=0;
    while(start<tiles.length){
      const end=nextWorldTileBatch(tiles,start),batch=tiles.slice(start,end);
      expect(end).toBeGreaterThan(start);
      expect(batch.length).toBeLessThanOrEqual(WORLD_TILES_PER_BATCH);
      expect(batch.reduce((sum,tile)=>sum+tile.records.length,0)).toBeLessThanOrEqual(WORLD_RECORDS_PER_BATCH);
      start=end;
    }
    expect(start).toBe(tiles.length);
    expect(nextWorldTileBatch(tiles,start)).toBe(start);
  });

  it('空记录不产生空网格，小块也不会一次挂载超过四个',()=>{
    expect(splitWorldTiles([['empty',[]]])).toEqual([]);
    const tiles=splitWorldTiles(Array.from({length:10},(_,i)=>[String(i),[i]] as const));
    expect(nextWorldTileBatch(tiles,0)).toBe(4);
    expect(nextWorldTileBatch(tiles,4)).toBe(8);
    expect(nextWorldTileBatch(tiles,8)).toBe(10);
  });
});
