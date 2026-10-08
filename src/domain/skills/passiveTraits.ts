import type { CardInstance } from '../cards/types';
import type { BattleState, BattleEventPayload } from '../battle/types';
import { battleInstances, groupOf, hasFamily, isBattleActive, isSilenced, opponentOf } from './rules';

interface PassiveResolver { emit(event: BattleEventPayload): void; }

/** Property aura; no cast, projectile, damage or spell reflection. */
export function syncFlightState(resolver: PassiveResolver, state: BattleState): void {
  const groundedSide = { player: false, enemy: false };
  for (const side of ['player', 'enemy'] as const) {
    groundedSide[opponentOf(side)] = battleInstances(state, side).some(({ instance }) =>
      isBattleActive(state, instance) && !groupOf(state, instance).deathHandled && hasFamily(state, instance, 'groupGround') &&
      !isSilenced(state, side, instance.slotIndex));
  }
  for (const card of Object.values(state.instances)) {
    const native = state.definitions[card.definitionId]?.rawTraits.includes('飞行') ?? false;
    const flying = native && (card.zone !== 'battle' || !groundedSide[card.owner]);
    if (card.flying === flying) continue;
    card.flying = flying;
    resolver.emit({ type: 'FlightChanged', side: card.owner, instanceId: card.instanceId, flying });
  }
}

/** Track external ATK modifiers separately, so healing removes only missing-HP attack. */
export function rememberBerserkBase(state: BattleState, instanceId: string, nextAtk: number): void {
  const card = state.instances[instanceId];
  if (!card || !hasFamily(state, card, 'berserk')) return;
  const group = groupOf(state, card);
  group.berserkBaseAtk = nextAtk - (group.berserkBonus ?? 0);
}

/** Immediate and reversible: ATK = other-modified base ATK + max(0, maxHP - currentHP). */
export function syncBerserk(resolver: PassiveResolver, state: BattleState, card: CardInstance,
  hp = groupOf(state, card).hp): void {
  if (!hasFamily(state, card, 'berserk')) return;
  const group = groupOf(state, card);
  const before = group.atk;
  const base = group.berserkBaseAtk ?? before - (group.berserkBonus ?? 0);
  const bonus = Math.max(0, group.maxHp - Math.max(0, hp));
  group.berserkBaseAtk = base;
  group.berserkBonus = bonus;
  group.atk = Math.max(0, base + bonus);
  if (group.atk !== before) resolver.emit({ type: 'StatChanged', side: card.owner,
    instanceId: card.instanceId, stat: 'atk', from: before, to: group.atk, cause: 'berserk' });
}
