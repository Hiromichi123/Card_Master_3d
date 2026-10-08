/**
 * 基础玩法循环的纯逻辑。
 *
 * 全部在 node 环境跑、不碰 DOM、不看真实时间、不用随机——
 * 时间与随机都从外面注入，所以「今天恰好是什么货架」不会让用例随机失败。
 *
 * 这里**不测界面**：界面里的东西（按钮禁用、toast、跳转）在浏览器用例里。
 * 这一层要证的是规则本身，尤其是几处「旧版是错的、新版要修」的地方。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  cardById,
  cardDatabase,
  decks,
  gachaPools,
  rarityList,
  shops,
  stages,
} from '../../src/data';
import { createRng, seedFrom } from '../../src/domain/battle/rng';
import { withMazeRun } from '../../src/domain/progression/profile';
import type { BattleOutcome } from '../../src/domain/battle/types';
import {
  addToInventory,
  applyEconomyTransaction,
  canAfford,
} from '../../src/domain/progression/economy';
import {
  planSettlement,
  planStageLaunch,
  settleStage,
  settlementRng,
  FLAG_CRYSTAL_DROP,
  FLAG_RARE_CARD_DROP,
} from '../../src/domain/progression/campaign';
import {
  availableCopies,
  canAddCard,
  validateDeck,
  DECK_LIMIT,
} from '../../src/domain/progression/deck';
import {
  buildCardPool,
  planPull,
  probabilityRows,
  rarePercent,
  raritySlots,
  sampleRarity,
  totalWeight,
} from '../../src/domain/progression/gacha';
import { grantXp, nextLevelXp } from '../../src/domain/progression/levels';
import { buildRarityIndex, UNKNOWN_RANK } from '../../src/domain/progression/rarityIndex';
import { previewDeck, previewInventory, cardIdFromLegacyPath } from '../../src/domain/progression/legacyImport';
import { buildShelf, planPurchase, shopSeedFor } from '../../src/domain/progression/shop';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { createDeck } from '../../src/domain/progression/deck';
import type { EconomyTransaction, ProfileState } from '../../src/domain/progression/types';

const rarityIndex = buildRarityIndex(rarityList);
const cardPool = buildCardPool(cardDatabase.definitions);

function freshProfile(): ProfileState {
  const starter = cardDatabase.definitions
    .filter((card) => card.status === 'complete')
    .slice(0, DECK_LIMIT)
    .map((card) => card.cardId);
  return createInitialProfile({
    contentVersion: cardDatabase.contentVersion,
    dayKey: '20260101',
    starterCardIds: starter,
    now: new Date('2026-01-01T00:00:00Z'),
  });
}

/** 稀有度 → 可上架卡（与商店界面同源的构造，用于货架测试）。 */
function cardsByRarity(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const card of cardDatabase.definitions) {
    if (card.status !== 'complete') {
      continue;
    }
    const list = map.get(card.rarity) ?? [];
    list.push(card.cardId);
    map.set(card.rarity, list);
  }
  for (const list of map.values()) {
    list.sort();
  }
  return map;
}

function shelfSpec() {
  const normal = shops.normalShop;
  if (!normal) {
    throw new Error('shops.json 里没有 normalShop');
  }
  return {
    priceByRarity: normal.priceByRarity,
    unknownRarityFallback: normal.unknownRarityFallback,
    packs: normal.packs,
    shelves: Object.fromEntries(
      Object.entries(normal.shelves).map(([key, value]) => [
        key,
        {
          label: value.label,
          rarities: value.rarities,
          countRange: value.count_range,
          allowRepeat: value.allow_repeat,
        },
      ]),
    ),
  };
}

describe('经验曲线', () => {
  it('照搬旧版：100 → 120 → 144 → 173', () => {
    const base = { level: 1, xp: 0, baseXp: 100, xpMultiplier: 1.2 };
    expect(nextLevelXp(base)).toBe(100);
    expect(nextLevelXp({ ...base, level: 2 })).toBe(120);
    expect(nextLevelXp({ ...base, level: 3 })).toBe(144);
    // 1.2³ = 1.728，向上取整成 173——不是 172
    expect(nextLevelXp({ ...base, level: 4 })).toBe(173);
  });

  it('一次给够可以连升多级，且每级用更新后的等级重算', () => {
    const base = { level: 1, xp: 0, baseXp: 100, xpMultiplier: 1.2 };
    // 100 + 120 = 220，刚好连升两级
    const result = grantXp(base, 220);
    expect(result.levelsGained).toBe(2);
    expect(result.level.level).toBe(3);
    expect(result.level.xp).toBe(0);
  });
});

describe('经济事务', () => {
  it('余额不足时原样返回，不产生新对象', () => {
    const profile = freshProfile();
    const poor = { ...profile, currencies: { gold: 10, crystal: 0, badge: 0 } };
    const outcome = applyEconomyTransaction(poor, {
      operationId: 'op-1',
      currencyDelta: { gold: -100 },
      inventoryDelta: {},
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('insufficientFunds');
    // 同一个引用——没有任何东西被改动
    expect(outcome.profile).toBe(poor);
  });

  it('库存不足时原样返回', () => {
    const profile = freshProfile();
    const outcome = applyEconomyTransaction(profile, {
      operationId: 'op-2',
      currencyDelta: {},
      inventoryDelta: { 不存在的卡: -1 },
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('insufficientCards');
  });

  it('同一个 battleId 只结算一次', () => {
    const profile = freshProfile();
    const tx: EconomyTransaction = {
      operationId: 'op-3',
      currencyDelta: { gold: 300 },
      inventoryDelta: {},
      xpDelta: 100,
      settleBattleId: '1-1#0@1',
      clearStageId: '1-1',
    };
    const first = applyEconomyTransaction(profile, tx);
    expect(first.applied).toBe(true);
    expect(first.profile.currencies.gold).toBe(profile.currencies.gold + 300);
    expect(first.profile.campaign.clearedStages).toContain('1-1');

    // 换一个 operationId 再交一次，仍然不得再发
    const second = applyEconomyTransaction(first.profile, { ...tx, operationId: 'op-4' });
    expect(second.applied).toBe(false);
    expect(second.reason).toBe('alreadySettled');
    expect(second.profile.currencies.gold).toBe(first.profile.currencies.gold);
  });

  it('库存掉到 0 的键会被删掉，不留 0', () => {
    const next = addToInventory({ A: 1, B: 2 }, { A: -1 });
    expect(next).toEqual({ B: 2 });
    expect('A' in next).toBe(false);
  });

  it('三个货币一起校验，任一不足就整体拒绝', () => {
    expect(canAfford({ gold: 100, crystal: 0, badge: 0 }, { gold: -100 })).toBe(true);
    expect(canAfford({ gold: 100, crystal: 0, badge: 0 }, { gold: -50, crystal: -1 })).toBe(false);
  });
});

describe('抽卡', () => {
  const simple = raritySlots(gachaPools.tables['simple']!, rarityIndex.order);
  const special = raritySlots(gachaPools.tables['special']!, rarityIndex.order);
  const holiday = raritySlots(gachaPools.tables['holiday']!, rarityIndex.order);

  it('special 池抽不到任何零权重的稀有度', () => {
    // 旧版这里会掉进「随机挑一个非空稀有度」的兜底，D 卡能从高级池里出来
    const table = gachaPools.tables['special']!;
    const zeroWeight = rarityIndex.order.filter((rarity) => !(table[rarity as never] ?? 0));
    expect(zeroWeight.length).toBeGreaterThan(0);

    const rng = createRng(12345);
    for (let i = 0; i < 4000; i += 1) {
      const rarity = sampleRarity(rng, special);
      expect(zeroWeight).not.toContain(rarity);
    }
  });

  it('holiday 表不足 100，但比例等于原始权重', () => {
    // 旧版的 64.5 与 100 之间的缺口会走兜底；新版按表内总和归一化
    const total = totalWeight(holiday);
    expect(total).toBeLessThan(100);
    const rows = probabilityRows(holiday);
    const sum = rows.reduce((acc, row) => acc + row.percent, 0);
    expect(sum).toBeCloseTo(100, 6);
    for (const row of rows) {
      expect(row.percent).toBeCloseTo((row.weight / total) * 100, 6);
    }
  });

  it('special 的稀有度占比归一化后是 100%', () => {
    const percent = rarePercent(special, (rarity) => rarityIndex.isHighRarity(rarity));
    expect(percent).toBeCloseTo(100, 6);
  });

  it('概率文案由权重算出，与配置里那串手写文案不同', () => {
    const normal = gachaPools.pools.find((pool) => pool.id === 'normal');
    expect(normal).toBeDefined();
    const rows = probabilityRows(simple);
    expect(rows.reduce((acc, row) => acc + row.percent, 0)).toBeCloseTo(100, 6);

    const computed = rarePercent(simple, (rarity) => rarityIndex.isHighRarity(rarity));
    expect(computed).toBeCloseTo(6.3, 1);
    // 配置里手写的是 8.9%——界面不得用它，这里把两者的差异钉住
    expect(normal!.declaredRarePercent).toBeCloseTo(8.9, 1);
    expect(computed).not.toBeCloseTo(normal!.declaredRarePercent!, 1);
  });

  it('十连出十张、重复记 +2、只产生一次事务', () => {
    const profile = freshProfile();
    const pool = gachaPools.pools.find((entry) => entry.id === 'normal')!;
    const rng = createRng(999);
    const planned = planPull({
      profile,
      poolId: pool.id,
      currency: pool.currency,
      cost: pool.tenCost,
      slots: simple,
      pool: cardPool,
      count: 10,
      rng,
      operationId: 'pull-1',
    });
    if ('rejected' in planned) {
      throw new Error(`不该被拒：${planned.rejected}`);
    }
    expect(planned.view.cardIds).toHaveLength(10);
    expect(planned.view.rarities).toHaveLength(10);

    // 库存变化的总和必须正好是 10——同一张抽到两次要记 +2
    const totalDelta = Object.values(planned.transaction.inventoryDelta).reduce(
      (sum, value) => sum + value,
      0,
    );
    expect(totalDelta).toBe(10);
    // 一次事务 = 一次扣费
    expect(planned.transaction.currencyDelta).toEqual({ [pool.currency]: -pool.tenCost });
  });

  it('余额不足直接拒绝，不消耗随机数', () => {
    const profile = freshProfile();
    const poor = { ...profile, currencies: { gold: 0, crystal: 0, badge: 0 } };
    const pool = gachaPools.pools.find((entry) => entry.id === 'normal')!;
    const planned = planPull({
      profile: poor,
      poolId: pool.id,
      currency: pool.currency,
      cost: pool.singleCost,
      slots: simple,
      pool: cardPool,
      count: 1,
      rng: createRng(1),
      operationId: 'pull-2',
    });
    expect('rejected' in planned).toBe(true);
  });

  it('同一种子抽出同一批卡', () => {
    const profile = freshProfile();
    const pool = gachaPools.pools.find((entry) => entry.id === 'normal')!;
    const draw = () =>
      planPull({
        profile,
        poolId: pool.id,
        currency: pool.currency,
        cost: pool.tenCost,
        slots: simple,
        pool: cardPool,
        count: 10,
        rng: createRng(2026),
        operationId: 'pull-3',
      });
    const a = draw();
    const b = draw();
    expect('view' in a && 'view' in b && a.view.cardIds).toEqual(
      'view' in b ? b.view.cardIds : [],
    );
  });
});

describe('卡组', () => {
  const inventory = { A: 3, B: 1 };

  it('可用张数 = 拥有张数 − 已在卡组里的张数', () => {
    const deck = { id: 'd', name: 'd', cardIds: ['A', 'A'], updatedAt: '' };
    expect(availableCopies(inventory, deck, 'A')).toBe(1);
    expect(availableCopies(inventory, deck, 'B')).toBe(1);
  });

  it('超过 12 张被拒', () => {
    const full = {
      id: 'd',
      name: 'd',
      cardIds: Array.from({ length: DECK_LIMIT }, () => 'A'),
      updatedAt: '',
    };
    const check = canAddCard(full, { A: 99 }, 'A');
    expect(check.ok).toBe(false);
    expect(check.ok === false ? check.reason : '').toBe('full');
  });

  it('库存用尽后不能再加', () => {
    const deck = { id: 'd', name: 'd', cardIds: ['B'], updatedAt: '' };
    const check = canAddCard(deck, inventory, 'B');
    expect(check.ok).toBe(false);
    expect(check.ok === false ? check.reason : '').toBe('noneLeft');
  });

  it('空的卡组不能出战，缺卡的卡组也不行', () => {
    const empty = createDeck('d', 'd', [], new Date(0));
    expect(validateDeck(empty, inventory)).toContain('empty');
    const missing = createDeck('d', 'd', ['不存在的卡'], new Date(0));
    expect(validateDeck(missing, inventory)).toContain('missingCopies');
  });
});

describe('商店', () => {
  const spec = shelfSpec();
  const byRarity = cardsByRarity();

  it('同一天生成同一份货架，换一天不同', () => {
    const a = buildShelf({ dayKey: '20260101', spec, cardsByRarity: byRarity, soldOut: [] });
    const b = buildShelf({ dayKey: '20260101', spec, cardsByRarity: byRarity, soldOut: [] });
    const c = buildShelf({ dayKey: '20260102', spec, cardsByRarity: byRarity, soldOut: [] });
    expect(a.map((e) => e.cardId)).toEqual(b.map((e) => e.cardId));
    expect(a.map((e) => e.cardId)).not.toEqual(c.map((e) => e.cardId));
  });

  it('神话与传承货架不出现重复的卡', () => {
    const shelf = buildShelf({ dayKey: '20260101', spec, cardsByRarity: byRarity, soldOut: [] });
    for (const key of ['top', 'middle']) {
      const cardIds = shelf
        .filter((entry) => entry.shelfKey === key)
        .map((entry) => entry.cardId);
      expect(new Set(cardIds).size).toBe(cardIds.length);
    }
  });

  it('探索货架恰好 5 格，且允许重复', () => {
    const shelf = buildShelf({ dayKey: '20260101', spec, cardsByRarity: byRarity, soldOut: [] });
    const bottom = shelf.filter((entry) => entry.shelfKey === 'bottom');
    expect(bottom).toHaveLength(5);
    expect(bottom.every((entry) => entry.rarity.match(/^[BCD]/) !== null)).toBe(true);
  });

  it('售罄标识带 dayKey 与 index，同一张卡的两格互不影响', () => {
    const entryA = { dayKey: '20260101', shelf: 'bottom', index: 0, cardId: 'D_001' };
    const entryB = { ...entryA, index: 1 };
    const idA = `20260101|bottom|0|D_001`;
    const idB = `20260101|bottom|1|D_001`;
    expect(idA).not.toBe(idB);

    // 把第 0 格标成售罄，第 1 格仍然可买
    const shelf = buildShelf({
      dayKey: '20260101',
      spec,
      cardsByRarity: byRarity,
      soldOut: [idA],
    });
    const first = shelf.find((entry) => entry.entryId === idA);
    const second = shelf.find((entry) => entry.entryId === idB);
    if (first && second) {
      expect(first.soldOut).toBe(true);
      expect(second.soldOut).toBe(false);
    }
    expect(entryB.index).toBe(1);
  });

  it('种子是哈希过的日期，相邻两天明显不同', () => {
    expect(shopSeedFor('20260101')).not.toBe(shopSeedFor('20260102'));
    expect(shopSeedFor('20260101')).toBe(shopSeedFor('20260101'));
    expect(shopSeedFor('20260101')).not.toBe(Number('20260101'));
  });

  it('买卡会扣钱**并且**把卡放进库存（旧版只扣钱不发货）', () => {
    const profile = freshProfile();
    const rich = { ...profile, currencies: { gold: 999999, crystal: 999999, badge: 0 } };
    const shelf = buildShelf({ dayKey: '20260101', spec, cardsByRarity: byRarity, soldOut: [] });
    const entry = shelf.find((item) => item.kind === 'card' && !item.soldOut)!;

    const planned = planPurchase({
      profile: rich,
      entry,
      operationId: 'buy-1',
      cardsByRarity: byRarity,
      rng: createRng(7),
    });
    if ('rejected' in planned) {
      throw new Error(`不该被拒：${planned.rejected}`);
    }
    // 这一条正是 knownIssues[0] 的回归测试
    expect(planned.transaction.inventoryDelta[entry.cardId!]).toBe(1);
    expect(planned.transaction.soldOutAdditions).toContain(entry.entryId);

    const outcome = applyEconomyTransaction(rich, planned.transaction);
    expect(outcome.applied).toBe(true);
    expect(outcome.profile.inventory[entry.cardId!]).toBe(
      (rich.inventory[entry.cardId!] ?? 0) + 1,
    );
    expect(outcome.profile.shop.soldOut).toContain(entry.entryId);
  });

  it('已售罄的条目再买会被拒', () => {
    const profile = { ...freshProfile(), currencies: { gold: 999999, crystal: 999999, badge: 0 } };
    const shelf = buildShelf({ dayKey: '20260101', spec, cardsByRarity: byRarity, soldOut: [] });
    const entry = { ...shelf.find((item) => item.kind === 'card')!, soldOut: true };
    const planned = planPurchase({
      profile,
      entry,
      operationId: 'buy-2',
      cardsByRarity: byRarity,
      rng: createRng(7),
    });
    expect('rejected' in planned).toBe(true);
  });

  it('礼包真的发货（旧版只扣钱）', () => {
    const profile = { ...freshProfile(), currencies: { gold: 999999, crystal: 999999, badge: 0 } };
    const shelf = buildShelf({ dayKey: '20260101', spec, cardsByRarity: byRarity, soldOut: [] });
    const pack = shelf.find((item) => item.kind === 'pack')!;
    const planned = planPurchase({
      profile,
      entry: pack,
      operationId: 'buy-pack',
      cardsByRarity: byRarity,
      rng: createRng(11),
    });
    if ('rejected' in planned) {
      throw new Error(`礼包不该被拒：${planned.rejected}`);
    }
    expect(Object.values(planned.transaction.inventoryDelta)).toEqual([1]);
    expect(cardById.get(planned.view.cardId)?.rarity).toBe(pack.rarity);
  });
});

describe('战役与结算', () => {
  it('2-3 与 2-4 的敌方牌组会被裁到 12 张', () => {
    // 这两关的配置是 13 张，而 createBattle 在超限时直接抛错
    for (const stageId of ['2-3', '2-4']) {
      const enemy = decks.enemy[stageId];
      if (!enemy) {
        throw new Error(`decks.json 里没有 ${stageId}`);
      }
      expect(enemy.cardIds.length).toBeGreaterThan(DECK_LIMIT);
      const launch = planStageLaunch({
        profile: freshProfile(),
        stageId,
        chapterId: '2',
        stageName: 'x',
        playerDeck: ['A_011'],
        enemyDeck: enemy.cardIds,
        rewardSpec: null,
        launchSeq: 1,
      });
      if ('rejected' in launch) {
        throw new Error(launch.rejected);
      }
      expect(launch.enemyDeck).toHaveLength(DECK_LIMIT);
      expect(launch.clipped).toBe(true);
    }
  });

  it('没有可用卡组时拒绝启动', () => {
    const launch = planStageLaunch({
      profile: freshProfile(),
      stageId: '1-1',
      chapterId: '1',
      stageName: 'x',
      playerDeck: [],
      enemyDeck: ['A_011'],
      rewardSpec: null,
      launchSeq: 1,
    });
    expect('rejected' in launch).toBe(true);
  });

  it('负局只给 60 经验，别的什么都没有', () => {
    const outcome: BattleOutcome = { kind: 'win', winner: 'enemy', reason: 'hpDepleted' };
    const result = settleStage({
      rewardSpec: stages.chapters[0]!.stages[0]!.reward,
      outcome,
      rng: createRng(1),
      pool: cardPool,
      rarityOrder: rarityIndex.order,
      dropSeed: 1,
    });
    expect(result.victory).toBe(false);
    expect(result.xp).toBe(60);
    expect(result.gold).toBe(0);
    expect(result.crystals).toBe(0);
    expect(result.cardId).toBeNull();
  });

  it('通关 1-1 给 300 金币 100 经验（来自配置）', () => {
    const outcome: BattleOutcome = { kind: 'win', winner: 'player', reason: 'hpDepleted' };
    const stage = stages.chapters[0]!.stages[0]!;
    expect(stage.id).toBe('1-1');
    const result = settleStage({
      rewardSpec: stage.reward,
      outcome,
      rng: createRng(1),
      pool: cardPool,
      rarityOrder: rarityIndex.order,
      dropSeed: 1,
    });
    expect(result.victory).toBe(true);
    expect(result.gold).toBe(300);
    expect(result.xp).toBe(100);
    expect(result.lines.some((line) => line.includes('300'))).toBe(true);
  });

  it('水晶掉落旗标按 3–10 发，且写进事务', () => {
    const outcome: BattleOutcome = { kind: 'win', winner: 'player', reason: 'hpDepleted' };
    const result = settleStage({
      rewardSpec: { gold: 10, xp: 5, items: [FLAG_CRYSTAL_DROP] },
      outcome,
      rng: createRng(42),
      pool: cardPool,
      rarityOrder: rarityIndex.order,
      dropSeed: 1,
    });
    expect(result.crystals).toBeGreaterThanOrEqual(3);
    expect(result.crystals).toBeLessThanOrEqual(10);
  });

  it('未知的奖励旗标不抛错，但要说出来', () => {
    const outcome: BattleOutcome = { kind: 'win', winner: 'player', reason: 'hpDepleted' };
    const result = settleStage({
      rewardSpec: { gold: 1, xp: 1, items: ['未来才有的旗标'] },
      outcome,
      rng: createRng(1),
      pool: cardPool,
      rarityOrder: rarityIndex.order,
      dropSeed: 1,
    });
    expect(result.lines.some((line) => line.includes('未来才有的旗标'))).toBe(true);
  });

  it('稀有掉落旗标在若干次里至少中过一次', () => {
    const outcome: BattleOutcome = { kind: 'win', winner: 'player', reason: 'hpDepleted' };
    let drops = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const result = settleStage({
        rewardSpec: { gold: 1, xp: 1, items: [FLAG_RARE_CARD_DROP] },
        outcome,
        rng: createRng(seed),
        pool: cardPool,
        rarityOrder: rarityIndex.order,
        dropSeed: seed,
      });
      if (result.cardId) {
        drops += 1;
      }
    }
    // 配置是 10%，200 次里落在 8~32 次之间都是正常的（宽区间只为不出假阴性）
    expect(drops).toBeGreaterThan(8);
    expect(drops).toBeLessThan(32);
  });

  it('同一个 battleId 的结算随机流可复现', () => {
    const a = settlementRng('1-1#0@1').snapshot();
    const b = settlementRng('1-1#0@1').snapshot();
    expect(a.state).toBe(b.state);
    expect(settlementRng('1-1#0@2').snapshot().state).not.toBe(a.state);
  });

  it('结算事务一次带上金币、经验、掉落的卡与通关记录', () => {
    const outcome: BattleOutcome = { kind: 'win', winner: 'player', reason: 'hpDepleted' };
    const launch = planStageLaunch({
      profile: freshProfile(),
      stageId: '1-1',
      chapterId: '1',
      stageName: '古海要塞',
      playerDeck: ['A_011'],
      enemyDeck: ['S_001'],
      rewardSpec: stages.chapters[0]!.stages[0]!.reward,
      launchSeq: 1,
    });
    if ('rejected' in launch) {
      throw new Error(launch.rejected);
    }
    const settlement = settleStage({
      rewardSpec: launch.rewardSpec,
      outcome,
      rng: settlementRng(launch.battleId),
      pool: cardPool,
      rarityOrder: rarityIndex.order,
      dropSeed: seedFrom(launch.battleId),
    });
    const planned = planSettlement(launch, settlement, 'settle-1');
    if ('rejected' in planned) {
      throw new Error(planned.rejected);
    }
    const tx = planned.transaction;
    expect(tx.currencyDelta.gold).toBe(300);
    expect(tx.xpDelta).toBe(100);
    expect(tx.settleBattleId).toBe(launch.battleId);
    expect(tx.clearStageId).toBe('1-1');

    // 结算一次之后再结算同一局：全部不动
    const once = applyEconomyTransaction(freshProfile(), tx);
    const twice = applyEconomyTransaction(once.profile, { ...tx, operationId: 'settle-2' });
    expect(twice.applied).toBe(false);
    expect(twice.profile.currencies.gold).toBe(once.profile.currencies.gold);
  });
});

describe('稀有度索引', () => {
  it('没登记的稀有度给哨兵值而不是 NaN', () => {
    // 用一个真的不存在的档位：`#yoroi` 2026-10-09 起已并入 `EVENT_RARITIES`
    expect(rarityIndex.isKnown('#unknown')).toBe(false);
    expect(rarityIndex.rankOf('#unknown')).toBe(UNKNOWN_RANK);
    const sorted = [...rarityIndex.order, '#unknown'].sort(
      (a, b) => rarityIndex.rankOf(a) - rarityIndex.rankOf(b),
    );
    expect(sorted[sorted.length - 1]).toBe('#unknown');
    expect(Number.isNaN(rarityIndex.rankOf('#unknown'))).toBe(false);
  });

  it('顺序由稀有到普通，事件稀有度排在最后', () => {
    expect(rarityIndex.order[0]).toBe('SSS');
    expect(rarityIndex.order).toContain('D');
    expect(rarityIndex.rankOf('SSS')).toBeLessThan(rarityIndex.rankOf('D'));
    expect(rarityIndex.rankOf('#elna')).toBeGreaterThan(rarityIndex.rankOf('D'));
  });

  it('`#yoroi` 已登记，图鉴/配置的筛选分组才排得出它', () => {
    expect(rarityIndex.isKnown('#yoroi')).toBe(true);
    expect(rarityIndex.rankOf('#yoroi')).toBeGreaterThan(rarityIndex.rankOf('D'));
    expect(rarityIndex.order[rarityIndex.order.length - 1]).toBe('#yoroi');
    // 配色仍取自 rarities.json，不是兜底灰
    expect(rarityIndex.colorOf('#yoroi')).toBe('#ff1493');
  });

  it('配色取自数据，未知给中性灰', () => {
    expect(rarityIndex.colorOf('SSS')).toBe('#ff0000');
    expect(rarityIndex.colorOf('不存在的稀有度')).toBe('#8a93a6');
  });
});

describe('旧存档导入', () => {
  it('旧路径映射成 cardId', () => {
    expect(cardIdFromLegacyPath('assets/outputs/SS/005.png')).toBe('SS_005');
    expect(cardIdFromLegacyPath('assets\\outputs\\SS+\\002.png')).toBe('SS+_002');
    expect(cardIdFromLegacyPath('#elna 的路径')).toBeNull();
  });

  it('认不出来的路径进 unknown 并带上原因，不静默丢弃', () => {
    const known = new Set(['SS_005']);
    const preview = previewInventory(
      { cards: [{ path: 'assets/outputs/SS/005.png' }, { path: '随便什么' }, { path: 'assets/outputs/SS/999.png' }] },
      { knownCardIds: known },
    );
    expect(preview.mapped).toHaveLength(1);
    expect(preview.unknown).toHaveLength(2);
    expect(preview.unknown[0]!.reason).toContain('路径形状');
    expect(preview.unknown[1]!.reason).toContain('卡库里没有');
  });

  it('旧牌组的两种格式都认', () => {
    const preview = previewDeck(
      { deck: ['assets/outputs/SS/005.png', { path: 'assets/outputs/SS/005.png' }] },
      { knownCardIds: new Set(['SS_005']) },
    );
    expect(preview.mapped).toHaveLength(2);
  });
});

describe('领域层不得依赖时间与随机', () => {
  it('src/domain/progression 下没有 Math.random / new Date / Date.now', () => {
    const root = join(process.cwd(), 'src', 'domain', 'progression');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith('.ts')) {
          continue;
        }
        // clock.ts 是**唯一**允许碰系统时间的地方，其余模块一律靠注入
        if (name === 'clock.ts') {
          continue;
        }
        const text = readFileSync(full, 'utf8');
        // 注释里可以提这些词，所以只查真的当代码用的那些
        const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        if (/Math\.random\s*\(/.test(code)) {
          offenders.push(`${name}: Math.random`);
        }
        if (/Date\.now\s*\(/.test(code)) {
          offenders.push(`${name}: Date.now`);
        }
        if (/new Date\s*\(\s*\)/.test(code)) {
          offenders.push(`${name}: new Date()`);
        }
      }
    };
    walk(root);
    expect(offenders, `领域层里出现了时间或随机：${offenders.join(', ')}`).toEqual([]);
  });
});

describe('迷宫商店的售罄落点', () => {
  const run = {
    floorKey: 'floor1',
    version: 1,
    playerNodeId: 7,
    exploredNodeIds: [0, 7],
    shopByNode: {
      '7': { dayKey: 'maze:floor1:v1:n7', seed: 4242, soldOut: [] },
    },
  };

  it('写进 mazeRun 的那个节点，而不是全局货架', () => {
    const profile = withMazeRun(freshProfile(), run);
    const outcome = applyEconomyTransaction(profile, {
      operationId: 'buy-maze-1',
      currencyDelta: { gold: -100 },
      inventoryDelta: {},
      mazeSoldOut: { nodeId: '7', entryIds: ['maze:floor1:v1:n7|0|card'] },
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.profile.mazeRun?.shopByNode['7']?.soldOut).toEqual([
      'maze:floor1:v1:n7|0|card',
    ]);
    // 全局货架不该被写脏
    expect(outcome.profile.shop.soldOut).toEqual([]);
  });

  it('没有在跑迷宫时忽略这个字段，不会凭空造出一个 run', () => {
    const outcome = applyEconomyTransaction(freshProfile(), {
      operationId: 'buy-maze-2',
      currencyDelta: { gold: -100 },
      inventoryDelta: {},
      mazeSoldOut: { nodeId: '7', entryIds: ['x'] },
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.profile.mazeRun).toBeNull();
  });
});
