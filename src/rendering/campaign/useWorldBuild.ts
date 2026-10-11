import { useEffect,useRef,useState } from 'react';
import type { BufferGeometry } from 'three';
import type { CentralTreeGeometry } from './centralTreeGeometry';
import type { DemonGeometry } from './demonGeometry';
import type { WorldProps } from './worldGeometry';
import { installShoreField } from './worldIslands';
import { emptyWorldProps,unpackGeometry,type WorldBuildMessage,type WorldBuildPart } from './worldBuildProtocol';
import { scheduleWorldTask,whenWorldLoadingIdle } from './worldLoadScheduler';

interface BuiltWorld {
  readonly detail:number;readonly retry:number;
  readonly terrain?:BufferGeometry;readonly sea?:BufferGeometry;
  readonly tree?:CentralTreeGeometry;readonly demon?:DemonGeometry;readonly props:WorldProps;
  readonly landmarks:boolean;readonly atmosphere:boolean;
}
let generation=0;
// CPU payloads only. Scene instances own their GPU geometry; keep at most one quality.
let cached:{detail:number;parts:readonly WorldBuildPart[]}|null=null;
export function useWorldBuild(detail:number,retry:number,onStatus:(status:string)=>void):BuiltWorld {
  const [world,setWorld]=useState<BuiltWorld>(()=>({detail,retry,props:emptyWorldProps(),landmarks:false,atmosphere:false}));
  const status=useRef(onStatus);status.current=onStatus;
  const active=useRef({id:0,failed:false,live:false});
  useEffect(()=>{
    let live=true,failed=false,worker:Worker|undefined;
    const id=++generation,cancels:(()=>void)[]=[],owned:BufferGeometry[]=[],received:WorldBuildPart[]=[];
    const token={id,failed:false,live:true};active.current=token;
    const update=(patch:Partial<BuiltWorld>):void=>{if(live)setWorld(previous=>({...previous,...patch}));};
    setWorld({detail,retry,props:emptyWorldProps(),landmarks:false,atmosphere:false});
    status.current('地图可操作 · 正在生成地形');
    const report=(message:string):void=>{if(live&&!failed)status.current(message);};
    const fail=():void=>{failed=true;token.failed=true;cached=null;if(live)status.current('地图可操作 · 未能补齐细节，可重试');worker?.terminate();};
    const accept=(part:WorldBuildPart):void=>{
      if(!live)return;
      cancels.push(scheduleWorldTask(()=>{
        if(!live)return;
        if(part.kind==='shore')installShoreField(part);
        else if(part.kind==='terrain'){
          const terrain=unpackGeometry(part.terrain),sea=unpackGeometry(part.sea);owned.push(terrain,sea);
          update({terrain,sea});report('地图可操作 · 正在补充地标');
        }else if(part.kind==='demon'){
          const demon={stone:unpackGeometry(part.demon.stone),trim:unpackGeometry(part.demon.trim),glow:unpackGeometry(part.demon.glow),abyss:unpackGeometry(part.demon.abyss)};
          owned.push(...Object.values(demon));update({demon});
        }else if(part.kind==='tree'){
          const wood=unpackGeometry(part.tree.wood),lights=unpackGeometry(part.tree.lights);
          if(lights.boundingSphere)lights.boundingSphere.radius+=1.1;
          owned.push(wood,lights);update({tree:{wood,lights,leaves:[...part.tree.leaves]}});
        }else if(part.kind==='props'){
          setWorld(previous=>({...previous,props:{...previous.props,...part.props}}));
          report('地图可操作 · 正在补充植被与景观');
        }else if(part.kind==='done'){
          update({atmosphere:true});
          // Readiness is subscribed from the committed atmosphere state below.
        }else fail();
      }));
    };
    // At least one painted base frame precedes the first decorative mount.
    cancels.push(scheduleWorldTask(()=>update({landmarks:true})));
    if(cached?.detail===detail&&retry===0)for(const part of cached.parts)accept(part);
    else {
      cached=null;
      try{
        worker=new Worker(new URL('./worldBuild.worker.ts',import.meta.url),{type:'module'});
        worker.onmessage=({data}:MessageEvent<WorldBuildMessage>)=>{
          if(!live||failed||data.generation!==id)return;
          if(data.kind==='error'){fail();return;}
          received.push(data);accept(data);
          if(data.kind==='done'){cached={detail,parts:received};worker?.terminate();}
        };
        worker.onerror=fail;worker.onmessageerror=fail;
        worker.postMessage({generation:id,detail});
      }catch{fail();}
    }
    return()=>{live=false;token.live=false;worker?.terminate();cancels.forEach(cancel=>cancel());owned.forEach(geometry=>geometry.dispose());};
  },[detail,retry]);
  useEffect(()=>{
    if(world.detail!==detail||world.retry!==retry||!world.atmosphere)return;
    const token=active.current;
    return whenWorldLoadingIdle(()=>{if(token.live&&!token.failed&&active.current===token)status.current('地图细节已就绪');});
  },[world.detail,world.retry,world.atmosphere,detail,retry]);
  return world.detail===detail&&world.retry===retry?world:{detail,retry,props:emptyWorldProps(),landmarks:false,atmosphere:false};
}
