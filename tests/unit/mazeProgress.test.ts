import { describe, expect, it } from 'vitest';
import { createInitialProfile, withMazeRun } from '../../src/domain/progression/profile';
import { emptyMazeProgress, mazeProgressToken, mazeResetRemaining, settleMazeGuarantees, validateMazeState } from '../../src/domain/progression/mazeProgress';
import { weekKeyOf } from '../../src/domain/progression/clock';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { generateMaze, mazeRngFor, newMazeRun, withShopState } from '../../src/domain/progression/maze';
import { migrateToCurrent } from '../../src/domain/progression/migrations';
import { normalizeProfile } from '../../src/domain/progression/saveTransfer';
import type { Planned } from '../../src/domain/progression/plan';
import { SAVE_SCHEMA_VERSION, type ProfileState } from '../../src/domain/progression/types';
import { mazeEventCards, planMazeEnter, planMazeMove, planMazeReset } from '../../src/scenes/mazeFlow';
import { ProfileStore } from '../../src/state/createProfileStore';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import { FailingSaveRepository } from '../../src/services/save/FailingSaveRepository';
import type { SaveRepository } from '../../src/services/save/SaveRepository';

const map = generateMaze(mazeRngFor('floor1', 1));
const neighbor = map.nodes[map.entryId]!.neighbors[0]!;
function fresh(): ProfileState {
  return createInitialProfile({ contentVersion: 'test', dayKey: '20261011', starterCardIds: [], now: new Date(2026, 9, 11) });
}
function started(count = 0): ProfileState {
  return { ...fresh(), mazeRun: newMazeRun(map, 'floor1', 1), mazeProgress: { ...emptyMazeProgress(), explorationCount: count } };
}
function accepted<T>(plan: Planned<T>) {
  if ('rejected' in plan) throw new Error(plan.rejected);
  return plan;
}
function move(profile: ProfileState, nodeId = neighbor, operationId = 'move') {
  return accepted(planMazeMove({ profile, nodeId, operationId, expectedToken: mazeProgressToken(profile) }));
}
function reset(profile: ProfileState, dayKey = '20261011', operationId = 'reset') {
  return planMazeReset({ profile, dayKey, operationId, expectedToken: mazeProgressToken(profile) });
}
async function storeFor(repository: SaveRepository, clock = () => new Date(2026, 9, 11, 23, 59)) {
  const store = new ProfileStore({ repository, clock, seedSource: () => 7, contentVersion: 'test', starterCardIds: [], debounceMs: 0 });
  await store.load();
  return store;
}
const ctx = { knownCardIds: new Set<string>(), contentVersion: 'test', dayKey: '20261011', now: new Date(2026, 9, 11) };

describe('探索保底与周额度', () => {
  it('入口不计，首次探索+1，原路往返不计，旧回调不能重放', () => {
    const p = fresh(), enter = accepted(planMazeEnter({ profile: p, operationId: 'enter' }));
    const initial = applyEconomyTransaction(p, enter.transaction).profile;
    expect(initial.mazeProgress.explorationCount).toBe(0);
    const planned = move(initial);
    const next = applyEconomyTransaction(initial, planned.transaction).profile;
    expect(next.mazeProgress.explorationCount).toBe(1);
    expect(next.mazeRun!.exploredNodeIds).toContain(neighbor);
    expect(applyEconomyTransaction(next, planned.transaction).applied).toBe(false);
    const back = applyEconomyTransaction(next, move(next, map.entryId, 'back').transaction).profile;
    const revisit = applyEconomyTransaction(back, move(back, neighbor, 'revisit').transaction).profile;
    expect(revisit.mazeProgress.explorationCount).toBe(1);
    expect(applyEconomyTransaction(revisit, planned.transaction).applied).toBe(false);
  });

  it('99→100在同笔事务发一张完整活动卡，稳定重试且允许重复拥有', () => {
    const p = started(99), planned = move(p);
    expect(mazeEventCards().length).toBeGreaterThan(0);
    const cardId = planned.view.rewardCardIds[0]!;
    expect(planned.view.rewardCardIds).toHaveLength(1);
    expect(mazeEventCards()).toContain(cardId);
    expect(move(p, neighbor, 'another-operation').view.rewardCardIds).toEqual(planned.view.rewardCardIds);
    const owned = { ...p, inventory: { [cardId]: 2 } };
    const next = applyEconomyTransaction(owned, move(owned).transaction).profile;
    expect(next.inventory[cardId]).toBe(3);
    expect(next.mazeProgress).toMatchObject({ explorationCount: 0, awardedCount: 1, lastRewardCardId: cardId });
    const battleDrop = applyEconomyTransaction(next, { operationId: 'battle', currencyDelta: {}, inventoryDelta: { [cardId]: 1 } }).profile;
    expect(battleDrop.mazeProgress).toEqual(next.mazeProgress);
  });

  it('空池累计超过100也不吞，进入事务能连续补发而不要求新格', () => {
    const p = started(205);
    const pending = settleMazeGuarantees(p.mazeProgress, p.mazeRun!, []);
    expect(pending.progress.explorationCount).toBe(205);
    expect(pending.rewardCardIds).toEqual([]);
    const entered = accepted(planMazeEnter({ profile: p, operationId: 'catch-up' }));
    const next = applyEconomyTransaction(p, entered.transaction).profile;
    expect(entered.view.rewardCardIds).toHaveLength(2);
    expect(next.mazeProgress).toMatchObject({ explorationCount: 5, awardedCount: 2 });
    expect(next.mazeRun!.exploredNodeIds).toEqual(p.mazeRun!.exploredNodeIds);
    expect(applyEconomyTransaction(next, entered.transaction).applied).toBe(false);
  });

  it('周一恢复、跨年正确、未用不累计、倒拨不恢复；清空保留保底', () => {
    expect(weekKeyOf('20261011')).toBe('20261005');
    expect(weekKeyOf('20261012')).toBe('20261012');
    expect(weekKeyOf('20270101')).toBe('20261228');
    expect(weekKeyOf('20270104')).toBe('20270104');
    expect(weekKeyOf('20260230')).toBeNull();
    const p = started(42), planned = accepted(reset(p));
    const next = applyEconomyTransaction(p, planned.transaction).profile;
    expect(next.mazeProgress).toMatchObject({ explorationCount: 42, lastResetWeek: '20261005' });
    expect(next.mazeRun!.version).toBe(2);
    expect(next.mazeRun!.exploredNodeIds).toEqual([0]);
    expect(next.mazeRun!.shopByNode).toEqual({});
    expect(reset(next)).toHaveProperty('rejected');
    expect(applyEconomyTransaction(next, planned.transaction).applied).toBe(false);
    expect(mazeResetRemaining(next.mazeProgress, '20261004')).toBe(0);
    expect(mazeResetRemaining(next.mazeProgress, '20261012')).toBe(1);
    expect(mazeResetRemaining(next.mazeProgress, '20271101')).toBe(1);
  });

  it('防抖路径不能移动、扩大探索、清null或提高版本绕过周清空', () => {
    const p = started(99);
    for (const run of [null, { ...p.mazeRun!, version: 2 }, { ...p.mazeRun!, playerNodeId: neighbor, exploredNodeIds: [0, neighbor] }]) {
      expect(withMazeRun(p, run)).toBe(p);
    }
    expect(planMazeMove({ profile: p, nodeId: -1, expectedToken: mazeProgressToken(p), operationId: 'bad' })).toHaveProperty('rejected');
  });
});

describe('探索事务真实存档', () => {
  it('失败不移动、不发卡、不扣周额度；成功重复请求拒绝，重载一致', async () => {
    const p = started(99), disk = new MemorySaveRepository(p);
    const failing = await storeFor(new FailingSaveRepository(disk));
    try {
      const before = failing.getSnapshot().profile!;
      expect(await failing.commitEconomic(current => move(current))).toMatchObject({ ok: false, reason: 'saveFailed' });
      expect(await failing.commitEconomic(current => reset(current))).toMatchObject({ ok: false, reason: 'saveFailed' });
      expect(failing.getSnapshot().profile).toBe(before);
      expect(disk.peek()).toEqual(p);
    } finally { failing.dispose(); }
    const store = await storeFor(disk);
    try {
      const planned = move(store.getSnapshot().profile!);
      expect((await store.commitEconomic(() => planned)).ok).toBe(true);
      expect((await store.commitEconomic(() => planned)).ok).toBe(false);
      expect(disk.commitCount).toBe(1);
      const loaded = await storeFor(disk);
      try { expect(loaded.getSnapshot().profile).toEqual(store.getSnapshot().profile); }
      finally { loaded.dispose(); }
    } finally { store.dispose(); }
  });

  it('注入时钟跨周可再清空一次，重复请求不多扣', async () => {
    let now = new Date(2026, 9, 11, 23, 59);
    const disk = new MemorySaveRepository(started(42));
    const store = await storeFor(disk, () => new Date(now));
    try {
      expect((await store.commitEconomic(p => reset(p, store.todayKey(), 'week-a'))).ok).toBe(true);
      expect((await store.commitEconomic(p => reset(p, store.todayKey(), 'same-week'))).ok).toBe(false);
      now = new Date(2026, 9, 12, 0, 0);
      expect((await store.commitEconomic(p => reset(p, store.todayKey(), 'week-b'))).ok).toBe(true);
      expect(store.getSnapshot().profile!.mazeRun!.version).toBe(3);
      expect(store.getSnapshot().profile!.mazeProgress.explorationCount).toBe(42);
      expect(disk.commitCount).toBe(2);
    } finally { store.dispose(); }
  });
});

describe('迷宫迁移与导入', () => {
  it('v1→v2→v3、v2→v3保留旧run但保底从零开始', () => {
    for (const schemaVersion of [1, 2]) {
      const old = { ...started(99), schemaVersion, mazeProgress: undefined };
      const migrated = migrateToCurrent(old, schemaVersion);
      expect(migrated.ok).toBe(true);
      if (!migrated.ok) continue;
      expect(migrated.value).toMatchObject({ schemaVersion: SAVE_SCHEMA_VERSION, mazeProgress: emptyMazeProgress(), mazeRun: old.mazeRun });
      expect(migrated.warnings).toHaveLength(SAVE_SCHEMA_VERSION - schemaVersion);
    }
  });

  it('有效run、已探索、旧新货架售罄、进度和周额度一起往返', () => {
    const node = map.nodes.find(n => n.type === 'supply')!;
    const run = withShopState({ ...newMazeRun(map, 'floor1', 1), playerNodeId: node.id, exploredNodeIds: [0, node.id] }, node.id);
    const shop = run.shopByNode[String(node.id)]!;
    const p = { ...started(35), mazeRun: { ...run, shopByNode: { [String(node.id)]: { ...shop, soldOut: ['legacy|card'] } } }, mazeProgress: { ...emptyMazeProgress(), explorationCount: 35, lastResetWeek: '20261005' } };
    const result = normalizeProfile(JSON.parse(JSON.stringify(p)), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.mazeRun).toEqual(p.mazeRun);
    expect(result.profile.mazeProgress).toEqual(p.mazeProgress);
    expect(result.issues).toEqual([]);
    const legacy = { ...p, mazeRun: { ...p.mazeRun, shopByNode: { [String(node.id)]: { dayKey: shop.dayKey, seed: shop.seed, soldOut: ['old'] } } } };
    expect(normalizeProfile(legacy, ctx)).toMatchObject({ ok: true, profile: { mazeRun: legacy.mazeRun } });
  });

  it('有历史不能丢run或损坏探索集合，异常账本不能静默清零', () => {
    const p = started(20);
    for (const bad of [
      { ...p, mazeRun: null },
      { ...p, mazeRun: { ...p.mazeRun!, exploredNodeIds: [] } },
      { ...p, mazeRun: { ...p.mazeRun!, playerNodeId: 999 } },
      { ...p, mazeProgress: { ...p.mazeProgress, explorationCount: -1 } },
      { ...p, mazeProgress: { ...p.mazeProgress, explorationCount: 1.2 } },
      { ...p, mazeProgress: { ...p.mazeProgress, lastResetWeek: '20261011' } },
      { ...p, mazeProgress: undefined },
    ]) expect(normalizeProfile(bad, ctx)).toMatchObject({ ok: false, reason: 'invalidShape' });
    expect(validateMazeState(null, emptyMazeProgress(), ['maze:floor1:v1:boss'])).toBeNull();
    expect(normalizeProfile(fresh(), ctx).ok).toBe(true);
  });
});
