import { describe, expect, it } from 'vitest';
import { cardDatabase } from '../../src/data';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { activityOf, battleCountOf, noviceTasks, normalizeActivity, initialActivity, planNoviceClaim } from '../../src/domain/progression/playerActivity';
import { migrateToCurrent } from '../../src/domain/progression/migrations';

const fresh = () => createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261014', starterCardIds: ['D_002'], now: new Date('2026-10-14T00:00:00Z') });
describe('player records and novice rewards', () => {
  it('ten-pull counters and inventory commit together; rejected payments do not count', () => {
    const profile = fresh();
    const tx = { operationId: 'pull', currencyDelta: { gold: -100 }, inventoryDelta: { D_002: 10 }, activityEvent: { kind: 'draw' as const, count: 10, poolId: 'test' } };
    const saved = applyEconomyTransaction(profile, tx);
    expect(saved.applied).toBe(true); expect(activityOf(saved.profile).draws).toBe(10);
    expect(saved.profile.gacha.pullsByPool.test).toBe(10);
    const rejected = applyEconomyTransaction(profile, { ...tx, currencyDelta: { gold: -1000000 } });
    expect(rejected.applied).toBe(false); expect(activityOf(rejected.profile).draws).toBe(0);
  });
  it('fixed and repeat rewards persist independently and cannot be claimed twice', () => {
    const profile = { ...fresh(), settledBattleIds: Array.from({ length: 40 }, (_, i) => `local:${i}`) };
    const plan = planNoviceClaim(profile, 'battle', false, 0, cardDatabase.definitions);
    if ('rejected' in plan) throw new Error(plan.rejected);
    const saved = applyEconomyTransaction(profile, plan.transaction);
    expect(saved.profile.currencies.crystal).toBe(profile.currencies.crystal + 100);
    expect(applyEconomyTransaction(saved.profile, plan.transaction).applied).toBe(false);
    const repeat = planNoviceClaim(saved.profile, 'battle', true, 0, cardDatabase.definitions);
    if ('rejected' in repeat) throw new Error(repeat.rejected);
    const again = applyEconomyTransaction(saved.profile, repeat.transaction);
    expect(noviceTasks(again.profile, 'battle')[3]!.target).toBe(40);
    expect(applyEconomyTransaction(again.profile, repeat.transaction).applied).toBe(false);
  });
  it('abyss records do not unlock normal battle missions', () => {
    expect(battleCountOf({ ...fresh(), settledBattleIds: ['local:1', 'local:1', 'abyss:1'] })).toBe(1);
  });
  it('fusion rewards use the requested tier and failed claims retain materials and ledger', () => {
    const base = fresh(), profile = { ...base, activity: { ...activityOf(base), fusions: 30 } };
    for (const [index, rarity] of ['B', 'A', 'S'].entries()) {
      const first = planNoviceClaim(profile, 'fusion', false, index, cardDatabase.definitions);
      const retry = planNoviceClaim(profile, 'fusion', false, index, cardDatabase.definitions);
      expect(first).toEqual(retry);
      if ('rejected' in first) throw new Error(first.rejected);
      expect(cardDatabase.definitions.find(c => c.cardId === first.view.cardId)?.rarity).toBe(rarity);
    }
  });
  it('v7 migration keeps records and does not fabricate old fusion count', () => {
    const old = { ...fresh(), schemaVersion: 7, activity: undefined, gacha: { pullsByPool: { x: 12 } } };
    const migrated = migrateToCurrent(old, 7);
    expect(migrated.ok).toBe(true);
    if (migrated.ok) expect(migrated.value).toMatchObject({ schemaVersion: 8, activity: { draws: 12, fusions: 0 } });
    expect(normalizeActivity({ ...initialActivity({}), claimedFixed: ['battle:0', 'battle:0'] }, initialActivity({}))).toBeNull();
  });
});
