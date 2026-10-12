import { applyCommand, validateCommand } from '../engine';
import { createRng } from '../rng';
import { inputSideOf } from '../turnActions';
import { chooseBaselineCommand } from '../baselineAi';
import { legalActions, commandKey } from './actions';
import { actionFeatures, dot, evaluateState, rankActions, weightsFor } from './features';
import { modelScore } from './model';
import { sampleWorld } from './observation';
import { AI_BUDGETS, AI_VERSION, normalizeAiSettings, type AiDecision, type AiRequest, type AiScoredAction } from './types';

function decision(request:AiRequest,rows:readonly AiScoredAction[],selected:AiScoredAction,transitions:number,samples:number,reason:string):AiDecision {
  return {version:AI_VERSION,command:selected.command,side:request.observation.side,options:normalizeAiSettings(request.options),
    phase:request.observation.visible.phase,turn:request.observation.visible.turnIndex,
    candidates:rows.slice(0,24).some(r=>r.key===selected.key)?rows.slice(0,24):[...rows.slice(0,23),selected],selectedKey:selected.key,
    transitions,samples,model:request.options.policy==='hybrid'?request.model?.name??null:null,reason};
}
export function quickDecision(request:AiRequest,reason='快速规则评分'):AiDecision {
  const state=request.observation.visible,options=normalizeAiSettings(request.options);
  const weights=options.policy==='hybrid'&&request.model?.kind==='linear'?request.model.weights??weightsFor(options.style):weightsFor(options.style);
  const rows=rankActions(state,legalActions(state),weights).map(row=>({...row,key:commandKey(row.command)}));
  if(!rows[0])throw new Error('AI 当前没有合法动作');
  if(options.policy==='baseline'){
    const command=chooseBaselineCommand(state,createRng(request.seed));
    return decision(request,rows,rows.find(r=>r.key===commandKey(command))??rows[0],0,0,'旧版基础策略');
  }
  return decision(request,rows,rows[0],0,0,reason);
}
function diversify(rows:readonly AiScoredAction[],width:number):AiScoredAction[] {
  const result:AiScoredAction[]=[],seen=new Set<string>();
  const add=(r:AiScoredAction)=>{if(!result.some(x=>x.key===r.key)&&result.length<width)result.push(r);};
  // Ending the current deployment/action window must survive pruning.
  rows.filter(r=>r.command.kind==='endTurn').forEach(add);
  for(const r of rows){const c=r.command,key=c.kind+('instanceId' in c?`:${c.instanceId}`:'')+('targetInstanceId' in c?`:${c.targetInstanceId}`:'');
    if(!seen.has(key)){seen.add(key);add(r);}}
  rows.forEach(add);return result;
}
/** Bounded sampled lookahead, not full-information minimax. Each candidate gets equal search effort. */
export function decideAi(request:AiRequest):AiDecision {
  const options=normalizeAiSettings(request.options),state=request.observation.visible;
  const actions=legalActions(state),rng=createRng(request.seed),budget=AI_BUDGETS[options.difficulty];
  const weights=options.policy==='hybrid'&&request.model?.kind==='linear'?request.model.weights??weightsFor(options.style):weightsFor(options.style);
  const prior=actions.map(command=>{const features=actionFeatures(state,command),learned=options.policy==='hybrid'&&request.model?.kind==='mlp'?modelScore(request.model,features):0;
    return {command,key:commandKey(command),features,score:dot(features,weights)+Math.max(-20,Math.min(20,learned))*.2};}).sort((a,b)=>b.score-a.score);
  if(!prior[0])throw new Error('AI 当前没有合法动作');
  if(options.policy==='baseline'){
    const command=chooseBaselineCommand(state,rng),row=prior.find(r=>commandKey(r.command)===commandKey(command))??prior[0];
    return decision(request,prior,row,0,0,'旧版基础策略');
  }
  const shortlist=diversify(prior,budget.width),seeds=Array.from({length:budget.samples},()=>rng.int(0,0xffffffff));
  const worlds=seeds.map(seed=>sampleWorld(request.observation,seed));
  const perBranch=Math.max(1,Math.min(budget.steps,Math.floor(budget.transitions/(shortlist.length*budget.samples*budget.branches))));
  let transitions=0;
  const scored=shortlist.map(root=>{
    let total=0;
    for(const initial of worlds){
      let best=-Infinity;
      for(let branch=0;branch<budget.branches;branch++){
        const first=applyCommand(initial,root.command);transitions++;
        if(!first.accepted){best=Math.max(best,-10000);continue;}
        let current=first.finalState,branched=false,window=0,windowKey=`${current.turnIndex}/${current.phase}`;
        for(let step=1;step<perBranch&&!current.outcome&&current.turnIndex<initial.turnIndex+budget.turns;step++){
          const choices=rankActions(current,legalActions(current),inputSideOf(current)===request.observation.side?weights:weightsFor('balanced'));if(!choices[0])break;
          let choice=choices[0].command;
          // Explore a few continuations for our side only. Opponent plays a fixed conservative policy.
          if(branch>0&&!branched&&inputSideOf(current)===request.observation.side&&choices.length>1){choice=choices[Math.min(branch,choices.length-1)]!.command;branched=true;}
          const key=`${current.turnIndex}/${current.phase}`;if(key!==windowKey){window=0;windowKey=key;}window++;
          // Bound oversized cooldown inventories; deployment/turn progression remains legal.
          if(window>=12&&validateCommand(current,{kind:'endTurn',side:inputSideOf(current)}).ok)choice={kind:'endTurn',side:inputSideOf(current)};
          const resolution=applyCommand(current,choice);transitions++;if(!resolution.accepted)break;current=resolution.finalState;
        }
        best=Math.max(best,evaluateState(current,request.observation.side,weights));
      }
      total+=best;
    }
    // Small tie-break prior; sampled terminal outcomes dominate any learned preference.
    return {...root,score:total/worlds.length+Math.max(-200,Math.min(200,root.score))*.025};
  }).sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
  const best=scored[0]!;
  const near=scored.filter(row=>row.score>=best.score-2&&row.score>-9000);
  const selected=budget.exploration>0&&near.length>1&&rng.chance(budget.exploration)?rng.pick(near):best;
  return decision(request,scored,selected,transitions,worlds.length,options.policy==='hybrid'&&!request.model?'无模型，使用规则推演':'公开信息采样＋引擎短期推演');
}
