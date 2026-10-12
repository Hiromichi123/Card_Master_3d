import type { CardDefinition, SideId } from '../../cards/types';
import { canPhysicallyHit, physicalDefender } from '../../skills/tacticalTraits';
import { isCooldownCard } from '../turnActions';
import { isSilenced } from '../../skills/rules';
import type { BattleState, Command } from '../types';
import type { AiStyle } from './types';

/** Versioned numeric schema shared by browser inference and offline trainers. */
export const FEATURE_NAMES = [
  'base_hp', 'base_pressure', 'field_hp', 'field_attack', 'field_skills', 'field_count',
  'prep_value', 'prep_ready', 'hand_value', 'cooldown_bank', 'congestion', 'matchup',
  'play_value', 'deploy_value', 'cooldown_value', 'skip_income', 'priority_first',
  'priority_last', 'deploy_matchup', 'cooldown_ready', 'self_destruct', 'response_deploy',
] as const;
export const BASE_WEIGHTS: readonly number[] = [
  12,9,2.2,5,2,1,4.5,2,.5,.1,-2,2, 3.2,4,1.6,.1,0,0,2,2,1,1,
];
const DAMAGE_FAMILIES = new Set(['fireball','iceSeal','lightning','bombard','directDamage','groupPhysicalDamage',
  'groupFireball','groupIceSeal','groupLightning','groupBombard','slash','groupSlash','swordDance','groupSwordDance',
  'piercing','groupPiercing','ranged','instantDeath','poisonCloud','alignedDeathBlast','explodeOnDeath']);
const STRONG_FAMILIES = new Set(['spellReflect','firstStrike','vanguard','execute','masterpiece','foxSpiritSummon','unyielding']);
export function cardValue(card:CardDefinition):number {
  return Math.min(50, card.atk*.8+card.hp*.35+skillValue(card));
}
function skillValue(card:CardDefinition):number {
  return card.skills.reduce((sum,skill)=>{
    if(skill.resolution!=='implemented'&&skill.resolution!=='alias'&&skill.resolution!=='scene-rule')return sum;
    const n=Math.min(12,Math.max(1,skill.param??1)),f=skill.family??'';
    return sum+(DAMAGE_FAMILIES.has(f)?n*.65:STRONG_FAMILIES.has(f)?2.5:f==='flight'?1.5:.5);
  },0);
}
export function weightsFor(style:AiStyle):number[] {
  const w=[...BASE_WEIGHTS];
  if(style==='aggressive'){w[0]=9;w[1]=14;w[3]=7;w[13]=5;}
  if(style==='defensive'){w[0]=18;w[2]=4;w[11]=4;}
  if(style==='control'){w[4]=4;w[6]=4;w[8]=1;w[10]=-3;}
  return w;
}
function sideFeatures(state:BattleState,side:SideId):number[] {
  const z=state.zones[side],other=side==='player'?'enemy':'player';
  let hp=0,atk=0,skills=0,count=0,match=0;const groups=new Set<string>();
  for(const id of z.battle){
    if(!id)continue;const c=state.instances[id],g=c&&state.groups[c.stateGroupId],d=c&&state.definitions[c.definitionId];
    if(!c||!g||!d||g.deathHandled)continue;
    count++; if(!groups.has(g.groupId)){hp+=Math.max(0,g.hp);groups.add(g.groupId);}
    const silenced=isSilenced(state,c.owner,c.slotIndex);
    atk+=Math.max(0,g.atk);skills+=silenced?0:skillValue(d);
    const targetId=state.zones[other].battle[c.slotIndex],target=targetId?state.instances[targetId]:undefined;
    if(!target||(!silenced&&d.skills.some(s=>s.family==='siege'))||!canPhysicallyHit(state,c,target)){match+=Math.max(0,g.atk);continue;}
    const defender=physicalDefender(state,c,target),dg=state.groups[defender.stateGroupId];
    match+=Math.min(Math.max(0,g.atk),Math.max(0,dg?.hp??0))*.3;
    if(dg&&g.atk>=dg.hp)match+=1;
  }
  let prep=0,ready=0,hand=0,tokens=0,occupied=0;
  for(const id of z.prep){if(!id)continue;occupied++;const c=state.instances[id],d=c&&state.definitions[c.definitionId];
    if(c&&d){prep+=cardValue(d)/(1+Math.max(0,c.cd)*.2);if(c.cd<=0)ready++;}}
  for(const id of z.hand){const c=state.instances[id],d=c&&state.definitions[c.definitionId];
    if(!d)continue;if(isCooldownCard(d.cardId))tokens++;else hand+=cardValue(d)/(1+d.cd*.5);}
  const usefulCooling = z.prep.reduce((sum, id) => sum + (id ? Math.max(0, state.instances[id]?.cd ?? 0) : 0), 0);
  const ownBase = state.rules.baseHpBySide?.[side] ?? state.rules.baseHp;
  const enemyBase = state.rules.baseHpBySide?.[other] ?? state.rules.baseHp;
  return [state.hp[side]/ownBase*2,Math.max(0,enemyBase-state.hp[other])/enemyBase*2,hp/10,atk/10,skills/10,count/5,
    prep/10,ready/5,hand/10,Math.min(tokens, usefulCooling, 3)/3,Math.max(0,occupied-5)/3+(count>=5?ready/5:0),match/10];
}
export function stateFeatures(state:BattleState,side:SideId):number[] {
  const own=sideFeatures(state,side),enemy=sideFeatures(state,side==='player'?'enemy':'player');
  return [...own.map((v,i)=>Math.max(-100,Math.min(100,v-(enemy[i]??0)))),...Array<number>(10).fill(0)];
}
export function actionFeatures(state:BattleState,command:Command,side=command.side):number[] {
  const x=stateFeatures(state,side),z=state.zones[side];
  const id='instanceId' in command?command.instanceId:undefined,c=id?state.instances[id]:undefined,d=c?state.definitions[c.definitionId]:undefined;
  if(command.kind==='playCard'&&d)x[12]=cardValue(d)/(10*(1+d.cd*.25))+.25;
  if(command.kind==='deployCard'&&d&&c){
    x[13]=cardValue(d)/10;
    x[20]=d.skills.some(s=>s.family==='selfDestruct')?1:0;
    x[21]=state.phase==='awaitingResponse'?1:0;
    const enemy=side==='player'?'enemy':'player';
    // Score the whole shifted row; insertion must account for allies behind this card.
    const row=z.battle.filter((v):v is string=>v!==null);row.splice(command.battleSlot,0,c.instanceId);
    const projected={...state,instances:{...state.instances},zones:{...state.zones,[side]:{...z,battle:[...row,...Array<string|null>(Math.max(0,state.rules.battleSlots-row.length)).fill(null)]}}};
    row.forEach((unit,i)=>{const old=state.instances[unit];if(old)projected.instances[unit]={...old,slotIndex:i,zone:'battle'};});
    x[18]=(sideFeatures(projected,side)[11]??0)-(sideFeatures(state,side)[11]??0);
    const targetId=state.zones[enemy].battle[command.battleSlot],target=targetId?state.instances[targetId]:undefined;
    if(target&&target.marks.skillImmune&&d.skills.length>0)x[13]=x[13]!*.8;
  }
  if(command.kind==='useCooldownCard'){
    const target=state.instances[command.targetInstanceId],card=target&&state.definitions[target.definitionId];
    const room=z.battle.some(v=>v===null);
    if(target&&card){x[14]=cardValue(card)/(10*(1+target.cd));x[19]=target.cd===1&&room?1:0;if(!room)x[14]=x[14]!*.1;}
  }
  if(command.kind==='endTurn' && state.phase==='awaitingPlay' && state.cardsPlayedThisTurn===0) {
    const canInvest = z.prep.includes(null) && z.hand.some(id => !isCooldownCard(state.instances[id]?.definitionId ?? ''));
    // Skipping is legal, but it must pay for delaying the cooling pipeline; idle tokens have no value.
    const cooling = z.prep.some(id => id !== null && (state.instances[id]?.cd ?? 0) > 0);
    x[15] = canInvest ? -1 : cooling ? .25 : 0;
  }
  if(command.kind==='choosePriority')x[command.order==='first'?16:17]=1;
  return x;
}
export function dot(features:readonly number[],weights:readonly number[]):number {
  return features.reduce((sum,v,i)=>sum+v*(weights[i]??0),0);
}
export function evaluateState(state:BattleState,side:SideId,weights:readonly number[]):number {
  if(state.outcome)return state.outcome.kind==='draw'?0:state.outcome.winner===side?10000:-10000;
  // Imported models cannot let a nonterminal material score override a sampled terminal win/loss.
  return Math.max(-1000,Math.min(1000,dot(stateFeatures(state,side),weights)));
}
/** Cheap fallback / rollout policy. This never simulates or touches live random state. */
export function rankActions(state:BattleState,actions:readonly Command[],weights:readonly number[]) {
  return actions.map(command=>{const features=actionFeatures(state,command);return {command,features,score:dot(features,weights)};})
    .sort((a,b)=>b.score-a.score);
}
