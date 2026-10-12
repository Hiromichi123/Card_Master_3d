import type { CardInstance } from '../cards/types';
import type { BattleEventPayload, BattleState } from '../battle/types';
import { battleCards, hasFamily, isBattleActive } from './rules';

export interface TraitStatusResolver { emit(event:BattleEventPayload):void }
export function canReceiveConcealment(state:BattleState,card:CardInstance):boolean {
  return isBattleActive(state,card)&&!card.marks.deploymentCast&&!card.marks.grantedConcealment&&
    !(hasFamily(state,card,'concealment')&&!card.marks.concealmentUsed);
}
/** Regrant one consumed protection, never accumulate charges. Avoid wasting gifts on one-use spells. */
export function grantConcealment(resolver:TraitStatusResolver,state:BattleState,target:CardInstance,source:CardInstance):void {
  if(!canReceiveConcealment(state,target))return;
  target.marks.grantedConcealment=true;
  resolver.emit({type:'ConcealmentGranted',side:target.owner,instanceId:target.instanceId,sourceInstanceId:source.instanceId});
}
export function timedSilenceActive(state:BattleState,card:CardInstance):boolean {
  return card.zone==='battle'&&(card.marks.silenceUntil??-1)>=state.turnIndex;
}
/** Count complete host actions of the recipient, never guest deployment windows or simple handoffs. */
export function grantSilence(resolver:TraitStatusResolver,state:BattleState,target:CardInstance,source:CardInstance,turns:number):void {
  if(!isBattleActive(state,target)||turns<=0)return;
  const n=Math.max(1,Math.trunc(turns));
  const first=target.owner!==state.currentSide?1:state.phase==='resolving'||state.hostAttacked?2:0;
  const until=state.turnIndex+first+2*(n-1);
  target.marks.silenceUntil=Math.max(target.marks.silenceUntil??-1,until);
  resolver.emit({type:'SilenceApplied',side:target.owner,instanceId:target.instanceId,
    sourceInstanceId:source.instanceId,turns:n,expiresAfterTurn:target.marks.silenceUntil});
}
export function expireSilences(resolver:TraitStatusResolver,state:BattleState):void {
  for(const card of battleCards(state,state.currentSide)){
    if(card.marks.silenceUntil===undefined||state.turnIndex<card.marks.silenceUntil)continue;
    delete card.marks.silenceUntil;
    resolver.emit({type:'SilenceExpired',side:card.owner,instanceId:card.instanceId});
  }
}
