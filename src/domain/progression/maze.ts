/**
 * 第一层迷宫。
 *
 * 移植自旧版 `scenes/activity/maze_scene.py`（1501 行）。**只搬规则与数值，不搬代码**：
 * 旧版把生成、强度、奖励、商店、绘制与存档全塞在一个场景类里，
 * 这里按本项目的划分拆成「纯领域 + 场景屏 + 数据桥」三层。
 *
 * 这一层是**纯函数**：不 import `src/data`、不读时间、不用 `Math.random`
 * （`tests/unit/progression.test.ts` 的静态检查盯着这条），随机一律走注入的 `Rng`。
 *
 * ## 与旧版的三处**有意的**不同
 *
 * 1. **可复现**：旧版用全局 `random`，没有种子——同一层每次加载都可能是另一张图
 *    （靠 `floor1.json` 落盘才保持不变）。这里地图由 `mazeRngFor(floorKey, version)`
 *    纯函数生成，只落 `MazeRunState`（位置/探索/商店种子），刷新逐节点一致。
 * 2. **敌方牌组上界收到 12**：旧版 `TEMP_DECK_SIZE_LIMITS = (6, 16)`，
 *    而本项目的引擎有 12 张的硬上限（`DECK_LIMIT`）。保留 16 只会让所有中高强度的
 *    节点都被裁到 12、张数完全失去意义。强度对张数的影响因此止于 12，
 *    但仍通过**稀有度分布**体现（这一点与旧版一致）。
 * 3. **Boss 是一次性的**：旧版打完 Boss 与普通节点走同一条分支，可以无限重复打、
 *    每次奖励照发（含 20% 活动卡）。这里 Boss 胜利用**稳定 battleId**，
 *    `settledBattleIds` 的去重天然让它只能结算一次；「已通关」由落盘值推导。
 */

import { DECK_LIMIT } from './types';
import type { MazeRunState } from './types';
import { createRng, seedFrom } from '../battle/rng';
import type { Rng } from '../battle/rng';
import type { CardPoolIndex } from './gacha';

/* ---------------------------------------------------------------------------
 * 常量（端口旧版 `maze_scene.py` 的数值）
 * ------------------------------------------------------------------------- */

export const MAZE_FLOOR_1 = 'floor1';

/**
 * 生成算法版本，折进种子串。
 *
 * 改了生成规则就 +1：进行中的 run 里那些「已探索的节点」是按旧算法选的 id，
 * 新算法下会指向别的格子——把版本并进种子，至少让新旧地图不会悄悄地混在一起。
 */
export const MAZE_GENERATOR_VERSION = 1;

export const MAZE_NODE_COUNT_RANGE: readonly [number, number] = [50, 60];
export const MAZE_BOSS_MIN_DISTANCE = 5;
/** 旧版整轮重生成，最多试 6 次要求 Boss 够远；仍不满足就强制接受。 */
export const MAZE_BOSS_GEN_RETRIES = 6;
/** 分类配额：精英 1 : 商店 2 : 普通 8。**只看配额，不看距离**（旧版如此）。 */
export const MAZE_RATIOS: Readonly<Record<'elite' | 'supply' | 'normal', number>> = {
  elite: 1,
  supply: 2,
  normal: 8,
};
export const MAZE_TYPE_MULTIPLIER: Readonly<Record<MazeNodeType, number>> = {
  entry: 1,
  normal: 1,
  elite: 1.5,
  boss: 2,
  supply: 1,
};
export const MAZE_STRENGTH_RANGE: readonly [number, number] = [0.9, 1.2];
/** 每探索一个节点，强度涨这么多（乘在强度上，不是加法）。 */
export const MAZE_EXPLORED_FACTOR = 0.6;
export const MAZE_DECK_SIZE_BASE = 12;
/** 见文件头第 2 条：上界从旧版的 16 收到引擎的 12。 */
export const MAZE_DECK_SIZE_LIMITS: readonly [number, number] = [6, DECK_LIMIT];

/** 敌方牌组的稀有度桶（旧版 `RARITY_BUCKETS`）。活动稀有度不在任何桶里。 */
export const MAZE_RARITY_BUCKETS = {
  low: ['D', 'C', 'C+'],
  mid: ['B', 'B+', 'A', 'A+'],
  high: ['S', 'S+', 'SS', 'SS+', 'SSS'],
} as const;

export const MAZE_EVENT_RARITY = '#elna';

export const MAZE_REWARD = {
  gold: 500,
  xp: 200,
  badgeRange: [5, 15] as const,
  badgeElite: 50,
  badgeBoss: 100,
} as const;

/** 活动卡掉落概率（旧版 `MAZE_EVENT_CARD_DROP`）。 */
export const MAZE_EVENT_CARD_DROP: Readonly<Record<MazeNodeType, number>> = {
  entry: 0,
  normal: 0.02,
  elite: 0.05,
  boss: 0.2,
  supply: 0,
};

export const MAZE_SHOP = {
  cardCount: 3,
  /** 普通位折扣、活动位加价（旧版 `REGULAR_DISCOUNT` / `EVENT_PRICE_MULTIPLIER`）。 */
  regularDiscount: 0.85,
  eventMultiplier: 1.2,
  minRegular: 50,
  minEvent: 75,
  /**
   * 活动卡的价位。
   *
   * 旧版的价格表里**没有** `#elna` → 落兜底的 1200 金币 → 活动位又强制改成水晶 ×1.2
   * → **1440 水晶**，是全表最贵的 2.6 倍（SSS 才 551）。那是「兜底价恰好是金币、
   * 又被当成水晶用」的类型错配，不是设计。
   * 这里按 `#elna` 与 SSS 在稀有度表里**同级**这一点定价：551 水晶，再乘活动位的 1.2。
   */
  eventPrice: { currency: 'crystal', amount: 551 },
} as const;

/** 普通位按稀有度的抽取权重（旧版 `SHOP_RARITY_WEIGHTS`，**数值越大越容易**）。 */
export const MAZE_SHOP_WEIGHTS: Readonly<Record<string, number>> = {
  SSS: 0.28,
  'SS+': 0.35,
  SS: 0.45,
  'S+': 0.6,
  S: 0.75,
  'A+': 0.9,
  A: 1.0,
  'B+': 1.05,
  B: 1.1,
  'C+': 1.18,
  C: 1.22,
  D: 1.25,
};

/* ---------------------------------------------------------------------------
 * 类型
 * ------------------------------------------------------------------------- */

export type MazeNodeType = 'entry' | 'normal' | 'elite' | 'boss' | 'supply';

export interface MazeNode {
  readonly id: number;
  readonly grid: readonly [number, number];
  /** **升序**、双向。 */
  readonly neighbors: readonly number[];
  readonly type: MazeNodeType;
  /** 到入口的 BFS 步数。 */
  readonly distance: number;
}

export interface MazeMap {
  readonly nodes: readonly MazeNode[];
  readonly entryId: number;
  readonly bossId: number;
  readonly bossDistance: number;
  /** 6 次重生成都没让 Boss 够远，只能强制接受——界面要如实说出来。 */
  readonly bossForced: boolean;
  readonly seed: number;
}

export interface MazeGenOptions {
  readonly target?: number;
  readonly nodeCountRange?: readonly [number, number];
}

/* ---------------------------------------------------------------------------
 * 种子
 * ------------------------------------------------------------------------- */

/**
 * 本层第 `version` 次 run 的地图种子。
 *
 * **`version` 就是「这张图是第几次开的」**：同一个 run 里恒定（刷新逐节点一致），
 * 「重新开始一层」时 +1（换一张新图）。
 */
export function mazeSeedFor(floorKey: string, version: number): number {
  return seedFrom(`maze:v${MAZE_GENERATOR_VERSION}:${floorKey}:${version}`);
}

export function mazeRngFor(floorKey: string, version: number): Rng {
  return createRng(mazeSeedFor(floorKey, version));
}

/* ---------------------------------------------------------------------------
 * 生成
 * ------------------------------------------------------------------------- */

const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * 稀疏网格生长（旧版 `_build_sparse_layout`）。
 *
 * 四个方向、先掷跳过、再看 3×3 密度门限——「稀疏」就是这两条造出来的。
 * 每轮最多长 1 个节点，所以「尝试次数上限」是必需的（旧版 `max(360, target*85)`）。
 */
function growGraph(rng: Rng, target: number): {
  coords: Map<number, readonly [number, number]>;
  neighbors: Set<number>[];
} {
  const byCell = new Map<string, number>();
  const coords = new Map<number, readonly [number, number]>();
  const neighbors: Set<number>[] = [];

  const add = (x: number, y: number): number => {
    const id = coords.size;
    coords.set(id, [x, y]);
    neighbors.push(new Set());
    byCell.set(keyOf(x, y), id);
    return id;
  };

  add(0, 0);

  const degreeCap = (id: number): number => (id === 0 ? 4 : 3);

  const densityAround = (x: number, y: number): number => {
    let count = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (byCell.has(keyOf(x + dx, y + dy))) {
          count += 1;
        }
      }
    }
    return count;
  };

  const maxAttempts = Math.max(360, target * 85);

  for (let attempt = 0; attempt < maxAttempts && coords.size < target; attempt += 1) {
    const expandable: number[] = [];
    const leaves: number[] = [];
    const sparse: number[] = [];
    for (const [id] of coords) {
      if (neighbors[id]!.size >= degreeCap(id)) {
        continue;
      }
      expandable.push(id);
      if (neighbors[id]!.size <= 1) {
        leaves.push(id);
      } else if (neighbors[id]!.size <= 2) {
        sparse.push(id);
      }
    }
    if (expandable.length === 0) {
      break;
    }

    // 基节点：叶子 0.4 命中 / 度≤2 的 0.7 / 都不中则全池随机（旧版口径）
    const roll = rng.next();
    const base =
      roll < 0.4 && leaves.length > 0
        ? rng.pick(leaves)
        : roll < 0.7 && sparse.length > 0
          ? rng.pick(sparse)
          : rng.pick(expandable);

    const progress = coords.size / target;
    const skipFactor = progress < 0.5 ? 0.35 : 0.25;
    const densityCap = progress < 0.35 ? 2 : progress < 0.7 ? 3 : 4;

    const [bx, by] = coords.get(base)!;
    const dirs = rng.shuffle([...DIRS]);
    for (const [dx, dy] of dirs) {
      if (rng.next() < skipFactor) {
        continue;
      }
      const nx = bx + dx;
      const ny = by + dy;
      if (byCell.has(keyOf(nx, ny))) {
        continue;
      }
      if (densityAround(nx, ny) > densityCap) {
        continue;
      }
      const id = add(nx, ny);
      neighbors[base]!.add(id);
      neighbors[id]!.add(base);
      attachSideLinks(rng, id, coords, byCell, neighbors);
      break;
    }
  }

  return { coords, neighbors };
}

/** 侧链：新节点与**已存在但尚未相连**的 4 邻，按度数之和决定概率（旧版 `_attach_side_links`）。 */
function attachSideLinks(
  rng: Rng,
  id: number,
  coords: Map<number, readonly [number, number]>,
  byCell: Map<string, number>,
  neighbors: Set<number>[],
): void {
  const [x, y] = coords.get(id)!;
  for (const [dx, dy] of DIRS) {
    const other = byCell.get(keyOf(x + dx, y + dy));
    if (other === undefined || other === id || neighbors[id]!.has(other)) {
      continue;
    }
    const sum = neighbors[id]!.size + neighbors[other]!.size;
    const chance = sum < 5 ? 0.25 : 0.12;
    if (rng.next() < chance) {
      neighbors[id]!.add(other);
      neighbors[other]!.add(id);
    }
  }
}

/** 额外链：全生成完再扫一遍（旧版 `_add_extra_links`）。 */
function addExtraLinks(
  rng: Rng,
  coords: Map<number, readonly [number, number]>,
  byCell: Map<string, number>,
  neighbors: Set<number>[],
): void {
  for (const [id] of coords) {
    neighbors[id] = new Set(neighbors[id]);
  }
  for (const [id] of coords) {
    const [x, y] = coords.get(id)!;
    for (const [dx, dy] of DIRS) {
      const other = byCell.get(keyOf(x + dx, y + dy));
      if (other === undefined || other <= id) {
        continue;
      }
      if (neighbors[id]!.has(other)) {
        continue;
      }
      const sum = neighbors[id]!.size + neighbors[other]!.size;
      const chance = sum < 5 ? 0.3 : 0.12;
      if (rng.next() < chance) {
        neighbors[id]!.add(other);
        neighbors[other]!.add(id);
      }
    }
  }
}

/**
 * 清理邻居表：滤自环、悬空 id、**曼哈顿距离 ≠ 1** 的邻居，双向重建并升序。
 *
 * 旧版读档时也要跑一遍（防篡改与旧版脏数据）；这里只在生成后跑，
 * 因为地图不落盘——落盘的是「玩家走到哪、探索了哪些」。
 */
function sanitizeNeighbors(
  coords: Map<number, readonly [number, number]>,
  neighbors: Set<number>[],
): Map<number, number[]> {
  const clean = new Map<number, number[]>();
  for (const [id, list] of neighbors.entries()) {
    const [x, y] = coords.get(id)!;
    const keep = new Set<number>();
    for (const other of list) {
      const pos = coords.get(other);
      if (other === id || !pos) {
        continue;
      }
      if (Math.abs(pos[0] - x) + Math.abs(pos[1] - y) !== 1) {
        continue;
      }
      keep.add(other);
    }
    clean.set(id, [...keep].sort((a, b) => a - b));
  }
  // 双向补齐：主/侧/额外链都是双向加的，这里是兜底
  for (const [id, list] of clean.entries()) {
    for (const other of list) {
      const back = clean.get(other);
      if (back && !back.includes(id)) {
        back.push(id);
        back.sort((a, b) => a - b);
      }
    }
  }
  return clean;
}

/** 从入口 BFS。返回 `id → 步数`。 */
export function bfsDistances(neighbors: ReadonlyMap<number, readonly number[]>, entryId: number): number[] {
  const distances: number[] = [];
  const seen = new Set<number>([entryId]);
  const queue: number[] = [entryId];
  distances[entryId] = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of neighbors.get(id) ?? []) {
      if (seen.has(next)) {
        continue;
      }
      seen.add(next);
      distances[next] = (distances[id] ?? 0) + 1;
      queue.push(next);
    }
  }
  return distances;
}

/**
 * 分类：**按配额随机，不看距离**。
 *
 * `floor(remaining × ratio_k / Σratio)`，余数按比值降序（普通 → 商店 → 精英）逐一分。
 * 53 个可分配节点 → 普通 39 / 商店 10 / 精英 4，这正是旧版「55 节点典型值」的来源。
 */
export function classifyNodes(
  rng: Rng,
  nodeIds: readonly number[],
  entryId: number,
  bossId: number,
  ratios: Readonly<Record<'elite' | 'supply' | 'normal', number>> = MAZE_RATIOS,
): Map<number, MazeNodeType> {
  const pool = nodeIds.filter((id) => id !== entryId && id !== bossId);
  const shuffled = rng.shuffle([...pool]);
  const total = ratios.elite + ratios.supply + ratios.normal;
  const remaining = shuffled.length;

  const order: ('normal' | 'supply' | 'elite')[] = ['normal', 'supply', 'elite'];
  const counts = new Map<'normal' | 'supply' | 'elite', number>();
  let assigned = 0;
  for (const kind of order) {
    const count = Math.floor((remaining * ratios[kind]) / total);
    counts.set(kind, count);
    assigned += count;
  }
  // 余数按比值降序补（normal 8 → supply 2 → elite 1）
  let index = 0;
  while (assigned < remaining) {
    const kind = order[index % order.length]!;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    assigned += 1;
    index += 1;
  }

  const types = new Map<number, MazeNodeType>();
  types.set(entryId, 'entry');
  types.set(bossId, 'boss');
  let cursor = 0;
  for (const kind of order) {
    for (let i = 0; i < (counts.get(kind) ?? 0); i += 1) {
      const id = shuffled[cursor];
      cursor += 1;
      if (id !== undefined) {
        types.set(id, kind);
      }
    }
  }
  for (const id of nodeIds) {
    if (!types.has(id)) {
      types.set(id, 'normal');
    }
  }
  return types;
}

/** 生成一层。重复调用同一个 `rng` 会得到不同的图，同一个种子必然得到同一张图。 */
export function generateMaze(rng: Rng, options: MazeGenOptions = {}): MazeMap {
  const [min, max] = options.nodeCountRange ?? MAZE_NODE_COUNT_RANGE;
  const target = options.target ?? rng.int(min, max);
  const seed = rng.snapshot().state;

  let best: { coords: Map<number, readonly [number, number]>; neighbors: Map<number, number[]>; bossId: number; distance: number } | null = null;
  let forced = false;

  // 旧版整轮重生成最多 6 次，要求 Boss 离入口足够远
  for (let attempt = 0; attempt < MAZE_BOSS_GEN_RETRIES; attempt += 1) {
    const raw = growGraph(rng, target);
    addExtraLinks(rng, raw.coords, new Map([...raw.coords].map(([id, pos]) => [keyOf(pos[0], pos[1]), id])), raw.neighbors);
    const clean = sanitizeNeighbors(raw.coords, raw.neighbors);
    const distances = bfsDistances(clean, 0);
    let bossId = 0;
    let bossDistance = 0;
    for (const [id, distance] of distances.entries()) {
      if (distance > bossDistance) {
        bossId = id;
        bossDistance = distance;
      }
    }
    best = { coords: raw.coords, neighbors: clean, bossId, distance: bossDistance };
    if (bossDistance >= MAZE_BOSS_MIN_DISTANCE) {
      break;
    }
  }

  if (!best) {
    // 理论上到不了：practically 上一次循环至少会跑一轮
    const raw = growGraph(rng, Math.max(5, target));
    const clean = sanitizeNeighbors(raw.coords, raw.neighbors);
    const distances = bfsDistances(clean, 0);
    let bossId = 0;
    let bossDistance = 0;
    for (const [id, distance] of distances.entries()) {
      if (distance > bossDistance) {
        bossId = id;
        bossDistance = distance;
      }
    }
    best = { coords: raw.coords, neighbors: clean, bossId, distance: bossDistance };
  }

  if (best.distance < MAZE_BOSS_MIN_DISTANCE) {
    // 6 次都没够远：旧版是强制接受最远的那个。这里如实标出来
    forced = true;
  }

  const ids = [...best.coords.keys()].sort((a, b) => a - b);
  const types = classifyNodes(rng, ids, 0, best.bossId);
  const distances = bfsDistances(best.neighbors, 0);

  const nodes: MazeNode[] = ids.map((id) => ({
    id,
    grid: best.coords.get(id)!,
    neighbors: best.neighbors.get(id) ?? [],
    type: types.get(id) ?? 'normal',
    distance: distances[id] ?? 0,
  }));

  return {
    nodes,
    entryId: 0,
    bossId: best.bossId,
    bossDistance: best.distance,
    bossForced: forced,
    seed,
  };
}

/* ---------------------------------------------------------------------------
 * 移动与探索
 * ------------------------------------------------------------------------- */

/** 只能走到**直接邻居**（旧版 `_can_move_to`：无跳跃、无代价、可回头）。 */
export function canMoveTo(map: MazeMap, fromId: number, toId: number): boolean {
  return map.nodes[fromId]?.neighbors.includes(toId) ?? false;
}

/** 落位：位置改成目标，探索集并入目标。**纯函数**，返回新的 run。 */
export function applyMove(map: MazeMap, run: MazeRunState, toId: number): MazeRunState {
  const explored = new Set(run.exploredNodeIds);
  explored.add(map.entryId);
  explored.add(toId);
  return {
    ...run,
    playerNodeId: toId,
    exploredNodeIds: [...explored].sort((a, b) => a - b),
  };
}

/** 已探索比例。强度就靠它递增（旧版 `_get_explored_ratio`）。 */
export function exploredRatio(map: MazeMap, run: MazeRunState): number {
  if (map.nodes.length === 0) {
    return 0;
  }
  return run.exploredNodeIds.length / map.nodes.length;
}

/** 全新的 run（位置在入口、只探索了入口）。 */
export function newMazeRun(map: MazeMap, floorKey: string, version: number): MazeRunState {
  return {
    floorKey,
    version,
    playerNodeId: map.entryId,
    exploredNodeIds: [map.entryId],
    shopByNode: {},
  };
}

/* ---------------------------------------------------------------------------
 * 强度
 * ------------------------------------------------------------------------- */

/** `1.0 × (1 + 探索度 × 0.6) × 类型倍率`。 */
export function baseStrength(type: MazeNodeType, explored: number): number {
  return (1 + explored * MAZE_EXPLORED_FACTOR) * MAZE_TYPE_MULTIPLIER[type];
}

/** 预览用均值（旧版 `use_average_random`）：`(0.9+1.2)/2 = 1.05`。 */
export function previewStrength(type: MazeNodeType, explored: number): number {
  const [lo, hi] = MAZE_STRENGTH_RANGE;
  return baseStrength(type, explored) * ((lo + hi) / 2);
}

/** 实战掷一次（旧版 `random.uniform(0.9, 1.2)`）。 */
export function rollStrength(rng: Rng, type: MazeNodeType, explored: number): number {
  const [lo, hi] = MAZE_STRENGTH_RANGE;
  return baseStrength(type, explored) * (lo + rng.next() * (hi - lo));
}

/* ---------------------------------------------------------------------------
 * 敌方牌组（现生成，不查表）
 * ------------------------------------------------------------------------- */

/** `clamp(round(12 × (0.8 + min(s,3) × 0.35)), 6, 12)` —— 上界见文件头第 2 条。 */
export function mazeDeckSize(strength: number): number {
  const [lo, hi] = MAZE_DECK_SIZE_LIMITS;
  const scaled = MAZE_DECK_SIZE_BASE * (0.8 + Math.min(strength, 3) * 0.35);
  const size = Math.round(scaled);
  return Math.max(lo, Math.min(hi, size));
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * 现生成一副敌方牌组。
 *
 * 每张牌先选桶（高/中/低），桶内**先等概率选稀有度、再等概率选卡**；
 * 强度越高越容易落进高档桶。活动稀有度不在任何桶里，所以不会出现在敌方牌组里
 * （与旧版一致）。
 */
export function generateMazeEnemyDeck(
  rng: Rng,
  strength: number,
  pool: CardPoolIndex,
): readonly string[] {
  const size = mazeDeckSize(strength);
  const highBias = clamp(0.25 + (strength - 1) * 0.2, 0.05, 0.75);
  const midBias = clamp(0.4 + (strength - 0.8) * 0.2, 0.2, 0.9);

  const pickFromBucket = (rarities: readonly string[]): string | null => {
    const available = rarities.filter((rarity) => (pool.get(rarity as never) ?? []).length > 0);
    if (available.length === 0) {
      return null;
    }
    const rarity = rng.pick(available);
    const cards = pool.get(rarity as never) ?? [];
    return rng.pick(cards);
  };

  const deck: string[] = [];
  for (let index = 0; index < size; index += 1) {
    const roll = rng.next();
    let cardId: string | null = null;
    if (roll < highBias) {
      cardId = pickFromBucket(MAZE_RARITY_BUCKETS.high);
    } else if (roll < midBias) {
      cardId = pickFromBucket(MAZE_RARITY_BUCKETS.mid);
    }
    if (cardId === null) {
      cardId = pickFromBucket(MAZE_RARITY_BUCKETS.low);
    }
    if (cardId === null) {
      // 三个桶都空（数据缺失）：退到「全池非空稀有度等概率」
      const keys = [...pool.keys()].filter((key) => (pool.get(key) ?? []).length > 0);
      if (keys.length === 0) {
        break;
      }
      cardId = rng.pick(pool.get(rng.pick(keys)) ?? []);
    }
    deck.push(cardId);
  }
  return deck;
}

/* ---------------------------------------------------------------------------
 * 奖励
 * ------------------------------------------------------------------------- */

export interface MazeReward {
  readonly gold: number;
  readonly xp: number;
  readonly badges: number;
  readonly cardId: string | null;
  readonly cardRarity: string | null;
  /** 逐条给玩家看的说明。 */
  readonly lines: readonly string[];
}

/**
 * 通关奖励。
 *
 * `gold = round(500 × max(0.5, s))`、`xp = round(200 × max(0.5, s))`，
 * 徽章 `5–15` 再加精英 50 / Boss 100。
 * **掉率为 0 的节点不消耗随机数**——否则「同一场战斗的掉落」会被预览与结算的调用次数影响。
 */
export function mazeReward(args: {
  readonly rng: Rng;
  readonly nodeType: MazeNodeType;
  readonly strength: number;
  readonly pool: CardPoolIndex;
}): MazeReward {
  const strength = Math.max(0.5, args.strength);
  const gold = Math.max(1, Math.round(MAZE_REWARD.gold * strength));
  const xp = Math.max(1, Math.round(MAZE_REWARD.xp * strength));
  const [lo, hi] = MAZE_REWARD.badgeRange;
  const bonus =
    args.nodeType === 'elite'
      ? MAZE_REWARD.badgeElite
      : args.nodeType === 'boss'
        ? MAZE_REWARD.badgeBoss
        : 0;
  const badges = args.rng.int(lo, hi) + bonus;

  const chance = MAZE_EVENT_CARD_DROP[args.nodeType];
  let cardId: string | null = null;
  if (chance > 0 && args.rng.chance(chance)) {
    const eventCards = args.pool.get(MAZE_EVENT_RARITY as never) ?? [];
    if (eventCards.length > 0) {
      cardId = args.rng.pick(eventCards);
    }
  }

  const lines = [
    `金币 +${gold}`,
    `经验 +${xp}`,
    `徽章 +${badges}`,
    `奖励倍数 x${strength.toFixed(2)}`,
    cardId ? `活动限定卡牌：${cardId}` : '本次没有掉落卡牌',
  ];
  return { gold, xp, badges, cardId, cardRarity: cardId ? MAZE_EVENT_RARITY : null, lines };
}

/**
 * 奖励的**预览**（详情面板用，不消耗随机数）。
 *
 * `mazeReward` 会推进随机流——拿它做预览会让「预览」与「实战」掷的不是同一次，
 * 而且面板每渲染一次都会多掷一次。这里只给确定性部分：金币/经验按当前强度算，
 * 徽章给区间，活动卡给概率。
 */
export function mazeRewardPreview(args: {
  readonly nodeType: MazeNodeType;
  readonly strength: number;
}): {
  readonly gold: number;
  readonly xp: number;
  readonly badgeRange: readonly [number, number];
  readonly dropChance: number;
  readonly lines: readonly string[];
} {
  const strength = Math.max(0.5, args.strength);
  const gold = Math.max(1, Math.round(MAZE_REWARD.gold * strength));
  const xp = Math.max(1, Math.round(MAZE_REWARD.xp * strength));
  const bonus =
    args.nodeType === 'elite'
      ? MAZE_REWARD.badgeElite
      : args.nodeType === 'boss'
        ? MAZE_REWARD.badgeBoss
        : 0;
  const [lo, hi] = MAZE_REWARD.badgeRange;
  const dropChance = MAZE_EVENT_CARD_DROP[args.nodeType];
  return {
    gold,
    xp,
    badgeRange: [lo + bonus, hi + bonus],
    dropChance,
    lines: [
      `金币 +${gold}`,
      `经验 +${xp}`,
      `徽章 +${lo + bonus}–${hi + bonus}`,
      dropChance > 0 ? `活动限定卡牌 ${Math.round(dropChance * 100)}%` : '本次没有掉落卡牌',
    ],
  };
}

/* ---------------------------------------------------------------------------
 * 楼层商店
 * ------------------------------------------------------------------------- */

export interface MazeShopItem {
  readonly cardId: string;
  readonly rarity: string;
  readonly isEvent: boolean;
  /** 「活动限定」/「迷宫补给」。 */
  readonly label: string;
  readonly price: { readonly currency: 'gold' | 'crystal' | 'badge'; readonly amount: number };
}

export function mazeShopSeed(floorKey: string, version: number, nodeId: number): number {
  return seedFrom(`mazeShop:${floorKey}:v${version}:n${nodeId}`);
}

/** 售罄标识与商店种子的命名空间（含楼层与 run，重开一层自然失效）。 */
export function mazeShopKey(floorKey: string, version: number, nodeId: number): string {
  return `maze:${floorKey}:v${version}:n${nodeId}`;
}

function shopPrice(
  rarity: string,
  isEvent: boolean,
  priceByRarity: Readonly<Record<string, { currency: string; amount: number }>>,
  fallback: { currency: string; amount: number },
): MazeShopItem['price'] {
  // 活动卡优先查自己的价位（旧版这里落兜底 → 1440 水晶，见 MAZE_SHOP 的注释）
  const base = isEvent
    ? priceByRarity[MAZE_EVENT_RARITY] ?? MAZE_SHOP.eventPrice
    : priceByRarity[rarity] ?? fallback;
  const currency = isEvent ? 'crystal' : (base.currency as 'gold' | 'crystal' | 'badge');
  const amount = isEvent
    ? Math.max(MAZE_SHOP.minEvent, Math.round(base.amount * MAZE_SHOP.eventMultiplier))
    : Math.max(MAZE_SHOP.minRegular, Math.round(base.amount * MAZE_SHOP.regularDiscount));
  return { currency, amount };
}

/**
 * 某个补给节点的货架：**最多 1 张活动卡 + 2~3 张普通卡**，普通位不放回。
 *
 * 普通位按稀有度权重抽——用「按权重展开候选池、洗牌、取前 N」实现，
 * 而不是「抽中了重抽」：后者既可能死循环，也会让靠前的卡统计上更容易出现。
 */
export function buildMazeShop(args: {
  readonly rng: Rng;
  readonly cardsByRarity: ReadonlyMap<string, readonly string[]>;
  readonly priceByRarity: Readonly<Record<string, { currency: string; amount: number }>>;
  readonly fallbackPrice: { currency: string; amount: number };
  /** 活动卡是否上架的概率（旧版是「抽得到就占一格」）。 */
  readonly eventChance?: number;
}): readonly MazeShopItem[] {
  const items: MazeShopItem[] = [];

  const eventCards = args.cardsByRarity.get(MAZE_EVENT_RARITY) ?? [];
  const eventChance = args.eventChance ?? 0.5;
  if (eventCards.length > 0 && args.rng.chance(eventChance)) {
    const cardId = args.rng.pick(eventCards);
    items.push({
      cardId,
      rarity: MAZE_EVENT_RARITY,
      isEvent: true,
      label: '活动限定',
      price: shopPrice(MAZE_EVENT_RARITY, true, args.priceByRarity, args.fallbackPrice),
    });
  }

  // 普通位：把每个稀有度按权重摊成候选条目，洗牌后取前 N
  const pool: { cardId: string; rarity: string }[] = [];
  for (const [rarity, cards] of args.cardsByRarity.entries()) {
    if (rarity === MAZE_EVENT_RARITY) {
      continue;
    }
    const weight = MAZE_SHOP_WEIGHTS[rarity] ?? 0.5;
    // 权重是「相对容易程度」：用重复次数近似——取整后至少 1 次
    const repeats = Math.max(1, Math.round(weight * 8));
    for (let i = 0; i < repeats; i += 1) {
      for (const cardId of cards) {
        pool.push({ cardId, rarity });
      }
    }
  }
  const shuffled = args.rng.shuffle(pool);
  const taken = new Set<string>();
  for (const candidate of shuffled) {
    if (items.length >= MAZE_SHOP.cardCount) {
      break;
    }
    if (taken.has(candidate.cardId)) {
      continue;
    }
    taken.add(candidate.cardId);
    items.push({
      cardId: candidate.cardId,
      rarity: candidate.rarity,
      isEvent: false,
      label: '迷宫补给',
      price: shopPrice(candidate.rarity, false, args.priceByRarity, args.fallbackPrice),
    });
  }
  return items;
}

/* ---------------------------------------------------------------------------
 * 战斗 id 与通关
 * ------------------------------------------------------------------------- */

/** 塞进 `StageLaunch.chapterId` 的哨兵：`App` 靠它把迷宫与战役的结算分流。 */
export const MAZE_CHAPTER_ID = 'maze';

/**
 * 普通/精英节点的战斗 id：**每次挑战都是新局**（可反复打，与旧版手感一致），
 * 而同一局被重复提交（刷新、返回、重复点）仍会被 `settledBattleIds` 挡掉。
 */
export function mazeNodeBattleId(
  floorKey: string,
  version: number,
  nodeId: number,
  revision: number,
  launchSeq: number,
): string {
  return `maze:${floorKey}:v${version}:n${nodeId}#${revision}@${launchSeq}`;
}

/**
 * Boss 胜利的战斗 id：**稳定**，不含 revision / launchSeq。
 *
 * 于是「这一层只能通关一次」是**结构性**的——第二次提交会被
 * `applyEconomyTransaction` 判成 `alreadySettled`，一分钱不发，
 * 不靠界面禁用。它同时也是「已通关」的凭据（见 `isMazeCleared`）。
 */
export function mazeBossBattleId(floorKey: string, version: number): string {
  return `maze:${floorKey}:v${version}:boss`;
}

/** Boss 失败用另一条 id：不消耗胜利 id，玩家可以继续重试。 */
export function mazeBossLossBattleId(
  floorKey: string,
  version: number,
  revision: number,
  launchSeq: number,
): string {
  return `maze:${floorKey}:v${version}:boss@loss#${revision}@${launchSeq}`;
}

/** 「本层已通关」= 落盘值里已经有 Boss 胜利的那条结算。不新增存档字段。 */
export function isMazeCleared(
  settledBattleIds: readonly string[],
  floorKey: string,
  version: number,
): boolean {
  return settledBattleIds.includes(mazeBossBattleId(floorKey, version));
}

/** 这一层的商店状态（懒生成并固定：同一个节点的货架不会变）。 */
export function withShopState(run: MazeRunState, nodeId: number): MazeRunState {
  const key = String(nodeId);
  if (run.shopByNode[key]) {
    return run;
  }
  return {
    ...run,
    shopByNode: {
      ...run.shopByNode,
      [key]: {
        dayKey: mazeShopKey(run.floorKey, run.version, nodeId),
        seed: mazeShopSeed(run.floorKey, run.version, nodeId),
        soldOut: [],
      },
    },
  };
}
