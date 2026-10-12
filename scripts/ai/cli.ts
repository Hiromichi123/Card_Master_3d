import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { cardDatabase, slice } from '../../src/data';
import type { CardDefinition, SideId } from '../../src/domain/cards/types';
import { summonDefinitionIds } from '../../src/domain/skills/tacticalTraits';
import { applyCommand, createBattle } from '../../src/domain/battle/engine';
import { createRng, seedFrom } from '../../src/domain/battle/rng';
import { inputSideOf } from '../../src/domain/battle/turnActions';
import type { BattleConfig, BattleState } from '../../src/domain/battle/types';
import { legalActions, commandKey } from '../../src/domain/battle/ai/actions';
import { observeForAi } from '../../src/domain/battle/ai/observation';
import { decideAi, quickDecision } from '../../src/domain/battle/ai/search';
import { parseAiModel } from '../../src/domain/battle/ai/model';
import { FEATURE_NAMES, BASE_WEIGHTS, actionFeatures, evaluateState } from '../../src/domain/battle/ai/features';
import { AI_VERSION, normalizeAiSettings, type AiModel, type AiSettings } from '../../src/domain/battle/ai/types';

const catalogue=cardDatabase.definitions.filter(c=>c.status==='complete');
type SuiteEntry={config:BattleConfig;definitions?:Record<string,CardDefinition>};
const args=process.argv.slice(2),mode=args.shift()??'help',flags=new Map<string,string>();
while(args.length){const key=args.shift();if(!key?.startsWith('--'))throw new Error('参数必须使用 --名称 值');const value=args.shift();if(!value||value.startsWith('--'))throw new Error(`${key} 缺少值`);flags.set(key.slice(2),value);}
const integer=(key:string,fallback:number,min=1)=>{const n=Number(flags.get(key)??fallback);if(!Number.isSafeInteger(n)||n<min)throw new Error(`--${key} 必须是 >= ${min} 的整数`);return n;};
const seed=integer('seed',20261012,0),games=integer('games',16),maxActions=integer('max-actions',1600);
const out=resolve(flags.get('out')??`artifacts/ai/${mode==='generate'?'teacher.jsonl':mode==='tune'?'weights.json':`${mode}.json`}`);
const loadModel=(path:string|undefined):AiModel|null=>path?parseAiModel(JSON.parse(readFileSync(resolve(path),'utf8'))):null;
const jsonOut=(path:string,value:unknown)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(value,null,2)+'\n','utf8');};
const suiteFile=flags.get('suite');
const suite:SuiteEntry[]|null=suiteFile?JSON.parse(readFileSync(resolve(suiteFile),'utf8')):null;
if(suite&&(!Array.isArray(suite)||suite.length===0))throw new Error('suite 必须是非空的 [{config, definitions?}] 数组');
function scenario(index:number,battleSeed:number,split:'train'|'heldout'):SuiteEntry {
  if(suite){const entry=suite[index%suite.length]!;return {...entry,config:{...entry.config,seed:battleSeed}};}
  const rng=createRng(battleSeed^0x71a91);
  const pool=catalogue.filter(c=>!c.rarity.startsWith('#')&&c.level>=(split==='heldout'?0:2)&&c.level<=(split==='heldout'?4:5));
  const deck=()=>Array.from({length:12},()=>rng.pick(pool).cardId);
  const example=slice.decks[index%slice.decks.length];
  return {config:{seed:battleSeed,playerDeck:index%3===0&&example?example.cardIds.slice(0,12):deck(),enemyDeck:deck(),label:`ai-${split}-${index}`}};
}
function start(entry:SuiteEntry):BattleState {
  const table={...Object.fromEntries(catalogue.map(c=>[c.cardId,c])),...entry.definitions};
  const required=summonDefinitionIds([...entry.config.playerDeck,...entry.config.enemyDeck],id=>table[id]);
  for(const id of required)if(!table[id])throw new Error(`suite 缺少卡牌定义 ${id}`);
  return createBattle(entry.config,table);
}
function select(state:BattleState,settings:AiSettings,model:AiModel|null,decisionSeed:number,quick=false){
  const request={observation:observeForAi(state,catalogue),options:settings,seed:decisionSeed,model};
  return quick&&settings.policy!=='baseline'?quickDecision(request):decideAi(request);
}
interface GameResult { result:'win'|'loss'|'draw'|'truncated'; actions:number; turns:number; transitions:number; aiDecisions:number; elapsedMs:number }
function play(entry:SuiteEntry,target:SideId,settings:AiSettings,model:AiModel|null,opponent:AiSettings,
  onDecision?: (state:BattleState,result:ReturnType<typeof decideAi>,gameId:string)=>void):GameResult {
  let state=start(entry),actions=0,transitions=0;const before=performance.now(),aiRng=createRng(entry.config.seed^0x4131),gameId=`${entry.config.label??'suite'}:${entry.config.seed}:${target}`;
  while(!state.outcome&&actions<maxActions){
    const side=inputSideOf(state),own=side===target;
    const result=select(state,own?settings:opponent,own?model:null,aiRng.int(0,0xffffffff));
    if(own)onDecision?.(state,result,gameId);transitions+=result.transitions;
    const resolution=applyCommand(state,result.command);if(!resolution.accepted)throw new Error(`AI 非法动作 ${JSON.stringify(result.command)}`);
    state=resolution.finalState;actions++;
  }
  return {result:!state.outcome?'truncated':state.outcome.kind==='draw'?'draw':state.outcome.winner===target?'win':'loss',
    actions,turns:state.turnIndex,transitions,aiDecisions:actions,elapsedMs:performance.now()-before};
}
function summary(rows:GameResult[]) {
  const wins=rows.filter(r=>r.result==='win').length,losses=rows.filter(r=>r.result==='loss').length,draws=rows.filter(r=>r.result==='draw').length,truncated=rows.length-wins-losses-draws;
  const score=(wins+draws*.5)/rows.length;
  return {games:rows.length,wins,losses,draws,truncated,score,
    meanActions:rows.reduce((s,r)=>s+r.actions,0)/rows.length,meanTurns:rows.reduce((s,r)=>s+r.turns,0)/rows.length,
    meanSearchTransitions:rows.reduce((s,r)=>s+r.transitions,0)/rows.length,meanElapsedMs:rows.reduce((s,r)=>s+r.elapsedMs,0)/rows.length};
}
const actor=normalizeAiSettings({difficulty:(flags.get('difficulty')??'normal') as AiSettings['difficulty'],
  style:(flags.get('style')??'balanced') as AiSettings['style'],policy:flags.has('model')?'hybrid':(flags.get('policy')??'heuristic') as AiSettings['policy']});
const opponent=normalizeAiSettings({difficulty:'normal',policy:(flags.get('opponent')??'baseline') as AiSettings['policy']});
function tournament(model:AiModel|null,settings:AiSettings,baseSeed:number,split:'train'|'heldout',count=games){
  const rows:GameResult[]=[];
  for(let i=0;i<count;i++){
    const battleSeed=(baseSeed+Math.floor(i/2))>>>0,entry=scenario(Math.floor(i/2),battleSeed,split);
    rows.push(play(entry,i%2===0?'player':'enemy',settings,model,opponent));
  }
  return {summary:summary(rows),rows};
}
function makeLinear(weights:readonly number[],name:string):AiModel {return {format:'card-master-ai',version:1,name,kind:'linear',featureNames:[...FEATURE_NAMES],weights};}

async function bridge(){
  let state:BattleState|null=null,learner:SideId='player',actions=0,rng=createRng(seed);
  const advanceOpponent=()=>{
    while(state&&!state.outcome&&inputSideOf(state)!==learner&&actions<maxActions){
      const choice=select(state,opponent,null,rng.int(0,0xffffffff));
      const r=applyCommand(state,choice.command);if(!r.accepted)throw new Error('环境对手提交非法动作');state=r.finalState;actions++;
    }
  };
  const observation=()=>{
    if(!state)throw new Error('请先 reset');
    const done=!!state.outcome||actions>=maxActions,o=observeForAi(state,catalogue,false,learner);
    const commands=done?[]:legalActions(o.visible);
    return {version:AI_VERSION,featureNames:FEATURE_NAMES,side:learner,phase:state.phase,turn:state.turnIndex,hp:{...state.hp},
      features:commands.map(c=>actionFeatures(o.visible,c)),commands,mask:commands.map(()=>true),done,
      truncated:!state.outcome&&actions>=maxActions,outcome:state.outcome,
      potential:evaluateState(o.visible,learner,BASE_WEIGHTS)};
  };
  for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
    try {
      const message=JSON.parse(line);
      if(message.op==='close'){process.stdout.write(JSON.stringify({ok:true})+'\n');break;}
      if(message.op==='reset'){
        const s=Number(message.seed??seed);if(!Number.isSafeInteger(s)||s<0)throw new Error('seed 无效');
        learner=message.side==='enemy'?'enemy':'player';actions=0;rng=createRng(s^0x4131);
        state=start(scenario(s%1024,s>>>0,message.split==='heldout'?'heldout':'train'));advanceOpponent();
        process.stdout.write(JSON.stringify({ok:true,observation:observation(),reward:0})+'\n');continue;
      }
      if(message.op==='step'){
        const before=observation();if(before.done)throw new Error('终局不能 step，请 reset');
        const i=Number(message.action);if(!Number.isInteger(i)||i<0||i>=before.commands.length)throw new Error('非法动作下标');
        const r=applyCommand(state!,before.commands[i]!);if(!r.accepted)throw new Error('规则拒绝动作');state=r.finalState;actions++;advanceOpponent();
        const after=observation(),reward=after.done?(after.outcome?.kind==='win'?(after.outcome.winner===learner?1:-1):0):0;
        process.stdout.write(JSON.stringify({ok:true,observation:after,reward})+'\n');continue;
      }
      throw new Error('未知 op，使用 reset/step/close');
    }catch(error){process.stdout.write(JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)})+'\n');}
  }
}

async function main(){
  if(mode==='serve'){await bridge();return;}
  if(mode==='schema'){jsonOut(out,{version:AI_VERSION,featureNames:FEATURE_NAMES,initialRuleWeights:BASE_WEIGHTS,trained:false});return;}
  if(mode==='evaluate'){
    const model=loadModel(flags.get('model')),a=tournament(model,actor,seed,'heldout');
    jsonOut(out,{version:AI_VERSION,settings:actor,opponent,seed,split:'heldout',model:model?.name??null,...a});console.log(a.summary);return;
  }
  if(mode==='generate'){
    mkdirSync(dirname(out),{recursive:true});writeFileSync(out,'','utf8');let records=0;
    const teacher=normalizeAiSettings({...actor,difficulty:(flags.get('difficulty')??'hard') as AiSettings['difficulty'],policy:'heuristic'});
    for(let i=0;i<games;i++){
      const s=(seed+i)>>>0,entry=scenario(i,s,'train');
      play(entry,i%2===0?'player':'enemy',teacher,null,opponent,(state,result,gameId)=>{
        const o=observeForAi(state,catalogue),commands=legalActions(o.visible),unique: number[][]=[],indices:number[]=[];
        const seen=new Map<string,number>();
        for(const command of commands){const f=actionFeatures(o.visible,command),k=JSON.stringify(f);let id=seen.get(k);if(id===undefined){id=unique.length;seen.set(k,id);unique.push(f);}indices.push(id);}
        const chosen=commands.findIndex(c=>commandKey(c)===result.selectedKey);if(chosen<0)throw new Error('教师动作未包含在合法动作表');
        appendFileSync(out,JSON.stringify({format:'card-master-ai-sample',version:1,featureNames:FEATURE_NAMES,gameId,seed:s,
          phase:state.phase,side:result.side,features:unique,target:indices[chosen],teacher:result.options,selectedKey:result.selectedKey})+'\n','utf8');records++;
      });
      console.error(`数据 ${i+1}/${games} 局，${records} 条`);
    }
    jsonOut(out+'.meta.json',{version:AI_VERSION,teacher,seed,games,records,splitBy:'gameId'});return;
  }
  if(mode==='tune'){
    const generations=integer('generations',12),population=integer('population',6,2),rng=createRng(seedFrom(`weights:${seed}`));
    const imported=loadModel(flags.get('model'));if(imported&&imported.kind!=='linear')throw new Error('权重学习起点必须为 linear 模型');
    let weights=[...(imported?.weights??BASE_WEIGHTS)],best=-Infinity;const history:unknown[]=[];
    const settings=normalizeAiSettings({...actor,policy:'hybrid',difficulty:(flags.get('difficulty')??'easy') as AiSettings['difficulty']});
    for(let generation=0;generation<generations;generation++){
      // Same train seeds/decks per candidate, fixed opponent. Held-out results never select mutations.
      const candidates=[weights,...Array.from({length:population-1},()=>weights.map((w,i)=>Math.max(-40,Math.min(40,w+(rng.next()*2-1)*(i<12?1.2:.5)))))];
      const scored=candidates.map((w,i)=>({weights:w,index:i,...tournament(makeLinear(w,`candidate-${generation}-${i}`),settings,seed,'train').summary}));
      scored.sort((a,b)=>b.score-a.score||a.index-b.index);const winner=scored[0]!;weights=winner.weights;best=winner.score;
      history.push({generation,fitness:best,wins:winner.wins,losses:winner.losses,draws:winner.draws,truncated:winner.truncated});
      console.error(`权重 ${generation+1}/${generations} 训练集得分 ${best.toFixed(3)}`);
    }
    const model=makeLinear(weights,flags.get('name')??'learned-weights');
    // Independent seed range and different default card tier distribution.
    const heldout=tournament(model,settings,(seed+1000000)>>>0,'heldout');
    const baseline=tournament(makeLinear(BASE_WEIGHTS,'initial-rule-weights'),settings,(seed+1000000)>>>0,'heldout');
    jsonOut(out,model);jsonOut(out+'.report.json',{version:AI_VERSION,seed,generations,population,settings,opponent,history,
      heldout:heldout.summary,initialWeightsHeldout:baseline.summary,heldoutSeed:(seed+1000000)>>>0,
      note:'仅按训练集选择权重；留出集只报告，不能据此宣称稳定胜率提升。'});return;
  }
  console.log('AI 工具：schema | evaluate | generate | tune | serve\n通用：--seed N --games N --out 路径 --suite 对局.json --difficulty easy/normal/hard/boss --opponent baseline/heuristic\n模型：--model 模型.json；tune：--generations N --population N；generate 输出 JSONL。');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
