import type { CardDefinition, CardInstance } from '../cards/types';
import type { BattleState, BattleEventPayload } from '../battle/types';
import { battleInstances, groupOf, hasFamily, isBattleActive, isSilenced } from './rules';
import type { AttackState } from './rules';

export const MASTERPIECE_CARD_ID = 'A+_006';
export const lethalStrikeChance = (level:number):number => .20 - .10 * Math.pow(.5, Math.max(1,Math.trunc(level))-1);

/** Include cards that can be summoned even when they are absent from both decks. */
export function summonDefinitionIds(ids:readonly string[],lookup:(id:string)=>CardDefinition|undefined):string[] {
  const result=new Set(ids);
  if(ids.some((id)=>lookup(id)?.skills.some((skill)=>skill.family==='masterpiece'))) result.add(MASTERPIECE_CARD_ID);
  return [...result];
}

export function canPhysicallyHit(state:BattleState,attacker:CardInstance,defender:CardInstance):boolean {
  return !defender.flying || attacker.flying ||
    (hasFamily(state,attacker,'antiAir')&&!isSilenced(state,attacker.owner,attacker.slotIndex));
}

/** One interception only; never bounce an attack back and forth between two guards. */
export function physicalDefender(state:BattleState,attacker:CardInstance,intended:CardInstance):CardInstance {
  if(!canPhysicallyHit(state,attacker,intended)) return intended; // This shot hits the base, not a teammate.
  const guards=battleInstances(state,intended.owner).map(({instance})=>instance).filter((card)=>
    groupOf(state,card).hp>0 && !groupOf(state,card).deathHandled && hasFamily(state,card,'vanguard') &&
    !isSilenced(state,card.owner,card.slotIndex) && canPhysicallyHit(state,attacker,card));
  // A vanguard already being attacked takes its own hit; another guard does not intercept it.
  if(guards.some((guard)=>guard.instanceId===intended.instanceId)) return intended;
  return guards[0]??intended;
}

/** First physical attack per battlefield entry; spells and base shots never consume concealment. */
export function consumeConcealment(resolver:{emit(event:BattleEventPayload):void},state:BattleState,
  defender:CardInstance,attack:AttackState):boolean {
  if(defender.marks.concealmentUsed || !isBattleActive(state,defender) || !hasFamily(state,defender,'concealment') ||
    isSilenced(state,defender.owner,defender.slotIndex)) return false;
  defender.marks.concealmentUsed=true;attack.damage=0;attack.dodged=true;
  resolver.emit({type:'ConcealmentUsed',side:defender.owner,instanceId:defender.instanceId,attackerId:attack.attacker.instanceId});
  return true;
}
