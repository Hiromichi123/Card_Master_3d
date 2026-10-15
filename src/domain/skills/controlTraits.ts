import type { CardInstance } from '../cards/types';
import type { BattleEventPayload, BattleState } from '../battle/types';
import { battleCards, groupOf, hasFamily, isBattleActive, isSilenced, opponentOf } from './rules';

interface ControlResolver { emit(event: BattleEventPayload): void }
/** Offensive skill casts; healing, buffs, defensive mitigation and explicit self-costs stay intact. */
export const CONTROLLED_ATTACK_FAMILIES = new Set([
  'charm','curse','groupSilence','fireball','iceSeal','lightning','groupFireball','groupIceSeal','groupLightning',
  'bombard','groupBombard','explodeOnDeath','alignedDeathBlast','skyCollapse','earthRift',
  'instantDeath','slash','groupSlash','swordDance','groupSwordDance','execute','lethalStrike',
  'piercing','groupPiercing','poisonCloud','counter','severeFrost','burning','venom','bleeding','grievousWound',
  'directDamage','groupPhysicalDamage','splash',
]);
export function isAttackCast(family: string, trigger: string): boolean {
  return CONTROLLED_ATTACK_FAMILIES.has(family) || (family === 'thornArmor' && trigger === 'AFTER_TARGETED_ATTACK');
}
export function puppetController(state: BattleState, card: CardInstance): CardInstance | null {
  if (card.zone !== 'battle') return null;
  const id = state.zones[opponentOf(card.owner)].battle[card.slotIndex];
  const controller = id ? state.instances[id] : undefined;
  return controller && isBattleActive(state, controller) && !groupOf(state,controller).deathHandled
    && hasFamily(state,controller,'puppet') && !isSilenced(state,controller.owner,controller.slotIndex) ? controller : null;
}
export function puppetAllies(state: BattleState, caster: CardInstance): CardInstance[] {
  return battleCards(state,caster.owner).filter(card => card.instanceId !== caster.instanceId && card.stateGroupId !== caster.stateGroupId);
}
export function grantCharm(resolver: ControlResolver, state: BattleState, target: CardInstance, source: CardInstance): void {
  if (!isBattleActive(state,target) || target.marks.charmed) return;
  target.marks.charmed = true;
  resolver.emit({ type:'ControlChanged', side:target.owner, instanceId:target.instanceId,
    sourceInstanceId:source.instanceId, kind:'charm', active:true });
}
/** Recompute from positions, not stale marks, so silence/death/movement affect the next cast immediately. */
export function syncControlState(resolver: ControlResolver, state: BattleState): void {
  for (const card of Object.values(state.instances)) {
    const previous = card.marks.puppetedBy, next = puppetController(state,card)?.instanceId;
    if (previous !== next) {
      if (next) card.marks.puppetedBy = next;
      else delete card.marks.puppetedBy;
      resolver.emit({ type:'ControlChanged', side:card.owner, instanceId:card.instanceId,
        sourceInstanceId:next ?? previous ?? card.instanceId, kind:'puppet', active:next !== undefined });
    }
    if (card.zone !== 'battle' && card.marks.charmed) {
      delete card.marks.charmed;
      resolver.emit({ type:'ControlChanged', side:card.owner, instanceId:card.instanceId,
        sourceInstanceId:card.instanceId, kind:'charm', active:false });
    }
  }
}
