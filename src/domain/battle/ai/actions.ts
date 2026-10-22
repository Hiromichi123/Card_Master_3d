import type { Command, BattleState } from '../types';
import { validateCommand } from '../engine';
import { inputSideOf, insertionSlots, isCooldownCard, readyCardIds } from '../turnActions';

export function commandKey(command:Command):string {
  switch(command.kind){
    case 'playCard': return `play:${command.instanceId}:${command.prepSlot??-1}`;
    case 'deployCard': return `deploy:${command.instanceId}:${command.battleSlot}`;
    case 'useCooldownCard': return `cool:${command.targetInstanceId}`;
    default: return command.kind;
  }
}

/** The engine is the single authority. Identical cooldown tokens are one equivalent action. */
export function legalActions(state:BattleState):Command[] {
  if(state.outcome||state.phase==='resolving'||state.phase==='ended')return [];
  const side=inputSideOf(state),zones=state.zones[side],result:Command[]=[];
  for(const instanceId of readyCardIds(state,side))for(const battleSlot of insertionSlots(state,side))
    result.push({kind:'deployCard',side,instanceId,battleSlot});
  if(state.phase==='awaitingPlay'){
    const token=zones.hand.find(id=>isCooldownCard(state.instances[id]?.definitionId??''));
    if(token)for(const target of zones.prep)if(target&&(state.instances[target]?.cd??0)>0)
      result.push({kind:'useCooldownCard',side,instanceId:token,targetInstanceId:target});
    if(state.cardsPlayedThisTurn<state.rules.cardsPerTurn)for(const instanceId of zones.hand){
      if(isCooldownCard(state.instances[instanceId]?.definitionId??''))continue;
      zones.prep.forEach((id,prepSlot)=>{if(id===null)result.push({kind:'playCard',side,instanceId,prepSlot});});
    }
  }
  result.push({kind:'endTurn',side});
  return result.filter(command=>validateCommand(state,command).ok);
}
