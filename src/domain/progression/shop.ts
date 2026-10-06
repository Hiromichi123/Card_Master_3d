/**
 * 商店：每日货架、售罄、礼包、购买。
 *
 * 旧版这里缺陷最多（`shops.json` 的 `knownIssues` 有 4 条与它相关），逐条对照：
 *
 * 1. **买卡从不入库**——只扣钱、只标售罄。新版 `planPurchase` 的事务里
 *    `inventoryDelta` 是必须有的那一半。
 * 2. **礼包只扣钱不发货、还能无限重买**——新版按礼包上的稀有度真的发一张，
 *    并计入售罄（每日一次）。
 * 3. **「刷新货架」用同种子重建，点了等于没点**——新版删掉这个按钮。
 *    真让它在同一天换货架，玩家就能买第二份已售罄的商品。
 * 4. 货架种子用 `int(dayKey)`，相邻两天高度相关——新版用 `seedFrom('shop:'+dayKey)`。
 */

import { createRng, seedFrom, type Rng } from '../battle/rng';
import type { Currencies } from './types';
import { isRejection, reject, type Planned } from './plan';
import type { EconomyTransaction, ProfileState } from './types';

export interface ShelfSpec {
  readonly label: string;
  readonly rarities: readonly string[];
  /** `[最少, 最多]`。 */
  readonly countRange: readonly [number, number];
  readonly allowRepeat: boolean;
}

export interface PackSpec {
  readonly name: string;
  readonly rarity: string;
  readonly currency: keyof Currencies;
  readonly amount: number;
  readonly note: string;
}

export interface ShopSpec {
  readonly priceByRarity: Readonly<Record<string, { currency: keyof Currencies; amount: number }>>;
  readonly unknownRarityFallback: { currency: keyof Currencies; amount: number };
  readonly packs: readonly PackSpec[];
  readonly shelves: Readonly<Record<string, ShelfSpec>>;
}

export interface ShelfEntry {
  /** 售罄标识。**带 dayKey 与 index**，理由见 `entryIdOf`。 */
  readonly entryId: string;
  readonly shelfKey: string;
  readonly index: number;
  readonly kind: 'card' | 'pack';
  readonly cardId: string | null;
  readonly rarity: string;
  readonly price: { readonly currency: keyof Currencies; readonly amount: number };
  /** 展示名：卡名由界面补，礼包用它自己那个。 */
  readonly label: string;
  readonly note: string;
  readonly soldOut: boolean;
}

/**
 * 货架种子。
 *
 * 契约是「同一天给出同一份货架」，**种子取什么值不是契约的一部分**。
 * 旧版直接拿日期当种子（20260101），低熵会让相邻两天的货架明显相关；
 * 走一次带命名空间的 FNV-1a 哈希，零成本消掉这一点，且复用的是已有的
 * `seedFrom`，不再引入第二条哈希路径。
 */
export function shopSeedFor(dayKey: string): number {
  return seedFrom(`shop:${dayKey}`);
}

/**
 * 售罄条目的标识。
 *
 * - **带 `dayKey`**：万一跨日的存档写入失败，旧 id 不会把明天的同一格标成售罄；
 * - **带 `index`**：「探索」货架允许重复，同一张卡可能占两格——
 *   按 cardId 记会让一次购买同时卖掉两格。
 */
export function entryIdOf(
  dayKey: string,
  shelfKey: string,
  index: number,
  cardId: string | null,
  label: string,
): string {
  return `${dayKey}|${shelfKey}|${index}|${cardId ?? label}`;
}

function pickRarity(rng: Rng, rarities: readonly string[]): string {
  return rng.pick(rarities);
}

function priceOf(spec: ShopSpec, rarity: string): { currency: keyof Currencies; amount: number } {
  return spec.priceByRarity[rarity] ?? spec.unknownRarityFallback;
}

export interface BuildShelfArgs {
  readonly dayKey: string;
  readonly spec: ShopSpec;
  /** 稀有度 → 可上架的 cardId（已按 cardId 排序，且已排除未完成的卡）。 */
  readonly cardsByRarity: ReadonlyMap<string, readonly string[]>;
  /** 已售罄的标识。 */
  readonly soldOut: readonly string[];
}

/**
 * 生成当日货架。
 *
 * 每个货架用**独立的随机流**（`seed ^ seedFrom(shelfKey)`），
 * 所以改一个货架的规则不会把别的货架整个重排。
 *
 * 「不许重复」是靠**构造**实现的：先取候选池、洗牌、再取前 N 张——
 * 而不是「随机抽、撞了就重抽」。后者既可能死循环，也会让靠前的卡
 * 统计上更容易出现。
 */
export function buildShelf(args: BuildShelfArgs): readonly ShelfEntry[] {
  const soldOut = new Set(args.soldOut);
  const entries: ShelfEntry[] = [];

  for (const [shelfKey, shelf] of Object.entries(args.spec.shelves)) {
    const rng = createRng((shopSeedFor(args.dayKey) ^ seedFrom(shelfKey)) >>> 0);
    const [min, max] = shelf.countRange;
    const count = rng.int(min, max);

    if (shelf.allowRepeat) {
      // 逐格独立抽：稀有度先均匀选一个，再在该稀有度内均匀选一张
      for (let index = 0; index < count; index += 1) {
        const rarity = pickRarity(rng, shelf.rarities);
        const candidates = args.cardsByRarity.get(rarity) ?? [];
        if (candidates.length === 0) {
          continue;
        }
        const cardId = rng.pick(candidates);
        entries.push(makeCardEntry(args, shelfKey, shelf, index, cardId, rarity, soldOut));
      }
    } else {
      const pool: { cardId: string; rarity: string }[] = [];
      for (const rarity of shelf.rarities) {
        for (const cardId of args.cardsByRarity.get(rarity) ?? []) {
          pool.push({ cardId, rarity });
        }
      }
      const shuffled = rng.shuffle(pool);
      const take = Math.min(count, shuffled.length);
      for (let index = 0; index < take; index += 1) {
        const picked = shuffled[index]!;
        entries.push(
          makeCardEntry(args, shelfKey, shelf, index, picked.cardId, picked.rarity, soldOut),
        );
      }
    }
  }

  // 礼包：旧版只扣钱不发货，新版发一张**它承诺的那个稀有度**的卡。
  // 用 `index` 让礼包彼此区分，`dayKey` 让它们随货架一起每日重置。
  args.spec.packs.forEach((pack, index) => {
    const entryId = entryIdOf(args.dayKey, 'pack', index, null, pack.name);
    entries.push({
      entryId,
      shelfKey: 'pack',
      index,
      kind: 'pack',
      cardId: null,
      rarity: pack.rarity,
      price: { currency: pack.currency, amount: pack.amount },
      label: pack.name,
      note: pack.note,
      soldOut: soldOut.has(entryId),
    });
  });

  return entries;
}

function makeCardEntry(
  args: BuildShelfArgs,
  shelfKey: string,
  shelf: ShelfSpec,
  index: number,
  cardId: string,
  rarity: string,
  soldOut: ReadonlySet<string>,
): ShelfEntry {
  const entryId = entryIdOf(args.dayKey, shelfKey, index, cardId, '');
  return {
    entryId,
    shelfKey,
    index,
    kind: 'card',
    cardId,
    rarity,
    price: priceOf(args.spec, rarity),
    label: shelf.label,
    note: '',
    soldOut: soldOut.has(entryId),
  };
}

/* ---------------------------------------------------------------------------
 * 购买
 * ------------------------------------------------------------------------- */

export interface PurchaseView {
  readonly entryId: string;
  /** 买到的卡；礼包在计划阶段就已经按稀有度抽好了。 */
  readonly cardId: string;
  readonly label: string;
  readonly price: { readonly currency: keyof Currencies; readonly amount: number };
}

export interface PurchaseArgs {
  readonly profile: ProfileState;
  readonly entry: ShelfEntry;
  readonly operationId: string;
  /** 礼包要在这里定下发出一张哪张卡。 */
  readonly cardsByRarity: ReadonlyMap<string, readonly string[]>;
  readonly rng: Rng;
}

/**
 * 算一次购买。
 *
 * **`inventoryDelta` 是修 `knownIssues[0]` 的那一半**：旧版只扣钱只标售罄，
 * 卡从来没进过库存。这里购买与发货是同一个事务的两面。
 */
export function planPurchase(args: PurchaseArgs): Planned<PurchaseView> {
  const { entry, profile } = args;

  if (entry.soldOut) {
    return reject('该商品今日已售罄');
  }

  let cardId = entry.cardId;
  if (entry.kind === 'pack') {
    // 礼包按它自己承诺的稀有度发货，等价于用那张 100% 单稀有度的权重表抽一张
    const candidates = args.cardsByRarity.get(entry.rarity) ?? [];
    if (candidates.length === 0) {
      return reject(`没有可发放的${entry.rarity}卡牌`);
    }
    cardId = args.rng.pick(candidates);
  }
  if (!cardId) {
    return reject('这件商品没有对应的卡牌');
  }

  const have = profile.currencies[entry.price.currency];
  if (have < entry.price.amount) {
    return reject('余额不足');
  }

  const currencyDelta: Partial<Currencies> = { [entry.price.currency]: -entry.price.amount };
  const transaction: EconomyTransaction = {
    operationId: args.operationId,
    currencyDelta,
    inventoryDelta: { [cardId]: 1 },
    soldOutAdditions: [entry.entryId],
  };

  return {
    transaction,
    view: {
      entryId: entry.entryId,
      cardId,
      label: entry.label,
      price: entry.price,
    },
  };
}

export { isRejection };
