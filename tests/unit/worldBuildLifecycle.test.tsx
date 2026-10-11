// @vitest-environment jsdom
import { act } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { GeometryData,WorldBuildMessage,WorldBuildPart,WorldBuildRequest } from '../../src/rendering/campaign/worldBuildProtocol';
import { useWorldBuild } from '../../src/rendering/campaign/useWorldBuild';

const scheduled=vi.hoisted(()=>({
  tasks:[] as {run:()=>void;cancelled:boolean}[],
  idle:[] as {run:()=>void;cancelled:boolean}[],
}));
vi.mock('../../src/rendering/campaign/worldLoadScheduler',()=>({
  scheduleWorldTask:(run:()=>void)=>{
    const job={run,cancelled:false};scheduled.tasks.push(job);return()=>{job.cancelled=true;};
  },
  whenWorldLoadingIdle:(run:()=>void)=>{
    const job={run,cancelled:false};scheduled.idle.push(job);return()=>{job.cancelled=true;};
  },
}));
vi.mock('../../src/rendering/campaign/worldIslands',()=>({installShoreField:vi.fn()}));

class FakeWorker {
  static instances:FakeWorker[]=[];
  onmessage:((event:MessageEvent<WorldBuildMessage>)=>void)|null=null;
  onerror:(()=>void)|null=null;
  onmessageerror:(()=>void)|null=null;
  readonly postMessage=vi.fn<(request:WorldBuildRequest)=>void>();
  readonly terminate=vi.fn<()=>void>();
  constructor(){FakeWorker.instances.push(this);}
  get request():WorldBuildRequest {return this.postMessage.mock.calls[0]![0];}
  emit(part:WorldBuildPart,generation=this.request.generation):void {
    this.onmessage?.({data:{...part,generation}} as MessageEvent<WorldBuildMessage>);
  }
}
const rock={position:[1,2,3] as const,scale:[1,1,1] as const,color:'#889988'};
let root:Root|null=null,host:HTMLDivElement;
let latest:ReturnType<typeof useWorldBuild>;
const onStatus=vi.fn<(status:string)=>void>();
function Harness({detail,retry=0}:{readonly detail:number;readonly retry?:number}){
  latest=useWorldBuild(detail,retry,onStatus);return null;
}
async function render(detail:number,retry=0):Promise<void> {
  await act(async()=>{root!.render(<Harness detail={detail} retry={retry}/>);});
}
async function flushTasks(includeCancelled=false):Promise<void> {
  await act(async()=>{
    while(scheduled.tasks.length){const job=scheduled.tasks.shift()!;if(includeCancelled||!job.cancelled)job.run();}
  });
}
async function flushIdle(includeCancelled=false):Promise<void> {
  await act(async()=>{
    while(scheduled.idle.length){const job=scheduled.idle.shift()!;if(includeCancelled||!job.cancelled)job.run();}
  });
}

beforeEach(()=>{
  scheduled.tasks.length=0;scheduled.idle.length=0;FakeWorker.instances=[];onStatus.mockClear();
  vi.stubGlobal('Worker',FakeWorker);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(async()=>{
  if(root)await act(async()=>root!.unmount());
  root=null;host.remove();vi.unstubAllGlobals();
});

describe('世界地图后台构建生命周期',()=>{
  it('魔域合并几何排队挂载，换代释放全部自有网格且丢弃旧消息',async()=>{
    await render(44);
    const worker=FakeWorker.instances[0]!;
    const geometry=():GeometryData=>({attributes:{position:{array:new Float32Array([0,0,0,1,0,0,0,0,1]),itemSize:3}},index:new Uint32Array([0,2,1])});
    const part:WorldBuildPart={kind:'demon',demon:{stone:geometry(),trim:geometry(),glow:geometry(),abyss:geometry()}};
    worker.emit(part);expect(latest.demon).toBeUndefined();
    await flushTasks();
    expect(latest.demon).toBeDefined();
    const owned=Object.values(latest.demon!),disposed=owned.map(mesh=>vi.spyOn(mesh,'dispose'));
    expect(new Set(owned).size).toBe(4);
    await render(45);
    expect(disposed.every(spy=>spy.mock.calls.length===1)).toBe(true);
    expect(latest.demon).toBeUndefined();
    worker.emit(part);await flushTasks(true);
    expect(latest.demon).toBeUndefined();
  });

  it('卸载终止worker并取消挂载任务，迟到消息和已经取出的回调无效',async()=>{
    await render(18);
    const worker=FakeWorker.instances[0]!;
    worker.emit({kind:'props',props:{rocks:[rock]}});
    const tasks=[...scheduled.tasks];
    await act(async()=>root!.unmount());root=null;
    expect(worker.terminate).toHaveBeenCalled();
    expect(tasks.every(task=>task.cancelled)).toBe(true);
    onStatus.mockClear();
    worker.emit({kind:'done'});
    await flushTasks(true);await flushIdle(true);
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('切换画质不接受旧generation，旧worker结果及旧队列均不能污染新场景',async()=>{
    await render(28);
    const previous=FakeWorker.instances[0]!;
    previous.emit({kind:'props',props:{rocks:[rock]}});
    await render(40);
    const current=FakeWorker.instances[1]!;
    expect(previous.terminate).toHaveBeenCalled();
    expect(current.request.generation).not.toBe(previous.request.generation);
    expect(latest.detail).toBe(40);expect(latest.props.rocks).toHaveLength(0);
    previous.emit({kind:'props',props:{rocks:[rock]}});
    current.emit({kind:'props',props:{rocks:[rock]}},previous.request.generation);
    await flushTasks(true);
    expect(latest.props.rocks).toHaveLength(0);
    current.emit({kind:'props',props:{rocks:[rock]}});
    await flushTasks();
    expect(latest.props.rocks).toEqual([rock]);
  });

  it('失败状态不被此前排队的完成通知或迟到的成功消息覆盖，重试创建新任务',async()=>{
    await render(41);
    const worker=FakeWorker.instances[0]!;
    worker.emit({kind:'done'});
    await flushTasks();
    expect(scheduled.idle.length).toBeGreaterThan(0);
    worker.onerror?.();
    expect(onStatus).toHaveBeenLastCalledWith('地图可操作 · 未能补齐细节，可重试');
    worker.emit({kind:'props',props:{rocks:[rock]}});
    await flushTasks();await flushIdle();
    expect(onStatus).toHaveBeenLastCalledWith('地图可操作 · 未能补齐细节，可重试');
    await render(41,1);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1]!.request.generation).not.toBe(worker.request.generation);
    expect(onStatus).toHaveBeenLastCalledWith('地图可操作 · 正在生成地形');
  });

  it('失败前排队的数据仍可展示，但不能把失败提示改回加载中',async()=>{
    await render(43);
    const worker=FakeWorker.instances[0]!;
    worker.emit({kind:'props',props:{rocks:[rock]}});
    worker.onerror?.();
    await flushTasks();
    expect(latest.props.rocks).toEqual([rock]);
    expect(onStatus).toHaveBeenLastCalledWith('地图可操作 · 未能补齐细节，可重试');
  });

  it('成功完成后同画质重进复用CPU缓存，不重复创建worker，仍分批挂载',async()=>{
    await render(42);
    const worker=FakeWorker.instances[0]!;
    worker.emit({kind:'props',props:{rocks:[rock]}});worker.emit({kind:'done'});
    await flushTasks();await flushIdle();
    expect(latest.props.rocks).toEqual([rock]);
    expect(onStatus).toHaveBeenLastCalledWith('地图细节已就绪');
    await act(async()=>root!.unmount());
    root=createRoot(host);
    await render(42);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(latest.props.rocks).toHaveLength(0);
    expect(scheduled.tasks.length).toBeGreaterThan(0);
    await flushTasks();await flushIdle();
    expect(latest.props.rocks).toEqual([rock]);
    expect(latest.atmosphere).toBe(true);
    expect(onStatus).toHaveBeenLastCalledWith('地图细节已就绪');
  });
});
