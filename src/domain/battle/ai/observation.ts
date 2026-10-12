import type { CardDefinition, SideId } from '../../cards/types';
import { COOLDOWN_CARD, COOLDOWN_CARD_ID, inputSideOf } from '../turnActions';
import type { BattleState } from '../types';
import { createRng, type Rng } from '../rng';
import { AI_VERSION, type AiObservation } from './types';
import { SUMMON_TARGETS } from '../../skills/tacticalTraits';

function publicCard(card:CardDefinition):CardDefinition { return structuredClone(card); }

export function observeForAi(state:BattleState,catalogue:readonly CardDefinition[]=[],openHands=false,side=inputSideOf(state)):AiObservation {
  const counts:AiObservation['counts']={player:{deck:0,hiddenHand:0},enemy:{deck:0,hiddenHand:0}};
  const visible:BattleState={rules:{...state.rules},definitions:{},seed:0,rng:{state:0,draws:0},
    turnNumber:state.turnNumber,currentSide:state.currentSide,startingSide:state.startingSide,turnIndex:state.turnIndex,
    priority:state.priority,hostAttacked:state.hostAttacked,phase:state.phase,hp:{...state.hp},
    zones:{player:{deck:[],hand:[],prep:[],battle:[],discard:[]},enemy:{deck:[],hand:[],prep:[],battle:[],discard:[]}},
    instances:{},groups:{},cardsPlayedThisTurn:state.cardsPlayedThisTurn,copyUsedThisTurn:{...state.copyUsedThisTurn},
    autoEvolution:state.autoEvolution?{...state.autoEvolution}:null,
    nextEventSeq:state.nextEventSeq,outcome:state.outcome?{...state.outcome}:null,stateHistory:[],};
  const definitions:Record<string,CardDefinition>={[COOLDOWN_CARD_ID]:COOLDOWN_CARD};
  const ownReserve=state.zones[side].deck.map(id=>state.definitions[state.instances[id]?.definitionId??''])
    .filter((card):card is CardDefinition=>!!card).map(publicCard).sort((a,b)=>a.cardId.localeCompare(b.cardId));
  for(const owner of ['player','enemy'] as const){
    const zones=state.zones[owner],hand=owner===side||openHands?zones.hand:[];
    counts[owner]={deck:zones.deck.length,hiddenHand:zones.hand.length-hand.length};
    visible.zones[owner]={deck:[],hand:[...hand],prep:[...zones.prep],battle:[...zones.battle],discard:[...zones.discard]};
    for(const id of [...hand,...zones.prep,...zones.battle,...zones.discard]){
      if(!id)continue;const instance=state.instances[id];if(!instance)continue;
      visible.instances[id]=structuredClone(instance);
      const card=state.definitions[instance.definitionId];if(card)definitions[card.cardId]=publicCard(card);
      const group=state.groups[instance.stateGroupId];if(group)visible.groups[group.groupId]=structuredClone(group);
    }
  }
  for(const group of Object.values(visible.groups))group.memberIds.splice(0,group.memberIds.length,...group.memberIds.filter(id=>id in visible.instances));
  // Only summon mappings referenced by an observable card are needed in hypotheses.
  const summonDefinitions:Record<SideId,Record<string,string>>={player:{},enemy:{}};
  for(const instance of Object.values(visible.instances)){
    const mappings=state.summonDefinitions?.[instance.owner];
    const skills=definitions[instance.definitionId]?.skills??[];
    for(const original of skills.map(skill=>SUMMON_TARGETS[skill.family??'']).filter((id):id is string=>!!id)){
      const runtime=mappings?.[original]??original;
      const summoned=state.definitions[runtime];if(!summoned)continue;
      // Known summon families refer only to their declared public template dependencies.
      const relevant=skills.some(skill=>SUMMON_TARGETS[skill.family??'']===original);
      if(relevant){summonDefinitions[instance.owner][original]=runtime;definitions[runtime]=publicCard(summoned);}
    }
  }
  const publicPool=(catalogue.length?catalogue:[...Object.values(definitions),...ownReserve])
    .filter(card=>card.status==='complete'&&card.cardId!==COOLDOWN_CARD_ID).map(publicCard);
  return {version:AI_VERSION,side,visible:{...visible,definitions,summonDefinitions},counts,ownReserve,catalogue:[...new Map(publicPool.map(card=>[card.cardId,card])).values()].sort((a,b)=>a.cardId.localeCompare(b.cardId))};
}

function instantiate(state:BattleState,card:CardDefinition,owner:SideId,zone:'hand'|'deck',id:string):void {
  const definitions=state.definitions as Record<string,CardDefinition>;definitions[card.cardId]=card;
  state.instances[id]={instanceId:id,definitionId:card.cardId,owner,zone,slotIndex:zone==='hand'?state.zones[owner].hand.length:-1,
    stateGroupId:`g:${id}`,cd:card.cd,flying:card.rawTraits.includes('飞行'),hasAttackedThisTurn:false,
    marks:{undyingUsed:false,revivedUsed:false,skillImmune:card.rawTraits.includes('免疫'),silenced:false}};
  state.groups[`g:${id}`]={groupId:`g:${id}`,owner,hp:card.hp,maxHp:card.hp,atk:card.atk,memberIds:[id],deathHandled:false};
  state.zones[owner][zone].push(id);
}

function assumedEnemyCard(observation:AiObservation,rng:Rng):CardDefinition {
  const visible=observation.visible,enemy=observation.side==='player'?'enemy':'player';
  const seen=[...visible.zones[enemy].battle,...visible.zones[enemy].prep,...visible.zones[enemy].discard]
    .filter((id):id is string=>id!==null).map(id=>visible.definitions[visible.instances[id]?.definitionId??''])
    .filter((card):card is CardDefinition=>!!card);
  const average=seen.length?seen.reduce((sum,card)=>sum+card.level,0)/seen.length:4.75;
  const close=observation.catalogue.filter(card=>!card.rarity.startsWith('#')&&Math.abs(card.level-average)<=1);
  const pool=close.length?close:observation.catalogue;
  return pool.length?rng.pick(pool):{...COOLDOWN_CARD,cardId:'@ai/unknown',name:'假设单位',rarity:'C',atk:1,hp:3,cd:2};
}

/** Reconstruct unknown cards and random outcomes from independent samples, never the live RNG/deck. */
export function sampleWorld(observation:AiObservation,seed:number):BattleState {
  const state=structuredClone(observation.visible),rng=createRng(seed);
  // Public summon templates are available even when absent from either sampled deck.
  const definitions=state.definitions as Record<string,CardDefinition>;
  for(const card of observation.catalogue)if(!definitions[card.cardId])definitions[card.cardId]=card;
  state.rng={state:rng.int(0,0xffffffff),draws:0};
  for(const owner of ['player','enemy'] as const){
    const own=owner===observation.side;
    const reserve=own?rng.shuffle([...observation.ownReserve]):[];
    for(let i=0;i<observation.counts[owner].deck;i++)instantiate(state,reserve[i]??assumedEnemyCard(observation,rng),owner,'deck',`@ai:${owner}:deck:${i}`);
    for(let i=0;i<observation.counts[owner].hiddenHand;i++)instantiate(state,state.autoEvolution?COOLDOWN_CARD:assumedEnemyCard(observation,rng),owner,'hand',`@ai:${owner}:hand:${i}`);
  }
  return state;
}
