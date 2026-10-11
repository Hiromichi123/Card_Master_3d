export const WORLD_TASKS_PER_FRAME=2;
export const WORLD_FRAME_BUDGET_MS=4;
export const WORLD_TILES_PER_BATCH=4;
export const WORLD_RECORDS_PER_BATCH=256;

interface FrameDriver {
  readonly now:()=>number;
  readonly request:(callback:FrameRequestCallback)=>number;
  readonly cancel:(id:number)=>void;
}
interface PendingTask {readonly run:()=>void}

/** One budget shared by every scatter and landscape layer, not one budget per component. */
export function createWorldTaskScheduler(driver:FrameDriver){
  const queue:PendingTask[]=[],idle:PendingTask[]=[];
  let frame:number|null=null,pausedUntil=0,emptyFrames=0;
  const request=():void=>{if(frame===null&&(queue.length||idle.length))frame=driver.request(tick);};
  const stopEmptyFrame=():void=>{
    if(!queue.length&&!idle.length&&frame!==null){driver.cancel(frame);frame=null;}
  };
  const tick=():void=>{
    frame=null;
    if(!queue.length){
      if(++emptyFrames>=2){
        const ready=idle.slice();
        for(const callback of ready){
          if(queue.length)break;
          const index=idle.indexOf(callback);if(index<0)continue;
          idle.splice(index,1);callback.run();
        }
      }
      request();return;
    }
    emptyFrames=0;
    if(driver.now()<pausedUntil){request();return;}
    const started=driver.now(),eligible=queue.slice(0,WORLD_TASKS_PER_FRAME);
    try{
      for(const task of eligible){
        if(driver.now()-started>=WORLD_FRAME_BUDGET_MS||driver.now()<pausedUntil)break;
        const index=queue.indexOf(task);if(index<0)continue;
        queue.splice(index,1);task.run();
      }
    }finally{request();}
  };
  return {
    schedule(task:()=>void):()=>void {
      const pending:PendingTask={run:task};queue.push(pending);emptyFrames=0;request();
      return ()=>{
        const index=queue.indexOf(pending);if(index>=0)queue.splice(index,1);
        stopEmptyFrame();
      };
    },
    whenIdle(callback:()=>void):()=>void {
      const pending:PendingTask={run:callback};idle.push(pending);emptyFrames=0;request();
      return ()=>{
        const index=idle.indexOf(pending);if(index>=0)idle.splice(index,1);
        stopEmptyFrame();
      };
    },
    pause(ms=150):void {pausedUntil=Math.max(pausedUntil,driver.now()+Math.max(0,ms));},
  };
}

const shared=createWorldTaskScheduler({
  now:()=>performance.now(),request:callback=>requestAnimationFrame(callback),cancel:id=>cancelAnimationFrame(id),
});
export const scheduleWorldTask=shared.schedule;
export const pauseWorldLoading=shared.pause;
/** Wait for two empty frames so layout effects can enqueue the next upload batch. */
export const whenWorldLoadingIdle=shared.whenIdle;

export interface WorldTile<T> {readonly key:string;readonly records:readonly T[]}
/** Split dense spatial tiles before mounting so a single layout effect cannot upload thousands. */
export function splitWorldTiles<T>(groups:Iterable<readonly [string,readonly T[]]>):readonly WorldTile<T>[] {
  const tiles:WorldTile<T>[]=[];
  for(const [key,records] of groups)for(let start=0;start<records.length;start+=WORLD_RECORDS_PER_BATCH){
    tiles.push({key:`${key}:${start/WORLD_RECORDS_PER_BATCH}`,records:records.slice(start,start+WORLD_RECORDS_PER_BATCH)});
  }
  return tiles;
}
/** Both mesh count and instance count are bounded for every reveal. */
export function nextWorldTileBatch<T>(tiles:readonly WorldTile<T>[],start:number):number {
  let end=start,records=0;
  while(end<tiles.length&&end-start<WORLD_TILES_PER_BATCH){
    const count=tiles[end]!.records.length;
    if(records+count>WORLD_RECORDS_PER_BATCH)break;
    records+=count;end++;
  }
  return end;
}
