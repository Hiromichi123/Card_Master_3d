/**
 * 迷宫的「开战 → 结算 → 商店购买」三块拼装。
 *
 * 要钉住的几件事：
 * 1. **同一局可复现**：随机流由 `attemptKey` 派生，重算得到同一副敌牌；
 * 2. **Boss 只能通关一次**：胜利的 `battleId` 稳定（`settledBattleIds` 去重靠它），
 *    但**输**用的是另一条每次不同的 id——否则第二次挑战 Boss 会连经验都拿不到；
 * 3. **迷宫不碰战役进度**：事务里不许出现 `clearStageId`（旧版会把节点名写进战役存档）；
 * 4. **楼层商店的售罄落在这一轮的节点上**，不写每日货架。
 */

import { describe, expect, it } from 'vitest';

import { cardDatabase, shops } from '../../src/data';
import { buildCardPool } from '../../src/domain/progression/gacha';
import { createRng, seedFrom } from '../../src/domain/battle/rng';
import type { BattleOutcome } from '../../src/domain/battle/types';
import {
  MAZE_CHAPTER_ID,
  MAZE_FLOOR_1,
  MAZE_SHOP,
  generateMaze,
  newMazeRun,
  exploredRatio,
  rollStrength,
  generateMazeEnemyDeck,
} from '../../src/domain/progression/maze';
import type { MazeNode } from '../../src/domain/progression/maze';
import { createInitialProfile } from '../../src/domain/progression/profile';
import type { ProfileState } from '../../src/domain/progression/types';
import {
  isMazeLaunch,
  mazeSettlementFor,
  mazeShopStock,
  planMazeLaunch,
  planMazePurchase,
  planMazeSettlement,
} from '../../src/scenes/mazeFlow';

const pool = buildCardPool(cardDatabase.definitions);

/** 一局里够用的新号：12 张起始卡 + 5000 金币（演示存档那套）。 */
function freshProfile(): ProfileState {
  const starter = cardDatabase.definitions
    .filter((card) => card.status === 'complete')
    .slice(0, 12)
    .map((card) => card.cardId);
  return createInitialProfile({
    contentVersion: cardDatabase.contentVersion,
    dayKey: '20261006',
    starterCardIds: starter,
    now: new Date('2026-10-06T00:00:00Z'),
  });
}

/** 一张带补给节点的图（补给节点的比例不高，换几个种子找一张）。 */
function mapWithSupply() {
  for (let index = 0; index < 24; index += 1) {
    const map = generateMaze(createRng(seedFrom(`test:mazeFlow:supply:${index}`)));
    if (map.nodes.some((node) => node.type === 'supply')) {
      return map;
    }
  }
  throw new Error('24 个种子里都没生成出补给节点，比例配置大概改了');
}

const map = generateMaze(createRng(seedFrom('test:mazeFlow')));
const run = newMazeRun(map, MAZE_FLOOR_1, 1);
const explored = exploredRatio(map, run);
const combatNode = map.nodes.find((node) => node.type === 'normal')!;
const bossNode = map.nodes[map.bossId]!;

function launchArgs(node: MazeNode, launchSeq = 1) {
  const profile = freshProfile();
  return {
    profile,
    run,
    explored,
    node,
    playerDeck: profile.decks[0]!.cardIds,
    launchSeq,
  };
}

const WIN: BattleOutcome = { kind: 'win', winner: 'player', reason: 'hpDepleted' };
const LOSS: BattleOutcome = { kind: 'win', winner: 'enemy', reason: 'hpDepleted' };

describe('迷宫开战：battleId 与随机流', () => {
  it('没有出战卡组时拒绝启动', () => {
    const result = planMazeLaunch({ ...launchArgs(combatNode), playerDeck: [] });
    expect(result).toEqual({ rejected: expect.any(String) });
  });

  it('普通节点：每次挑战都是新的一局（重打能再领奖）', () => {
    const first = planMazeLaunch(launchArgs(combatNode, 1));
    const second = planMazeLaunch(launchArgs(combatNode, 2));
    if ('rejected' in first || 'rejected' in second) {
      throw new Error('不该被拒绝');
    }
    expect(first.battleId).toContain(`:n${combatNode.id}`);
    expect(first.battleId).not.toBe(second.battleId);
    expect(first.seed).not.toBe(second.seed);
  });

  it('同一局的两次计算完全一致（可复现）', () => {
    const first = planMazeLaunch(launchArgs(combatNode, 3));
    const again = planMazeLaunch(launchArgs(combatNode, 3));
    if ('rejected' in first || 'rejected' in again) {
      throw new Error('不该被拒绝');
    }
    expect(again).toEqual(first);
  });

  it('Boss：胜利 id 稳定（全 run 只能通关一次），失败 id 每次不同', () => {
    const first = planMazeLaunch(launchArgs(bossNode, 1));
    const second = planMazeLaunch(launchArgs(bossNode, 2));
    if ('rejected' in first || 'rejected' in second) {
      throw new Error('不该被拒绝');
    }
    expect(first.battleId).toBe(second.battleId);
    expect(first.lossBattleId).not.toBe(second.lossBattleId);
    // 随机流走的是「这一次挑战」，所以重试的敌牌与种子都不同
    expect(first.attemptKey).not.toBe(second.attemptKey);
    expect(first.seed).not.toBe(second.seed);
    expect(first.enemyDeck).not.toEqual(second.enemyDeck);
  });

  it('敌牌组张数不超过引擎上限，且与 attemptKey 派生的一致', () => {
    const launch = planMazeLaunch(launchArgs(combatNode, 4));
    if ('rejected' in launch) {
      throw new Error('不该被拒绝');
    }
    expect(launch.enemyDeck.length).toBeLessThanOrEqual(12);
    const strength = rollStrength(
      createRng(seedFrom(`${launch.attemptKey}:strength`)),
      combatNode.type,
      explored,
    );
    expect(launch.enemyDeck).toEqual(
      generateMazeEnemyDeck(createRng(seedFrom(`${launch.attemptKey}:deck`)), strength, pool),
    );
  });

  it('带 `chapterId` 哨兵，且能被 `isMazeLaunch` 认出来', () => {
    const launch = planMazeLaunch(launchArgs(combatNode, 5));
    if ('rejected' in launch) {
      throw new Error('不该被拒绝');
    }
    expect(launch.chapterId).toBe(MAZE_CHAPTER_ID);
    expect(isMazeLaunch(launch)).toBe(true);
  });
});

describe('迷宫结算：奖励与去重 id', () => {
  it('败北只给经验，胜利给金币与徽章', () => {
    const launch = planMazeLaunch(launchArgs(combatNode, 6));
    if ('rejected' in launch) {
      throw new Error('不该被拒绝');
    }
    const win = mazeSettlementFor(launch, WIN);
    const loss = mazeSettlementFor(launch, LOSS);
    expect(win.victory).toBe(true);
    expect(win.gold).toBeGreaterThan(0);
    expect(loss.victory).toBe(false);
    expect(loss.gold).toBe(0);
    expect(loss.xp).toBeGreaterThan(0);
  });

  it('同一局重复计算得到同一份奖励（不落盘也算得出来）', () => {
    const launch = planMazeLaunch(launchArgs(combatNode, 7));
    if ('rejected' in launch) {
      throw new Error('不该被拒绝');
    }
    expect(mazeSettlementFor(launch, WIN)).toEqual(mazeSettlementFor(launch, WIN));
  });

  it('事务里没有 `clearStageId`——迷宫不写战役进度', () => {
    const launch = planMazeLaunch(launchArgs(combatNode, 8));
    if ('rejected' in launch) {
      throw new Error('不该被拒绝');
    }
    const planned = planMazeSettlement(launch, mazeSettlementFor(launch, WIN), 'op-maze-1');
    if ('rejected' in planned) {
      throw new Error('不该被拒绝');
    }
    expect('clearStageId' in planned.transaction).toBe(false);
    expect(planned.transaction.settleBattleId).toBe(launch.battleId);
    expect(planned.view.stageId).toBe(launch.stageId);
    expect(planned.view.battleId).toBe(launch.battleId);
  });

  it('败北用失败 id，不占用胜利那条（Boss 可以一直重试）', () => {
    const launch = planMazeLaunch(launchArgs(bossNode, 9));
    if ('rejected' in launch) {
      throw new Error('不该被拒绝');
    }
    const planned = planMazeSettlement(launch, mazeSettlementFor(launch, LOSS), 'op-maze-2');
    if ('rejected' in planned) {
      throw new Error('不该被拒绝');
    }
    const win = planMazeSettlement(launch, mazeSettlementFor(launch, WIN), 'op-maze-3');
    if ('rejected' in win) {
      throw new Error('不该被拒绝');
    }
    expect(planned.transaction.settleBattleId).toBe(launch.lossBattleId);
    expect(planned.transaction.settleBattleId).not.toBe(win.transaction.settleBattleId);
  });

  it('Boss 两次挑战的胜利结算 id 相同（结构性的一次性通关）', () => {
    const first = planMazeLaunch(launchArgs(bossNode, 10));
    const second = planMazeLaunch(launchArgs(bossNode, 11));
    if ('rejected' in first || 'rejected' in second) {
      throw new Error('不该被拒绝');
    }
    const a = planMazeSettlement(first, mazeSettlementFor(first, WIN), 'op-maze-4');
    const b = planMazeSettlement(second, mazeSettlementFor(second, WIN), 'op-maze-5');
    if ('rejected' in a || 'rejected' in b) {
      throw new Error('不该被拒绝');
    }
    expect(a.transaction.settleBattleId).toBe(b.transaction.settleBattleId);
  });
});

describe('楼层商店', () => {
  const supplyMap = mapWithSupply();
  const supplyNode = supplyMap.nodes.find((node) => node.type === 'supply')!;
  const supplyRun = newMazeRun(supplyMap, MAZE_FLOOR_1, 1);
  const stock = mazeShopStock(supplyRun, supplyNode.id);

  it('同一个节点每次看到的货架都一样（种子固定）', () => {
    const first = mazeShopStock(supplyRun, supplyNode.id);
    const again = mazeShopStock(supplyRun, supplyNode.id);
    expect(again.map((slot) => slot.item.cardId)).toEqual(first.map((slot) => slot.item.cardId));
    expect(first.length).toBe(MAZE_SHOP.cardCount);
  });

  it('购买事务把售罄写进**这个节点**，不写每日货架', () => {
    const profile = freshProfile();
    // 活动位收水晶，新号没有；买普通位（测的是事务形状，不是货币种类）
    const slot = stock.find((candidate) => !candidate.item.isEvent)!;
    const planned = planMazePurchase({
      profile,
      nodeId: supplyNode.id,
      entry: slot.entry,
      operationId: 'op-maze-shop-1',
      rng: createRng(seedFrom('op-maze-shop-1')),
    });
    if ('rejected' in planned) {
      throw new Error('不该被拒绝');
    }
    expect(planned.transaction.mazeSoldOut).toEqual({
      nodeId: String(supplyNode.id),
      entryIds: [slot.entry.entryId],
    });
    expect('soldOutAdditions' in planned.transaction).toBe(false);
    expect(planned.transaction.inventoryDelta[slot.item.cardId]).toBe(1);
  });

  it('余额不足时拒绝（价格由配置给，不是现算的）', () => {
    const slot = stock.find((candidate) => !candidate.item.isEvent)!;
    const broke: ProfileState = {
      ...freshProfile(),
      currencies: { ...freshProfile().currencies, [slot.item.price.currency]: 0 },
    };
    const planned = planMazePurchase({
      profile: broke,
      nodeId: supplyNode.id,
      entry: slot.entry,
      operationId: 'op-maze-shop-2',
      rng: createRng(seedFrom('op-maze-shop-2')),
    });
    expect('rejected' in planned).toBe(true);
  });

  it('售罄后同一个 entryId 不再可买', () => {
    const slot = stock[0]!;
    const soldOutEntry = { ...slot.entry, soldOut: true };
    const planned = planMazePurchase({
      profile: freshProfile(),
      nodeId: supplyNode.id,
      entry: soldOutEntry,
      operationId: 'op-maze-shop-3',
      rng: createRng(seedFrom('op-maze-shop-3')),
    });
    expect('rejected' in planned).toBe(true);
  });

  it('货架价格来自常规商店的价位表（活动位另有倍率）', () => {
    const priceByRarity = shops.normalShop?.priceByRarity ?? {};
    for (const slot of stock) {
      expect(slot.item.price.amount).toBeGreaterThan(0);
      expect(slot.entry.price.amount).toBe(slot.item.price.amount);
      if (slot.item.isEvent) {
        expect(slot.item.price.currency).toBe('crystal');
        continue;
      }
      const base = priceByRarity[slot.item.rarity];
      // 普通位是折扣价：不低于配置的地板价、不高于价位表上的原价
      expect(slot.item.price.amount).toBeGreaterThanOrEqual(MAZE_SHOP.minRegular);
      if (base) {
        expect(slot.item.price.amount).toBeLessThanOrEqual(base.amount);
      }
    }
  });
});
