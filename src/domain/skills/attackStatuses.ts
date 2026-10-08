import type { AttackStatusKind, AttackAffliction, CardInstance } from '../cards/types';
import type { BattleState, BattleEventPayload } from '../battle/types';
import { groupOf, isBattleActive } from './rules';

export interface StatusResolver {
  emit(event: BattleEventPayload): void;
  damage(target: CardInstance, amount: number): number;
}

export const attackTick = (state: BattleState): number => state.turnIndex;

/** One complete opportunity to act; refreshing a mark never duplicates its ATK debt. */
export function grantAttackStatus(resolver: StatusResolver, state: BattleState, target: CardInstance,
  source: CardInstance, kind: AttackStatusKind, level: number, animate = true): void {
  if (!isBattleActive(state, target) || level <= 0) return;
  const statuses = target.marks.attackStatuses ??= {};
  const previous = statuses[kind];
  const status: AttackAffliction = {
    kind, level: Math.max(level, previous?.level ?? 0), sourceId: source.instanceId,
    expiresAt: attackTick(state) + (target.owner === state.currentSide ? 2 : 1),
    atkLoss: previous?.atkLoss ?? 0,
    atkRestores: [...(previous?.atkRestores ?? [])],
  };
  statuses[kind] = status;
  resolver.emit({ type: 'AttackStatusApplied', side: target.owner, instanceId: target.instanceId,
    sourceInstanceId: source.instanceId, kind, level: status.level, animate });
}

/** Captured before the lunge: newly received retaliation cannot trigger on that same attack. */
export function triggerAttackStatuses(resolver: StatusResolver, state: BattleState, card: CardInstance,
  snapshot: readonly AttackAffliction[]): void {
  for (const captured of snapshot) {
    if (!isBattleActive(state, card)) break;
    const status = card.marks.attackStatuses?.[captured.kind];
    if (!status) continue;
    resolver.emit({ type: 'AttackStatusTriggered', side: card.owner, instanceId: card.instanceId,
      kind: captured.kind, level: captured.level });
    if (captured.kind === 'grievous') {
      const group = groupOf(state, card);
      const before = group.atk;
      const loss = Math.min(before, captured.level);
      group.atk -= loss;
      status.atkLoss += loss;
      if (loss > 0) (status.atkRestores ??= []).push({ amount: loss, expiresAt: captured.expiresAt });
      resolver.emit({ type: 'StatChanged', side: card.owner, instanceId: card.instanceId,
        stat: 'atk', from: before, to: group.atk, cause: 'grievous' });
    } else resolver.damage(card, captured.level);
  }
}

export function clearAttackStatuses(resolver: StatusResolver, state: BattleState, card: CardInstance,
  expiredOnly = false): void {
  for (const status of Object.values(card.marks.attackStatuses ?? {})) {
    if (!status) continue;
    if (expiredOnly && card.owner !== state.currentSide) continue;
    const restore = expiredOnly
      ? (status.atkRestores ?? []).filter((debt) => debt.expiresAt <= attackTick(state)).reduce((sum, debt) => sum + debt.amount, 0)
      : status.atkLoss;
    if (restore > 0) {
      const group = groupOf(state, card);
      const before = group.atk;
      group.atk += restore;
      resolver.emit({ type: 'StatChanged', side: card.owner, instanceId: card.instanceId,
        stat: 'atk', from: before, to: group.atk, cause: 'grievousRestore' });
    }
    status.atkLoss -= restore;
    status.atkRestores = expiredOnly ? (status.atkRestores ?? []).filter((debt) => debt.expiresAt > attackTick(state)) : [];
    if (expiredOnly && status.expiresAt > attackTick(state)) continue;
    delete card.marks.attackStatuses?.[status.kind];
    resolver.emit({ type: 'AttackStatusExpired', side: card.owner, instanceId: card.instanceId, kind: status.kind });
  }
}
