/**
 * 第一层迷宫的规则。
 *
 * 断的是**结构性质与不变量**，不是具体某张图：节点数区间、邻接的双向性与曼哈顿距离、
 * 连通性、同种子可复现、强度对探索度的单调性、牌组张数区间、奖励公式、
 * 以及「Boss 只能结算一次」。
 *
 * 全部在 node 环境跑、随机走注入的 `Rng`——领域层里不许出现 `Math.random`/`new Date`
 * （`progression.test.ts` 有一条静态检查盯着，本文件不重复写）。
 */

import { describe, expect, it } from 'vitest';

import { cardDatabase, rarityList, shops } from '../../src/data';
import { buildCardPool } from '../../src/domain/progression/gacha';
import {
  MAZE_BOSS_MIN_DISTANCE,
  MAZE_DECK_SIZE_LIMITS,
  MAZE_EVENT_CARD_DROP,
  MAZE_EVENT_RARITY,
  MAZE_FLOOR_1,
  MAZE_RARITY_BUCKETS,
  MAZE_REWARD,
  MAZE_SHOP,
  MAZE_SHOP_WEIGHTS,
  applyMove,
  baseStrength,
  bfsDistances,
  buildMazeShop,
  canMoveTo,
  exploredRatio,
  generateMaze,
  generateMazeEnemyDeck,
  isMazeCleared,
  mazeBossBattleId,
  mazeBossLossBattleId,
  mazeDeckSize,
  mazeNodeBattleId,
  mazeReward,
  mazeRngFor,
  mazeSeedFor,
  mazeShopKey,
  mazeShopSeed,
  newMazeRun,
  previewStrength,
  rollStrength,
  withShopState,
} from '../../src/domain/progression/maze';
import { createRng, seedFrom } from '../../src/domain/battle/rng';

const pool = buildCardPool(cardDatabase.definitions);

/** 一批固定种子：结构性质要在多个种子上都成立。 */
const SEEDS = Array.from({ length: 12 }, (_, index) => seedFrom(`test:maze:${index}`));

describe('迷宫生成：结构', () => {
  it('节点数落在区间内，入口恒为 id 0', () => {
    for (const seed of SEEDS) {
      const map = generateMaze(createRng(seed));
      expect(map.nodes.length).toBeGreaterThanOrEqual(50);
      expect(map.nodes.length).toBeLessThanOrEqual(60);
      expect(map.entryId).toBe(0);
      expect(map.nodes[0]?.grid).toEqual([0, 0]);
      expect(map.nodes[0]?.type).toBe('entry');
    }
  });

  it('邻接双向、升序、无自环，且只连相邻格子（曼哈顿距离为 1）', () => {
    for (const seed of SEEDS) {
      const map = generateMaze(createRng(seed));
      for (const node of map.nodes) {
        expect(node.neighbors).toEqual([...node.neighbors].sort((a, b) => a - b));
        expect(node.neighbors).not.toContain(node.id);
        for (const other of node.neighbors) {
          expect(other).toBeGreaterThanOrEqual(0);
          expect(other).toBeLessThan(map.nodes.length);
          const target = map.nodes[other]!;
          const step =
            Math.abs(target.grid[0] - node.grid[0]) + Math.abs(target.grid[1] - node.grid[1]);
          expect(step).toBe(1);
          // 双向
          expect(target.neighbors).toContain(node.id);
        }
      }
    }
  });

  it('从入口能走到每一个节点（连通，没有孤岛）', () => {
    for (const seed of SEEDS) {
      const map = generateMaze(createRng(seed));
      const adjacency = new Map(map.nodes.map((node) => [node.id, node.neighbors]));
      const distances = bfsDistances(adjacency, map.entryId);
      for (const node of map.nodes) {
        expect(Number.isFinite(distances[node.id]), `节点 ${node.id} 不可达`).toBe(true);
      }
      // 每个节点的 distance 与 BFS 一致
      for (const node of map.nodes) {
        expect(node.distance).toBe(distances[node.id]);
      }
    }
  });

  it('Boss 是最远的节点；没被强制接受时距离不小于下限', () => {
    for (const seed of SEEDS) {
      const map = generateMaze(createRng(seed));
      const maxDistance = Math.max(...map.nodes.map((node) => node.distance));
      expect(map.bossDistance).toBe(maxDistance);
      expect(map.nodes[map.bossId]?.type).toBe('boss');
      if (!map.bossForced) {
        expect(map.bossDistance).toBeGreaterThanOrEqual(MAZE_BOSS_MIN_DISTANCE);
      }
    }
  });

  it('分类按配额分配，与旧版的口径一致（普通 8 : 商店 2 : 精英 1）', () => {
    for (const seed of SEEDS) {
      const map = generateMaze(createRng(seed));
      const counts = { normal: 0, elite: 0, supply: 0, entry: 0, boss: 0 };
      for (const node of map.nodes) {
        counts[node.type] += 1;
      }
      expect(counts.entry).toBe(1);
      expect(counts.boss).toBe(1);
      expect(counts.normal + counts.elite + counts.supply).toBe(map.nodes.length - 2);

      // 期望值：floor(remaining × ratio / Σ) + 余数按比值降序补
      const remaining = map.nodes.length - 2;
      const total = MAZE_RATIOS_TOTAL;
      const expected = {
        normal: Math.floor((remaining * 8) / total),
        supply: Math.floor((remaining * 2) / total),
        elite: Math.floor((remaining * 1) / total),
      };
      let assigned = expected.normal + expected.supply + expected.elite;
      const order: ('normal' | 'supply' | 'elite')[] = ['normal', 'supply', 'elite'];
      let index = 0;
      while (assigned < remaining) {
        expected[order[index % order.length]!] += 1;
        assigned += 1;
        index += 1;
      }
      expect(counts.normal).toBe(expected.normal);
      expect(counts.supply).toBe(expected.supply);
      expect(counts.elite).toBe(expected.elite);
    }
  });
});

const MAZE_RATIOS_TOTAL = 11;

describe('迷宫生成：可复现', () => {
  it('同一个种子生成出逐节点一致的图', () => {
    const a = generateMaze(mazeRngFor(MAZE_FLOOR_1, 1));
    const b = generateMaze(mazeRngFor(MAZE_FLOOR_1, 1));
    expect(b.nodes).toEqual(a.nodes);
    expect(b.bossId).toBe(a.bossId);
    expect(b.seed).toBe(a.seed);
  });

  it('换一次 run（version +1）就是另一张图', () => {
    const a = generateMaze(mazeRngFor(MAZE_FLOOR_1, 1));
    const b = generateMaze(mazeRngFor(MAZE_FLOOR_1, 2));
    expect(mazeSeedFor(MAZE_FLOOR_1, 1)).not.toBe(mazeSeedFor(MAZE_FLOOR_1, 2));
    expect(b.nodes).not.toEqual(a.nodes);
  });
});

describe('移动与探索', () => {
  it('只能走到直接邻居，落位后探索集并入目标', () => {
    const map = generateMaze(mazeRngFor(MAZE_FLOOR_1, 1));
    const run = newMazeRun(map, MAZE_FLOOR_1, 1);
    expect(run.playerNodeId).toBe(map.entryId);
    expect(run.exploredNodeIds).toEqual([map.entryId]);
    expect(exploredRatio(map, run)).toBeCloseTo(1 / map.nodes.length, 6);

    const neighbor = map.nodes[map.entryId]!.neighbors[0]!;
    expect(canMoveTo(map, map.entryId, neighbor)).toBe(true);
    // 隔了一格的不能直接走
    const far = map.nodes.find(
      (node) => !node.neighbors.includes(map.entryId) && node.id !== map.entryId,
    )!;
    expect(canMoveTo(map, map.entryId, far.id)).toBe(false);

    const moved = applyMove(map, run, neighbor);
    expect(moved.playerNodeId).toBe(neighbor);
    expect(moved.exploredNodeIds).toEqual([0, neighbor].sort((a, b) => a - b));
    // 探索度随后上升 → 强度也随之上升
    expect(exploredRatio(map, moved)).toBeGreaterThan(exploredRatio(map, run));
  });
});

describe('强度', () => {
  it('随探索度单调不减，精英是普通的 1.5 倍、Boss 是 2 倍', () => {
    let previous = baseStrength('normal', 0);
    for (let explored = 0; explored <= 1; explored += 0.1) {
      const value = baseStrength('normal', explored);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
    expect(baseStrength('elite', 0.5)).toBeCloseTo(baseStrength('normal', 0.5) * 1.5, 6);
    expect(baseStrength('boss', 0.5)).toBeCloseTo(baseStrength('normal', 0.5) * 2, 6);
  });

  it('预览取区间均值（1.05），实战掷骰落在 0.9–1.2 之间且均值贴近预览', () => {
    const base = baseStrength('normal', 0.4);
    expect(previewStrength('normal', 0.4)).toBeCloseTo(base * 1.05, 6);

    const rng = createRng(12345);
    let sum = 0;
    const samples = 500;
    for (let i = 0; i < samples; i += 1) {
      const value = rollStrength(rng, 'normal', 0.4);
      expect(value).toBeGreaterThanOrEqual(base * 0.9 - 1e-9);
      expect(value).toBeLessThanOrEqual(base * 1.2 + 1e-9);
      sum += value;
    }
    expect(sum / samples).toBeCloseTo(previewStrength('normal', 0.4), 1);
  });
});

describe('敌方牌组', () => {
  it('张数夹在 [6, 12]；实战强度区间内就是 12（接口的硬上限）', () => {
    /*
      **这条断言读起来有点扫兴，但它是事实。** 旧版的范围是 6–16
      （旧引擎没有 12 张上限），而本项目的引擎上限正好是 12：
      端口公式在强度 0.5 时就已经算出 11.7 → 12，之后一路夹到 12。
      也就是说**敌方牌组张数在这一作里恒为 12**，强度只通过稀有度分布体现
      （见下一条）。这是引擎上限带来的既定后果，不是公式写错了。
    */
    for (const strength of [0.5, 0.8, 1, 1.5, 2, 3, 9]) {
      expect(mazeDeckSize(strength)).toBe(12);
    }
    expect(MAZE_DECK_SIZE_LIMITS[0]).toBe(6);
    expect(MAZE_DECK_SIZE_LIMITS[1]).toBe(12);
  });

  it('生成出来的牌组长度等于张数，且只含三个桶里的稀有度（没有活动卡）', () => {
    const buckets = new Set<string>([
      ...MAZE_RARITY_BUCKETS.low,
      ...MAZE_RARITY_BUCKETS.mid,
      ...MAZE_RARITY_BUCKETS.high,
    ]);
    for (const seed of SEEDS.slice(0, 6)) {
      const rng = createRng(seed);
      const deck = generateMazeEnemyDeck(rng, 1.4, pool);
      expect(deck).toHaveLength(mazeDeckSize(1.4));
      for (const cardId of deck) {
        const rarity = cardDatabase.definitions.find((card) => card.cardId === cardId)?.rarity;
        expect(rarity, `${cardId} 不在数据里`).toBeDefined();
        expect(buckets.has(rarity!)).toBe(true);
        expect(rarity).not.toBe(MAZE_EVENT_RARITY);
      }
    }
  });

  it('同种子两次全等；强度越高，高稀有度越多', () => {
    const deckA = generateMazeEnemyDeck(createRng(77), 1, pool);
    const deckB = generateMazeEnemyDeck(createRng(77), 1, pool);
    expect(deckB).toEqual(deckA);

    const highSet = new Set<string>(MAZE_RARITY_BUCKETS.high);
    const rarityOf = (cardId: string): string =>
      cardDatabase.definitions.find((card) => card.cardId === cardId)?.rarity ?? '';
    const countHigh = (strength: number): number => {
      const rng = createRng(4242);
      let high = 0;
      for (let i = 0; i < 20; i += 1) {
        high += generateMazeEnemyDeck(rng, strength, pool).filter((cardId) =>
          highSet.has(rarityOf(cardId)),
        ).length;
      }
      return high;
    };
    expect(countHigh(2.5)).toBeGreaterThan(countHigh(0.9));
  });
});

describe('奖励', () => {
  it('金币与经验按强度缩放，徽章按节点类型加码', () => {
    const normal = mazeReward({ rng: createRng(1), nodeType: 'normal', strength: 1.5, pool });
    expect(normal.gold).toBe(Math.round(MAZE_REWARD.gold * 1.5));
    expect(normal.xp).toBe(Math.round(MAZE_REWARD.xp * 1.5));

    // 强度低于 0.5 时按 0.5 兜底
    const weak = mazeReward({ rng: createRng(1), nodeType: 'normal', strength: 0.1, pool });
    expect(weak.gold).toBe(Math.round(MAZE_REWARD.gold * 0.5));

    const [lo, hi] = MAZE_REWARD.badgeRange;
    expect(normal.badges).toBeGreaterThanOrEqual(lo);
    expect(normal.badges).toBeLessThanOrEqual(hi);

    const elite = mazeReward({ rng: createRng(2), nodeType: 'elite', strength: 1, pool });
    expect(elite.badges).toBeGreaterThanOrEqual(lo + MAZE_REWARD.badgeElite);
    expect(elite.badges).toBeLessThanOrEqual(hi + MAZE_REWARD.badgeElite);

    const boss = mazeReward({ rng: createRng(3), nodeType: 'boss', strength: 1, pool });
    expect(boss.badges).toBeGreaterThanOrEqual(lo + MAZE_REWARD.badgeBoss);
    expect(boss.badges).toBeLessThanOrEqual(hi + MAZE_REWARD.badgeBoss);
  });

  it('掉落只可能是活动卡；掉率高的节点确实更容易掉', () => {
    // 旧版的三档掉率：普通 2% / 精英 5% / Boss 20%
    expect(MAZE_EVENT_CARD_DROP['normal']).toBe(0.02);
    expect(MAZE_EVENT_CARD_DROP['elite']).toBe(0.05);
    expect(MAZE_EVENT_CARD_DROP['boss']).toBe(0.2);
    // 入口与商店节点不发奖励，掉率为 0
    expect(MAZE_EVENT_CARD_DROP['entry']).toBe(0);
    expect(MAZE_EVENT_CARD_DROP['supply']).toBe(0);

    const normalDrops = Array.from({ length: 400 }, (_, i) =>
      mazeReward({ rng: createRng(1000 + i), nodeType: 'normal', strength: 1, pool }),
    );
    // 2% 在 400 次抽样下掉个位数；没掉的时候要有那一行说明
    expect(normalDrops.filter((reward) => reward.cardId !== null).length).toBeLessThan(30);
    expect(normalDrops[0]!.lines.length).toBeGreaterThan(0);

    const eventCards = new Set(pool.get(MAZE_EVENT_RARITY as never) ?? []);
    let sawDrop = false;
    for (let i = 0; i < 200; i += 1) {
      const reward = mazeReward({ rng: createRng(2000 + i), nodeType: 'boss', strength: 1, pool });
      if (reward.cardId) {
        sawDrop = true;
        expect(eventCards.has(reward.cardId)).toBe(true);
        expect(reward.cardRarity).toBe(MAZE_EVENT_RARITY);
      }
    }
    expect(sawDrop).toBe(true);
  });
});

describe('楼层商店', () => {
  const priceByRarity = shops.normalShop!.priceByRarity;
  const fallback = shops.normalShop!.unknownRarityFallback;
  const cardsByRarity = ((): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const card of cardDatabase.definitions) {
      if (card.status !== 'complete') {
        continue;
      }
      const list = map.get(card.rarity) ?? [];
      list.push(card.cardId);
      map.set(card.rarity, list);
    }
    return map;
  })();

  const build = (seed: number, eventChance: number) =>
    buildMazeShop({
      rng: createRng(seed),
      cardsByRarity,
      priceByRarity,
      fallbackPrice: fallback,
      eventChance,
    });

  it('固定三件，最多一张活动卡，普通位不重复', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const items = build(seed, 0.5);
      expect(items).toHaveLength(MAZE_SHOP.cardCount);
      expect(items.filter((item) => item.isEvent).length).toBeLessThanOrEqual(1);
      const regular = items.filter((item) => !item.isEvent);
      expect(new Set(regular.map((item) => item.cardId)).size).toBe(regular.length);
      // 活动卡一定带「活动限定」标签
      const event = items.find((item) => item.isEvent);
      if (event) {
        expect(event.label).toBe('活动限定');
      }
    }
  });

  it('活动卡按 SSS 档定价：551 水晶 ×1.2 = 661（旧版这里是 1440）', () => {
    const items = build(3, 1);
    const event = items.find((item) => item.isEvent);
    expect(event).toBeDefined();
    expect(event?.price).toEqual({ currency: 'crystal', amount: 661 });
    // 绝不可能落到兜底价（旧版的缺陷就是落了兜底又被当成水晶）
    expect(event?.price.amount).toBeLessThan(1440);
  });

  it('普通位按稀有度价目打折，且不低于下限', () => {
    const items = build(5, 0);
    expect(items.every((item) => !item.isEvent)).toBe(true);
    for (const item of items) {
      const base = priceByRarity[item.rarity] ?? fallback;
      expect(item.price.currency).toBe(base.currency);
      expect(item.price.amount).toBe(
        Math.max(MAZE_SHOP.minRegular, Math.round(base.amount * MAZE_SHOP.regularDiscount)),
      );
      expect(item.price.amount).toBeGreaterThanOrEqual(MAZE_SHOP.minRegular);
    }
  });

  it('商店种子与命名空间随楼层/run/节点变化，同一组稳定', () => {
    expect(mazeShopSeed(MAZE_FLOOR_1, 1, 3)).toBe(mazeShopSeed(MAZE_FLOOR_1, 1, 3));
    expect(mazeShopSeed(MAZE_FLOOR_1, 1, 3)).not.toBe(mazeShopSeed(MAZE_FLOOR_1, 2, 3));
    expect(mazeShopSeed(MAZE_FLOOR_1, 1, 3)).not.toBe(mazeShopSeed(MAZE_FLOOR_1, 1, 4));
    expect(mazeShopKey(MAZE_FLOOR_1, 1, 3)).toContain('v1');
  });

  it('节点的商店状态懒生成一次，之后固定', () => {
    const map = generateMaze(mazeRngFor(MAZE_FLOOR_1, 1));
    const run = newMazeRun(map, MAZE_FLOOR_1, 1);
    const withShop = withShopState(run, 7);
    expect(withShop.shopByNode['7']?.soldOut).toEqual([]);
    // 再调一次不该替换掉已有状态（比如已经买过的售罄记录）
    const bought: typeof withShop = {
      ...withShop,
      shopByNode: {
        ...withShop.shopByNode,
        '7': { ...withShop.shopByNode['7']!, soldOut: ['x'] },
      },
    };
    expect(withShopState(bought, 7).shopByNode['7']?.soldOut).toEqual(['x']);
  });

  it('权重表覆盖所有常规稀有度：数值越大越容易', () => {
    // `rarities.json` 里还有 `#yoroi`（旧版遗留、本轮无效）与 `#elna`——都不参与敌方牌组
    const rarities = rarityList
      .map((entry) => entry.rarity)
      .filter((rarity) => !rarity.startsWith('#'));
    for (const rarity of rarities) {
      expect(MAZE_SHOP_WEIGHTS[rarity], `缺 ${rarity} 的权重`).toBeDefined();
    }
    expect(MAZE_SHOP_WEIGHTS['D']!).toBeGreaterThan(MAZE_SHOP_WEIGHTS['SSS']!);
  });
});

describe('战斗 id 与通关', () => {
  it('普通/精英每次挑战都是新局，Boss 胜利的 id 稳定', () => {
    const node1 = mazeNodeBattleId(MAZE_FLOOR_1, 1, 12, 3, 1);
    expect(node1).not.toBe(mazeNodeBattleId(MAZE_FLOOR_1, 1, 12, 3, 2));
    expect(mazeBossBattleId(MAZE_FLOOR_1, 1)).toBe(mazeBossBattleId(MAZE_FLOOR_1, 1));
    expect(mazeBossBattleId(MAZE_FLOOR_1, 1)).not.toBe(mazeBossBattleId(MAZE_FLOOR_1, 2));
    // 失败的 id 与胜利的不同，所以输了可以继续试
    expect(mazeBossLossBattleId(MAZE_FLOOR_1, 1, 3, 1)).not.toBe(mazeBossBattleId(MAZE_FLOOR_1, 1));
  });

  it('「已通关」由落盘值推导，换一次 run 就回到未通关', () => {
    const settled = [mazeBossBattleId(MAZE_FLOOR_1, 1)];
    expect(isMazeCleared(settled, MAZE_FLOOR_1, 1)).toBe(true);
    expect(isMazeCleared(settled, MAZE_FLOOR_1, 2)).toBe(false);
    expect(isMazeCleared([], MAZE_FLOOR_1, 1)).toBe(false);
  });
});
