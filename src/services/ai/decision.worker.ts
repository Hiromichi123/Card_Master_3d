import { decideAi } from '../../domain/battle/ai/search';
import type { AiRequest } from '../../domain/battle/ai/types';

interface WorkerPort {
  onmessage: ((event:MessageEvent<{id:number;request:AiRequest}>)=>void)|null;
  postMessage: (value:unknown)=>void;
}
const port=globalThis as unknown as WorkerPort;
port.onmessage=event=>{
  const {id,request}=event.data;
  try { port.postMessage({id,decision:decideAi(request)}); }
  catch(error){ port.postMessage({id,error:error instanceof Error?error.message:String(error)}); }
};
