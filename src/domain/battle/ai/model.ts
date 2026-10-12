import { FEATURE_NAMES, dot } from './features';
import type { AiModel } from './types';

const vector=(v:unknown,n:number):v is number[]=>Array.isArray(v)&&v.length===n&&v.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=10000);
/** A numeric-only format. Imported artifacts cannot contain executable code or arbitrary graph operators. */
export function parseAiModel(value:unknown):AiModel {
  if(!value||typeof value!=='object')throw new Error('模型必须是 JSON 对象');
  const m=value as Record<string,unknown>,n=FEATURE_NAMES.length;
  if(m.format!=='card-master-ai'||m.version!==1)throw new Error('不支持的模型格式或版本');
  if(typeof m.name!=='string'||m.name.length>120)throw new Error('模型名称无效');
  if(!Array.isArray(m.featureNames)||JSON.stringify(m.featureNames)!==JSON.stringify(FEATURE_NAMES))throw new Error('模型特征版本与游戏不匹配');
  const base={format:'card-master-ai' as const,version:1 as const,name:m.name,featureNames:[...FEATURE_NAMES]};
  if(m.kind==='linear'&&vector(m.weights,n))return {...base,kind:'linear',weights:[...m.weights]};
  if(m.kind==='mlp'&&Array.isArray(m.hidden)&&m.hidden.length>0&&m.hidden.length<=128&&m.hidden.every(row=>vector(row,n))
    &&vector(m.hiddenBias,m.hidden.length)&&vector(m.output,m.hidden.length)
    &&typeof m.outputBias==='number'&&Number.isFinite(m.outputBias)&&Math.abs(m.outputBias)<=10000){
    return {...base,kind:'mlp',hidden:m.hidden.map(row=>[...(row as number[])]),hiddenBias:[...m.hiddenBias],output:[...m.output],outputBias:m.outputBias};
  }
  throw new Error('模型参数维度、类型或数值无效');
}
export function modelScore(model:AiModel,features:readonly number[]):number {
  if(model.kind==='linear')return dot(features,model.weights??[]);
  const hidden=(model.hidden??[]).map((row,i)=>Math.max(0,dot(features,row)+(model.hiddenBias?.[i]??0)));
  return dot(hidden,model.output??[])+(model.outputBias??0);
}
