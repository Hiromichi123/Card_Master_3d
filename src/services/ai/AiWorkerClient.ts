import { quickDecision } from '../../domain/battle/ai/search';
import type { AiDecision, AiRequest } from '../../domain/battle/ai/types';

export interface AiDriver {
  decide: (request:AiRequest)=>Promise<AiDecision>;
  cancel: ()=>void;
  dispose: ()=>void;
}
interface Pending { id:number; reject:(reason:Error)=>void; timer:ReturnType<typeof setTimeout> }
/** One worker per live battle. Cancellation terminates work, it does not just hide its result. */
export class AiWorkerClient implements AiDriver {
  private worker:Worker|null=null;
  private pending:Pending|null=null;
  private serial=0;
  decide(request:AiRequest):Promise<AiDecision> {
    if(this.pending)this.cancel();
    if(typeof Worker==='undefined')return Promise.resolve(quickDecision(request,'Worker 不可用，快速规则回退'));
    return new Promise((resolve,reject)=>{
      const id=++this.serial;
      const fail=(reason:string)=>{
        if(this.pending?.id!==id)return;
        clearTimeout(this.pending.timer);this.pending=null;this.worker?.terminate();this.worker=null;
        try {resolve(quickDecision(request,reason));}catch(error){reject(error);}
      };
      this.pending={id,reject,timer:setTimeout(()=>fail('搜索超时，快速规则回退'),2500)};
      try {
        this.worker??=new Worker(new URL('./decision.worker.ts',import.meta.url),{type:'module'});
        this.worker.onerror=()=>fail('Worker 错误，快速规则回退');
        this.worker.onmessage=(event:MessageEvent<{id:number;decision?:AiDecision;error?:string}>)=>{
          if(this.pending?.id!==event.data.id)return;
          if(event.data.error||!event.data.decision){fail('搜索失败，快速规则回退');return;}
          clearTimeout(this.pending.timer);this.pending=null;resolve(event.data.decision);
        };
        this.worker.postMessage({id,request});
      }catch{fail('Worker 启动失败，快速规则回退');}
    });
  }
  cancel():void {
    if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error('AI_CANCELLED'));this.pending=null;}
    this.worker?.terminate();this.worker=null;
  }
  dispose():void { this.cancel(); }
}
