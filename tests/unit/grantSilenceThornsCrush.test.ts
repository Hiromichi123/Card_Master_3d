import { describe, expect, it } from 'vitest';
import type { CardDefinition, CardInstance, SideId } from '../../src/domain/cards/types';
import type { BattleState } from '../../src/domain/battle/types';
import { createBattle, applyCommand } from '../../src/domain/battle/engine';
import { withModernTraits } from '../../src/domain/skills/modernTraits';
import { consumeConcealment } from '../../src/domain/skills/tacticalTraits';
import { groupOf, isSilenced } from '../../src/domain/skills/rules';
import { resetCardLife } from '../../src/domain/battle/cardLifecycle';

function card(id:string,traits:string[]=[],atk=0,hp=10):CardDefinition {
  return withModernTraits({cardId:id,name:id,rarity:'C',level:5,atk,hp,cd:2,rawTraits:traits,
    skills:traits.map(raw=>({raw,resolution:'implemented' as const,family:raw==='自毁'?'selfDestruct':raw==='不死'?'undying':raw==='复活'?'rebirth':raw==='火球3'?'fireball':null,param:raw==='火球3'?3:null})),
    description:'',status:'complete',art:{artId:id,sourcePresent:false}});
}
function fixture(caster:CardDefinition,enemy=card('enemy')){
  const ally=card('ally'),ally2=card('ally2'),spell=card('spell',['自毁','复活'],0,1),normal=card('normal');
  const definitions=Object.fromEntries([caster,enemy,ally,ally2,spell,normal].map(c=>[c.cardId,c]));
  const state=createBattle({seed:22,playerDeck:[caster.cardId,'ally','ally2'],enemyDeck:[enemy.cardId,'spell','normal']},definitions);
  state.currentSide='player';
  const move=(definitionId:string,owner:SideId,zone:'battle'|'prep',slot:number):CardInstance=>{
    const c=Object.values(state.instances).find(c=>c.definitionId===definitionId&&c.owner===owner)!;
    const z=state.zones[owner];
    z.hand=z.hand.filter(id=>id!==c.instanceId);z.deck=z.deck.filter(id=>id!==c.instanceId);
    z[zone][slot]=c.instanceId;c.zone=zone;c.slotIndex=slot;c.cd=0;return c;
  };
  const source=move(caster.cardId,'player','battle',0),target=move(enemy.cardId,'enemy','battle',0);
  return {state,move,source,target};
}
const end=(state:BattleState)=>applyCommand(state,{kind:'endTurn',side:state.currentSide});

describe('new grant / silence / thorns / crush traits',()=>{
  it('grants unique concealments, consumes one protection and resets on departure',()=>{
    const {state,move,target}=fixture(card('caster',['隐匿赋予2']));move('ally','player','battle',1);move('ally2','player','battle',2);
    const result=end(state),s=result.finalState,gifts=Object.values(s.instances).filter(c=>c.marks.grantedConcealment);
    expect(gifts).toHaveLength(2);expect(new Set(gifts.map(c=>c.instanceId)).size).toBe(2);
    const recipient=gifts[0]!,attacker=s.instances[target.instanceId]!;
    const attack={attacker,defenderSlot:recipient.slotIndex,damage:3,armorBreak:0,dodged:false,dealt:0};
    expect(consumeConcealment({emit:()=>{}},s,recipient,attack)).toBe(true);
    expect(consumeConcealment({emit:()=>{}},s,recipient,{...attack,dodged:false,damage:3})).toBe(false);
    recipient.zone='discard';resetCardLife(s,recipient);expect(recipient.marks.grantedConcealment).toBeUndefined();
  });
  it('silences two complete enemy host actions and survives source silence',()=>{
    const {state,source,target}=fixture(card('caster',['全体沉默2']),card('enemy',['火球3']));
    let s=end(state).finalState;expect(s.instances[target.instanceId]!.marks.silenceUntil).toBe(4);
    s.instances[source.instanceId]!.marks.silenced=true; // Prevent refreshing the test deadline.
    const first=end(s);expect(first.events.some(e=>e.type==='SkillTriggered'&&e.family==='fireball')).toBe(false);s=first.finalState;
    expect(isSilenced(s,'enemy',0)).toBe(true);s=end(s).finalState;
    const second=end(s);expect(second.events.some(e=>e.type==='SkillTriggered'&&e.family==='fireball')).toBe(false);
    expect(second.finalState.instances[target.instanceId]!.marks.silenceUntil).toBeUndefined();
  });
  it('thorn armor reflects n even when defense absorbs all, and works on a lethal hit',()=>{
    for(const spec of [{atk:2,n:3,hp:10},{atk:5,n:2,hp:1}]){
      const {state,source,target}=fixture(card('caster',[],spec.atk),card('enemy',[`刺甲${spec.n}`],0,spec.hp));
      const result=end(state),s=result.finalState;
      expect(groupOf(s,s.instances[source.instanceId]!).hp).toBe(10-spec.n);
      if(spec.hp===1)expect(s.instances[target.instanceId]!.zone).toBe('discard');
      else expect(groupOf(s,s.instances[target.instanceId]!).hp).toBe(10);
    }
  });
  it('concealment prevents thorn retaliation',()=>{
    const {state,source}=fixture(card('caster',[],5),card('enemy',['刺甲3','隐匿']));
    const result=end(state);expect(groupOf(result.finalState,result.finalState.instances[source.instanceId]!).hp).toBe(10);
    expect(result.events.filter(e=>e.type==='DamageApplied'&&e.source==='counter')).toHaveLength(0);
  });
  it('crushes only waiting self-destruct cards without deploying or invoking death/revival hooks',()=>{
    const {state,move}=fixture(card('caster',['粉碎']));const spell=move('spell','enemy','prep',0),normal=move('normal','enemy','prep',1);
    const result=end(state),s=result.finalState;
    expect(s.zones.enemy.prep[0]).toBeNull();expect(s.zones.enemy.prep[1]).toBe(normal.instanceId);
    expect(s.zones.enemy.discard).toContain(spell.instanceId);
    expect(result.events.some(e=>(e.type==='SkillTriggered'||e.type==='CardDeployed'||e.type==='CardDied')&&e.instanceId===spell.instanceId)).toBe(false);
    expect(s.instances[spell.instanceId]!.marks.revivedUsed).toBe(false);
  });
});
