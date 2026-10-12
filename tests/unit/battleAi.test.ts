import { describe, expect, it } from 'vitest';
import type { CardDefinition } from '../../src/domain/cards/types';
import { createBattle, applyCommand, validateCommand } from '../../src/domain/battle/engine';
import { legalActions, commandKey } from '../../src/domain/battle/ai/actions';
import { observeForAi, sampleWorld } from '../../src/domain/battle/ai/observation';
import { decideAi } from '../../src/domain/battle/ai/search';
import { DEFAULT_AI, AI_BUDGETS } from '../../src/domain/battle/ai/types';
import { FEATURE_NAMES } from '../../src/domain/battle/ai/features';
import { parseAiModel, modelScore } from '../../src/domain/battle/ai/model';
import { inputSideOf } from '../../src/domain/battle/turnActions';

function card(id:string,atk=2,hp=5,cd=1):CardDefinition {return {cardId:id,name:id,rarity:'C',level:5,atk,hp,cd,
  rawTraits:[],skills:[],description:'',status:'complete',art:{artId:id,sourcePresent:false}};}
const a=card('a'),b=card('b',3,6,2),secret=card('secret',99,99,8),catalogue=[a,b];
function battle(){return createBattle({seed:7,playerDeck:['a','b','a','b','a','b'],enemyDeck:['b','a','b','a','b','a']},{a,b,secret});}

describe('AI public observation and legal action contract',()=>{
  it('does not change its observation when secret deck order/RNG/unused definitions change',()=>{
    const state=battle(),changed=structuredClone(state),side=inputSideOf(state),enemy=side==='player'?'enemy':'player';
    changed.zones[side].deck.reverse();changed.zones[enemy].deck.reverse();changed.zones[enemy].hand.reverse();
    changed.rng={state:123456,draws:222};changed.stateHistory=['secret history'];
    const other={...changed,seed:123456,definitions:{...changed.definitions,secret:card('secret',1,1,0)}};
    expect(observeForAi(other,catalogue)).toEqual(observeForAi(state,catalogue));
    const observation=observeForAi(state,catalogue);
    expect(observation.visible.zones[enemy].hand).toEqual([]);
    expect(observation.visible.zones[enemy].deck).toEqual([]);
    expect(observation.catalogue.some(c=>c.cardId==='secret')).toBe(false);
    expect(observation.visible.definitions.secret).toBeUndefined();
  });
  it('samples own reserve multiset and independent reproducible hypotheses',()=>{
    const o=observeForAi(battle(),catalogue),sample=sampleWorld(o,42);
    expect(sampleWorld(o,42)).toEqual(sample);
    expect(sample.zones[o.side].deck.map(id=>sample.instances[id]!.definitionId).sort())
      .toEqual(o.ownReserve.map(c=>c.cardId).sort());
    for(const action of legalActions(o.visible))expect(validateCommand(sample,action).ok).toBe(true);
    expect(sample.rng).not.toEqual(battle().rng);
  });
  it('enumerates full legal choices, and guest windows cannot spend or play',()=>{
    let state=battle();const side=inputSideOf(state),first=state.zones[side].hand[0]!;
    state=applyCommand(state,{kind:'playCard',side,instanceId:first,prepSlot:0}).finalState;
    state.instances[first]!.cd=0;
    expect(legalActions(state).filter(c=>c.kind==='deployCard')).toHaveLength(1);
    state.phase='awaitingResponse';state.currentSide=side==='player'?'enemy':'player';
    const choices=legalActions(state);
    expect(choices.some(c=>c.kind==='deployCard')).toBe(true);
    expect(choices.every(c=>c.kind==='deployCard'||c.kind==='endTurn')).toBe(true);
    for(const c of choices)expect(validateCommand(state,c).ok).toBe(true);
    state.phase='awaitingPriority';
    expect(legalActions(state).map(commandKey)).toEqual([]);
    expect(validateCommand(state,{kind:'choosePriority',side:state.currentSide,order:'first'}).ok).toBe(false);
  });
  it('a sampled decision is reproducible, legal, bounded, and does not modify the live state',()=>{
    const state=battle(),before=structuredClone(state),request={observation:observeForAi(state,catalogue),options:{...DEFAULT_AI,difficulty:'easy' as const},seed:123};
    const result=decideAi(request);
    expect(decideAi(request)).toEqual(result);
    expect(validateCommand(state,result.command).ok).toBe(true);
    expect(result.transitions).toBeLessThanOrEqual(AI_BUDGETS.easy.transitions);
    expect(state).toEqual(before);
  });
  it('rejects incompatible/nonnumeric models and evaluates the documented ReLU network',()=>{
    const raw={format:'card-master-ai',version:1,name:'fixture',kind:'mlp',featureNames:[...FEATURE_NAMES],
      hidden:[FEATURE_NAMES.map((_,i)=>i===0?2:0)],hiddenBias:[-1],output:[3],outputBias:1};
    const m=parseAiModel(raw);
    expect(modelScore(m,FEATURE_NAMES.map((_,i)=>i===0?2:0))).toBe(10);
    expect(()=>parseAiModel({...raw,featureNames:['other']})).toThrow();
    expect(()=>parseAiModel({...raw,hiddenBias:[NaN]})).toThrow();
  });
});
