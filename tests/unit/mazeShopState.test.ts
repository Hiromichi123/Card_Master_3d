import { describe, expect, it } from 'vitest';

import { cardDatabase, shops } from '../../src/data';
import { createRng } from '../../src/domain/battle/rng';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { fixedClock } from '../../src/domain/progression/clock';
import { buildMazeShop, generateMaze, MAZE_FLOOR_1, mazeRngFor, mazeShopBatchKey, mazeShopKey, mazeShopSeed, newMazeRun, newMazeShopState, withShopState } from '../../src/domain/progression/maze';
import { createInitialProfile, withMazeRun } from '../../src/domain/progression/profile';
import type { Planned } from '../../src/domain/progression/plan';
import type { ProfileState } from '../../src/domain/progression/types';
import { mazeCardsByRarity, mazeShopStock, planMazePurchase, planMazeRefresh } from '../../src/scenes/mazeFlow';
import { ProfileStore } from '../../src/state/createProfileStore';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import { FailingSaveRepository } from '../../src/services/save/FailingSaveRepository';
import type { SaveRepository } from '../../src/services/save/SaveRepository';

const map = generateMaze(mazeRngFor(MAZE_FLOOR_1, 1));
const nodeId = map.nodes.find(node => node.type === 'supply')!.id;
const otherId = map.nodes.find(node => node.type === 'supply' && node.id !== nodeId)!.id;
const run = withShopState(withShopState({ ...newMazeRun(map, MAZE_FLOOR_1, 1), playerNodeId: nodeId, exploredNodeIds: [0, nodeId, otherId] }, nodeId), otherId);
function profile(): ProfileState {
  return { ...createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261011', starterCardIds: [], now: new Date('2026-10-11T00:00:00Z') }),
    mazeRun: run, currencies: { gold: 100000, crystal: 100000, badge: 100000 } };
}
function accepted<T>(planned: Planned<T>) {
  if ('rejected' in planned) throw new Error(planned.rejected);
  return planned;
}
function purchase(p: ProfileState, index = 0) {
  return accepted(planMazePurchase({ profile: p, nodeId, entry: mazeShopStock(p.mazeRun!, nodeId)[index]!.entry,
    expectedBatch: mazeShopBatchKey(p.mazeRun!, nodeId), operationId: `buy-${index}`, rng: createRng(7) }));
}
function refresh(p: ProfileState) {
  return accepted(planMazeRefresh({ profile: p, nodeId, expectedBatch: mazeShopBatchKey(p.mazeRun!, nodeId), operationId: 'refresh' }));
}

async function loadStore(repository: SaveRepository) {
  const store = new ProfileStore({ repository, clock: fixedClock(new Date('2026-10-11T00:00:00Z')),
    seedSource: () => 7, contentVersion: cardDatabase.contentVersion, starterCardIds: [], debounceMs: 5 });
  await store.load();
  return store;
}

describe('世界树迷宫货架批次与购买', () => {
  it('legacy货架沿用旧派生种子/顺序/价格/ID，保存的历史seed不改变商品', () => {
    const legacyRun = { ...run, shopByNode: { ...run.shopByNode, [String(nodeId)]: {
      dayKey: mazeShopKey(run.floorKey, run.version, nodeId), seed: 123, soldOut: [] as string[],
    } } };
    const oldItems = buildMazeShop({ rng: createRng(mazeShopSeed(run.floorKey, run.version, nodeId)), legacy: true,
      cardsByRarity: mazeCardsByRarity(), priceByRarity: shops.normalShop!.priceByRarity, fallbackPrice: shops.normalShop!.unknownRarityFallback });
    const stock = mazeShopStock(legacyRun, nodeId);
    expect(stock.map(slot => slot.item)).toEqual(oldItems);
    expect(stock).toHaveLength(3);
    expect(stock.map(slot => slot.entry.entryId)).toEqual(oldItems.map((item, index) => `${index}|${item.cardId}`));
    const boughtRun = { ...legacyRun, shopByNode: { ...legacyRun.shopByNode, [String(nodeId)]: {
      ...legacyRun.shopByNode[String(nodeId)]!, soldOut: [stock[0]!.entry.entryId],
    } } };
    expect(withShopState(boughtRun, nodeId)).toBe(boughtRun);
    expect(mazeShopStock(boughtRun, nodeId)[0]!.entry.soldOut).toBe(true);
    const upgraded = applyEconomyTransaction({ ...profile(), mazeRun: boughtRun }, refresh({ ...profile(), mazeRun: boughtRun }).transaction).profile;
    expect(upgraded.mazeRun!.shopByNode[String(nodeId)]!.catalogVersion).toBe(2);
    expect(upgraded.mazeRun!.shopByNode[String(nodeId)]!.soldOut).toEqual([]);
    expect(mazeShopStock(upgraded.mazeRun!, nodeId).every(slot => !stock.some(old => old.entry.entryId === slot.entry.entryId))).toBe(true);
  });

  it('购买以最新货架为准，不信任传入价格/卡牌/售罄', () => {
    const p = profile(), slot = mazeShopStock(run, nodeId)[0]!;
    const planned = accepted(planMazePurchase({ profile: p, nodeId, expectedBatch: mazeShopBatchKey(run, nodeId),
      entry: { ...slot.entry, cardId: 'forged', price: { currency: 'gold', amount: 0 }, soldOut: true },
      operationId: 'forged', rng: createRng(1) }));
    expect(planned.transaction.currencyDelta).toEqual({ [slot.item.price.currency]: -slot.item.price.amount });
    expect(planned.transaction.inventoryDelta).toEqual({ [slot.item.cardId]: 1 });
    const result = applyEconomyTransaction(p, planned.transaction);
    expect(result.applied).toBe(true);
    expect(result.profile.shop).toEqual(p.shop);
    expect(result.profile.mazeRun!.shopByNode[String(nodeId)]!.soldOut).toEqual([slot.entry.entryId]);
    expect(applyEconomyTransaction(result.profile, planned.transaction)).toMatchObject({ applied: false, reason: 'mazeShopChanged' });
    expect(planMazePurchase({ profile: result.profile, nodeId, expectedBatch: mazeShopBatchKey(run, nodeId), entry: slot.entry, operationId: 'repeat', rng: createRng(1) })).toHaveProperty('rejected');
  });

  it('1金币优惠严格只扣1金币，包括原价为水晶的卡', () => {
    let checked = false;
    for (let count = 0; count < 500; count += 1) {
      const candidate = { ...run, shopByNode: { ...run.shopByNode, [String(nodeId)]: newMazeShopState(run, nodeId, count) } };
      const slot = mazeShopStock(candidate, nodeId).find(item => item.item.discount === 'oneGold' && item.item.originalPrice.currency === 'crystal');
      if (!slot) continue;
      const p = { ...profile(), mazeRun: candidate, currencies: { gold: 1, crystal: 0, badge: 0 } };
      const planned = accepted(planMazePurchase({ profile: p, nodeId, expectedBatch: mazeShopBatchKey(candidate, nodeId), entry: slot.entry, operationId: 'one-gold', rng: createRng(1) }));
      expect(planned.transaction.currencyDelta).toEqual({ gold: -1 });
      const bought = applyEconomyTransaction(p, planned.transaction);
      expect(bought.applied).toBe(true);
      expect(bought.profile.currencies).toEqual({ gold: 0, crystal: 0, badge: 0 });
      expect(bought.profile.inventory[slot.item.cardId]).toBe((p.inventory[slot.item.cardId] ?? 0) + 1);
      checked = true;
      break;
    }
    expect(checked).toBe(true);
  });

  it('免费刷新只替换目标节点批次；旧entry、旧批次事务及旧run都不能购买', () => {
    const p = profile(), oldPurchase = purchase(p), planned = refresh(p);
    expect(planned.transaction.currencyDelta).toEqual({});
    expect(planned.transaction.inventoryDelta).toEqual({});
    const updated = applyEconomyTransaction(p, planned.transaction).profile;
    expect(updated.currencies).toEqual(p.currencies);
    expect(updated.inventory).toEqual(p.inventory);
    expect(updated.mazeRun!.shopByNode[String(otherId)]).toEqual(run.shopByNode[String(otherId)]);
    expect(mazeShopBatchKey(updated.mazeRun!, nodeId)).not.toBe(mazeShopBatchKey(run, nodeId));
    expect(updated.mazeRun!.shopByNode[String(nodeId)]!.refreshCount).toBe(1);
    expect(applyEconomyTransaction(updated, oldPurchase.transaction).applied).toBe(false);
    expect(applyEconomyTransaction(updated, planned.transaction).applied).toBe(false);
    const oldEntry = mazeShopStock(run, nodeId)[0]!.entry;
    expect(planMazePurchase({ profile: updated, nodeId, entry: oldEntry, expectedBatch: mazeShopBatchKey(updated.mazeRun!, nodeId), operationId: 'stale-entry', rng: createRng(1) })).toHaveProperty('rejected');
    const nextRun = newMazeRun(generateMaze(mazeRngFor(MAZE_FLOOR_1, 2)), MAZE_FLOOR_1, 2);
    expect(applyEconomyTransaction({ ...p, mazeRun: nextRun }, oldPurchase.transaction).applied).toBe(false);
    expect(mazeShopStock(JSON.parse(JSON.stringify(updated.mazeRun)), nodeId)).toEqual(mazeShopStock(updated.mazeRun!, nodeId));
  });

  it('缺失run、非当前节点和非补给格在计划层拒绝，失效事务不扣款发卡', () => {
    const p = profile(), entry = mazeShopStock(run, nodeId)[0]!.entry;
    for (const invalid of [{ ...p, mazeRun: null }, { ...p, mazeRun: { ...run, playerNodeId: otherId } }]) {
      expect(planMazePurchase({ profile: invalid, nodeId, entry, expectedBatch: mazeShopBatchKey(run, nodeId), operationId: 'bad', rng: createRng(1) })).toHaveProperty('rejected');
      expect(planMazeRefresh({ profile: invalid, nodeId, expectedBatch: mazeShopBatchKey(run, nodeId), operationId: 'bad-refresh' })).toHaveProperty('rejected');
      const outcome = applyEconomyTransaction(invalid, purchase(p).transaction);
      expect(outcome.applied).toBe(false); expect(outcome.profile).toBe(invalid);
    }
    const invalidRun = withShopState({ ...run, playerNodeId: 0 }, 0);
    expect(planMazeRefresh({ profile: { ...p, mazeRun: invalidRun }, nodeId: 0, expectedBatch: mazeShopBatchKey(invalidRun, 0), operationId: 'entry' })).toHaveProperty('rejected');
  });

  it('购买后旧移动存档不恢复售罄，刷新后旧移动存档不恢复旧批次', () => {
    const p = profile(), purchased = applyEconomyTransaction(p, purchase(p).transaction).profile;
    const oldMovement = { ...run, playerNodeId: otherId, exploredNodeIds: [0, nodeId, otherId] };
    const moved = withMazeRun(purchased, oldMovement);
    expect(moved).toBe(purchased);
    expect(moved.mazeRun!.playerNodeId).toBe(nodeId);
    expect(moved.mazeRun!.shopByNode[String(nodeId)]).toEqual(purchased.mazeRun!.shopByNode[String(nodeId)]);
    const refreshed = applyEconomyTransaction(purchased, refresh(purchased).transaction).profile;
    expect(withMazeRun(refreshed, oldMovement).mazeRun!.shopByNode[String(nodeId)]).toEqual(refreshed.mazeRun!.shopByNode[String(nodeId)]);
    const next = { ...refreshed, mazeRun: newMazeRun(generateMaze(mazeRngFor(MAZE_FLOOR_1, 2)), MAZE_FLOOR_1, 2) };
    expect(withMazeRun(next, oldMovement)).toBe(next);
  });

  it('旧防抖路径不能补造商店或扩张探索，必须改走事务', () => {
    const partial = { ...run, shopByNode: { [String(nodeId)]: run.shopByNode[String(nodeId)]! }, exploredNodeIds: [0, nodeId] };
    const merged = withMazeRun({ ...profile(), mazeRun: partial }, { ...run, exploredNodeIds: [0, otherId] });
    expect(merged.mazeRun!.shopByNode[String(otherId)]).toBeUndefined();
    expect(merged.mazeRun!.exploredNodeIds).toEqual([0, nodeId]);
  });
});

describe('世界树迷宫刷新持久化', () => {
  it('刷新成功一次整档写入，重新载入批次和货架不变', async () => {
    const repository = new MemorySaveRepository();
    await repository.commit(profile());
    const store = await loadStore(repository);
    try {
      const before = repository.commitCount;
      const result = await store.commitEconomic(p => refresh(p));
      expect(result.ok).toBe(true);
      expect(repository.commitCount).toBe(before + 1);
      const saved = await repository.load();
      expect(saved!.mazeRun).toEqual(store.getSnapshot().profile!.mazeRun);
      expect(mazeShopStock(saved!.mazeRun!, nodeId)).toEqual(mazeShopStock(store.getSnapshot().profile!.mazeRun!, nodeId));
    } finally { store.dispose(); }
  });

  it('刷新保存失败保留旧批次和售罄，不提前清空货架', async () => {
    const repository = new MemorySaveRepository();
    const p = applyEconomyTransaction(profile(), purchase(profile()).transaction).profile;
    await repository.commit(p);
    const store = await loadStore(new FailingSaveRepository(repository));
    try {
      const before = store.getSnapshot().profile!;
      const result = await store.commitEconomic(current => refresh(current));
      expect(result).toMatchObject({ ok: false, reason: 'saveFailed' });
      expect(store.getSnapshot().profile).toBe(before);
      expect((await repository.load())!.mazeRun).toEqual(p.mazeRun);
    } finally { store.dispose(); }
  });

  it('快速刷新与购买共用busy锁，只允许一项进入；防抖旧移动不抹掉新货架', async () => {
    const repository = new MemorySaveRepository();
    await repository.commit(profile());
    const store = await loadStore(repository);
    try {
      const pending = store.commitEconomic(p => refresh(p));
      const second = await store.commitEconomic(p => purchase(p));
      expect(second).toMatchObject({ ok: false, reason: 'rejected', message: '上一个操作还在处理中' });
      expect((await pending).ok).toBe(true);
      const newState = store.getSnapshot().profile!.mazeRun!.shopByNode[String(nodeId)];
      store.saveMazeRun(run);
      await store.flush();
      expect(store.getSnapshot().profile!.mazeRun!.shopByNode[String(nodeId)]).toEqual(newState);
    } finally { store.dispose(); }
  });
});
