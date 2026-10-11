import { describe, expect, it } from 'vitest';
import { initializeDeckSlots, validDeckSlots } from '../../src/domain/progression/deckSlots';
import { migrateToCurrent } from '../../src/domain/progression/migrations';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { normalizeProfile } from '../../src/domain/progression/saveTransfer';
import { SAVE_SCHEMA_VERSION, type ProfileState } from '../../src/domain/progression/types';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import { ProfileStore } from '../../src/state/createProfileStore';

const now = new Date('2026-10-11T12:00:00Z');
const ctx = { knownCardIds: new Set(['a']), contentVersion: 'test', dayKey: '20261011', now };
const fresh = () => createInitialProfile({ ...ctx, starterCardIds: ['a'] });
async function storeFor(initial: ProfileState) {
  const repository = new MemorySaveRepository(initial);
  const store = new ProfileStore({ repository, contentVersion: 'test', clock: () => now,
    seedSource: () => 1, starterCardIds: ['a'], knownCardIds: ctx.knownCardIds });
  await store.load();
  return { store, repository };
}

describe('schema5天梯领奖账本', () => {
  it('新档和新固定槽初始化空账本，不自动发奖', () => {
    const profile = fresh();
    expect(SAVE_SCHEMA_VERSION).toBe(SAVE_SCHEMA_VERSION);
    expect(profile.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(profile.ladder.claimedTierFloors).toEqual([]);
    expect(initializeDeckSlots([], null).ladder.claimedTierFloors).toEqual([]);
    expect(profile.currencies.crystal).toBe(300);
    expect(profile.inventory).toEqual({ a: 1 });
  });

  it('v4只补空账本，保留积分、卡组映射、其他奖励/迷宫记录，反复迁移幂等', () => {
    const profile = fresh();
    const old = { ...profile, schemaVersion: 4,
      ladder: { points: 2100, deckId: profile.ladder.deckId },
      rewards: { claimedStoryIds: ['1-1'], checkIn: [{ day: 1, dayKey: '20261010' }] },
      mazeProgress: { ...profile.mazeProgress, explorationCount: 73, lastResetWeek: '20261005' },
    };
    const migrated = migrateToCurrent(old, 4);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const next = migrated.value as ProfileState;
    expect(next).toEqual({ ...old, schemaVersion: SAVE_SCHEMA_VERSION, ladder: { ...old.ladder, claimedTierFloors: [] } });
    expect(migrated.warnings).toEqual(['已从 v4 迁移到 v5。', '已从 v5 迁移到 v6。']);
    const claimed = { ...next, ladder: { ...next.ladder, claimedTierFloors: [0, 300] } };
    const again = migrateToCurrent(claimed, SAVE_SCHEMA_VERSION);
    expect(again.ok && again.value).toEqual(claimed);
  });

  it('v1/v2/v3都爬链到当前版本，保留旧库存并补四槽和领奖账本', () => {
    const p = fresh();
    for (const version of [1, 2, 3]) {
      const old = { ...p, schemaVersion: version, decks: [p.decks[0]], normalDeckIds: undefined, ladder: undefined };
      const normalized = normalizeProfile(old, ctx);
      expect(normalized.ok).toBe(true);
      if (!normalized.ok) continue;
      expect(normalized.profile.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
      expect(normalized.profile.inventory).toEqual(p.inventory);
      expect(normalized.profile.ladder.claimedTierFloors).toEqual([]);
      expect(normalized.profile.decks).toHaveLength(4);
    }
  });

  it('v5导入与加载拒绝缺失、重复、非数字和不存在的档位，不静默清空', async () => {
    const p = fresh();
    for (const claimedTierFloors of [undefined, null, '0', [0, 0], [123], ['300'], [NaN], [-300], [0.5]]) {
      const invalid = { ...p, ladder: { ...p.ladder, claimedTierFloors } };
      expect(validDeckSlots(p.decks, p.normalDeckIds, invalid.ladder, p.activeDeckId)).toBe(false);
      expect(normalizeProfile(invalid, ctx).ok).toBe(false);
      const { store, repository } = await storeFor(invalid as unknown as ProfileState);
      expect(store.getSnapshot().status).toBe('error');
      expect(store.getSnapshot().profile).toBeNull();
      expect(repository.commitCount).toBe(0);
      store.dispose();
    }
  });

  it('自动加载v4补账本，完整导出/导入/重载保留已领且允许积分回落', async () => {
    const p = fresh();
    const old = { ...p, schemaVersion: 4, ladder: { points: 2500, deckId: p.ladder.deckId } };
    const loaded = await storeFor(old as ProfileState);
    expect(loaded.store.getSnapshot().profile!.ladder.claimedTierFloors).toEqual([]);
    loaded.store.dispose();
    const claimed: ProfileState = { ...p, ladder: { ...p.ladder, points: 0, claimedTierFloors: [0, 2400] } };
    const source = await storeFor(claimed);
    const exported = await source.store.exportProfile();
    expect(exported).not.toBeNull();
    const target = await storeFor(fresh());
    const imported = await target.store.importProfile([{ name: 'ladder.json', text: exported! }]);
    expect(imported.ok).toBe(true);
    expect(target.store.getSnapshot().profile!.ladder).toEqual(claimed.ladder);
    const reloaded = await storeFor(target.repository.peek()!);
    expect(reloaded.store.getSnapshot().profile!.ladder.claimedTierFloors).toEqual([0, 2400]);
    source.store.dispose(); target.store.dispose(); reloaded.store.dispose();
  });
});
