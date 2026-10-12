import { create } from 'zustand';
import { parseAiModel } from '../domain/battle/ai/model';
import type { AiModel } from '../domain/battle/ai/types';

const STORAGE_KEY='card-master-ai-model-v1';
const MAX_BYTES=500000;
function load():AiModel|null {
  try {const json=localStorage.getItem(STORAGE_KEY);return json&&json.length<=MAX_BYTES?parseAiModel(JSON.parse(json)):null;}catch{return null;}
}
export const useAiModelStore=create<{
  model:AiModel|null;error:string|null;importJson:(json:string)=>void;clear:()=>void;
}>((set)=>({
  model:load(),error:null,
  importJson:(json)=>{
    try {
      if(json.length>MAX_BYTES)throw new Error('模型文件超过 500 KB');
      const model=parseAiModel(JSON.parse(json));
      let error:string|null=null;
      try{localStorage.setItem(STORAGE_KEY,JSON.stringify(model));}catch{error='模型已载入，本机持久化失败';}
      set({model,error});
    }catch(error){set({error:error instanceof Error?error.message:String(error)});}
  },
  clear:()=>{try{localStorage.removeItem(STORAGE_KEY);}catch{/* Session-only storage is allowed. */}set({model:null,error:null});},
}));
