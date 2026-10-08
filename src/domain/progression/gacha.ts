/**
 * 抽卡。
 *
 * 与旧版最重要的差别是**一条浮点累计权重采样路径**（PLAN 第 6 节）。
 * 旧版是 `randint(1, 100)` 对浮点累计权重，有两个后果：
 *
 * 1. **量化误差**：权重被压进 1% 的格子里。`SSS` 配的是 0.1%，实际拿到 1%；
 *    `S`(1.0) 与 `A+`(1.7) 也被挤到差不多的概率上。
 * 2. **权重和不足 100 时掉进兜底**：`holiday` 的表加起来 64.5、`special` 是 94.0，
 *    差额部分会走「随机挑一个非空稀有度」——对 `special` 来说，
 *    这意味着「高级卡池」里能掉出 D 卡，而 `SS+` 被抬成配置的 2.5 倍。
 *    这是**配置之外的结果**，不是设计。
 *
 * 现在按表内总和归一化：配置里的相对权重就是全部真相，缺的稀有度是真的抽不到。
 */

import type { CardRarity } from '../cards/types';
import type { Currencies } from './types';
import type { Rng } from '../battle/rng';
import { isRejection, reject, type Planned } from './plan';
import type { EconomyTransaction, GachaResult, ProfileState } from './types';

export interface RaritySlot {
  readonly rarity: CardRarity;
  readonly weight: number;
}

/**
 * 把一张权重表摊成采样用的槽位。
 *
 * **丢掉零权重与缺省的稀有度**，而不是给它们补一个兜底值——
 * 「这张表里没有 B+」和「B+ 的概率是 0」在这里是一回事，
 * 但补兜底会让前者变成后者之外的东西。
 */
export function raritySlots(
  table: Readonly<Partial<Record<CardRarity, number>>>,
  order: readonly string[],
): readonly RaritySlot[] {
  const slots: RaritySlot[] = [];
  for (const rarity of order) {
    const weight = table[rarity as CardRarity] ?? 0;
    if (weight > 0) {
      slots.push({ rarity: rarity as CardRarity, weight });
    }
  }
  return slots;
}

export function totalWeight(slots: readonly RaritySlot[]): number {
  return slots.reduce((sum, slot) => sum + slot.weight, 0);
}

/**
 * 按权重抽一个稀有度。
 *
 * `roll` 是 `[0, total)` 上的连续浮点，不是 1..100 的整数。
 */
export function sampleRarity(rng: Rng, slots: readonly RaritySlot[]): CardRarity {
  const total = totalWeight(slots);
  if (total <= 0 || slots.length === 0) {
    throw new Error('概率表的总权重为 0，无法抽取');
  }
  const roll = rng.next() * total;
  let accumulated = 0;
  for (const slot of slots) {
    accumulated += slot.weight;
    if (roll < accumulated) {
      return slot.rarity;
    }
  }
  // 浮点累加的末尾缝隙（roll 极其接近 total）落在这里
  return slots[slots.length - 1]!.rarity;
}

/** 稀有度 → 可抽的 cardId 列表。 */
export type CardPoolIndex = ReadonlyMap<CardRarity, readonly string[]>;

/**
 * 从卡牌定义建卡池。
 *
 * 只收 `status === 'complete'`：不完整的卡攻防冷却都是 0，抽到手里是一张不能用的卡。
 * **按 cardId 排序**，
 * 这样同一个种子抽到什么是确定的，与 JSON 里的数组顺序无关。
 */
export function buildCardPool(
  definitions: readonly { readonly cardId: string; readonly rarity: CardRarity; readonly status: string }[],
): CardPoolIndex {
  const buckets = new Map<CardRarity, string[]>();
  for (const card of definitions) {
    if (card.status !== 'complete') {
      continue;
    }
    const bucket = buckets.get(card.rarity);
    if (bucket) {
      bucket.push(card.cardId);
    } else {
      buckets.set(card.rarity, [card.cardId]);
    }
  }
  for (const bucket of buckets.values()) {
    bucket.sort();
  }
  return buckets;
}

export interface DrawnCard {
  readonly rarity: CardRarity;
  readonly cardId: string;
}

/** 抽一张：先定稀有度，再在该稀有度里**均匀**挑一张。 */
export function pullOne(rng: Rng, slots: readonly RaritySlot[], pool: CardPoolIndex): DrawnCard {
  const rarity = sampleRarity(rng, slots);
  const candidates = pool.get(rarity);
  if (!candidates || candidates.length === 0) {
    throw new Error(`稀有度 ${rarity} 没有可抽取的卡牌`);
  }
  return { rarity, cardId: rng.pick(candidates) };
}

/* ---------------------------------------------------------------------------
 * 概率文案：由配置算出，不手写
 * ------------------------------------------------------------------------- */

export interface ProbRow {
  readonly rarity: CardRarity;
  readonly weight: number;
  /** 归一化之后的百分比。 */
  readonly percent: number;
}

/** 每一档的概率。总数由权重表自己的总和决定，不看「100」这个魔术数。 */
export function probabilityRows(slots: readonly RaritySlot[]): readonly ProbRow[] {
  const total = totalWeight(slots);
  if (total <= 0) {
    return [];
  }
  return slots
    .map((slot) => ({
      rarity: slot.rarity,
      weight: slot.weight,
      percent: (slot.weight / total) * 100,
    }))
    .sort((a, b) => b.weight - a.weight);
}

/** 高稀有度合计百分比。界面上的「稀有爆率」就取它，不用配置里那串手写文案。 */
export function rarePercent(
  slots: readonly RaritySlot[],
  isHighRarity: (rarity: CardRarity) => boolean,
): number {
  const total = totalWeight(slots);
  if (total <= 0) {
    return 0;
  }
  const rare = slots
    .filter((slot) => isHighRarity(slot.rarity))
    .reduce((sum, slot) => sum + slot.weight, 0);
  return (rare / total) * 100;
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/* ---------------------------------------------------------------------------
 * 一次抽卡计划
 * ------------------------------------------------------------------------- */

export interface PullArgs {
  readonly profile: ProfileState;
  readonly poolId: string;
  readonly currency: keyof Currencies;
  readonly cost: number;
  readonly slots: readonly RaritySlot[];
  readonly pool: CardPoolIndex;
  readonly count: number;
  readonly rng: Rng;
  readonly operationId: string;
}

/**
 * 算这一次抽卡：**现在就把稀有度和卡定下来**，打包成一次事务。
 *
 * 十连是 10 次独立采样（旧版如此，新版不加保底），共用同一个 `Rng`——
 * 所以整次十连可以从一个种子状态复现。
 *
 * `inventoryDelta` 用 `+=` 累加：同一张抽到两次必须记 `+2`，
 * 直接赋值会把重复的那张悄悄丢掉。
 */
export function planPull(args: PullArgs): Planned<GachaResult> {
  if (args.count !== 1 && args.count !== 10) {
    return reject('只支持单抽与十连');
  }
  const cost = args.cost;
  if ((args.profile.currencies[args.currency] ?? 0) < cost) {
    return reject('余额不足');
  }

  const cardIds: string[] = [];
  const rarities: CardRarity[] = [];
  const inventoryDelta: Record<string, number> = {};

  for (let i = 0; i < args.count; i += 1) {
    const drawn = pullOne(args.rng, args.slots, args.pool);
    cardIds.push(drawn.cardId);
    rarities.push(drawn.rarity);
    inventoryDelta[drawn.cardId] = (inventoryDelta[drawn.cardId] ?? 0) + 1;
  }

  const result: GachaResult = {
    operationId: args.operationId,
    poolId: args.poolId,
    cardIds,
    rarities,
    rngState: args.rng.snapshot().state,
  };

  const currencyDelta: Partial<Currencies> = { [args.currency]: -cost };
  const transaction: EconomyTransaction = {
    operationId: args.operationId,
    currencyDelta,
    inventoryDelta,
  };

  return { transaction, view: result };
}

export { isRejection };
