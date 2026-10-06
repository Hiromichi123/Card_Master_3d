/**
 * 图鉴的派生数据。
 *
 * 全部从 `profile.inventory` 现算，**不另存一份统计**——
 * 旧版把 `total_draws` / `rarity_stats` 存进存档，而每次 `add_card`/`remove_card`
 * 都要同步它们；融合 5 张换 1 张会让「总抽卡数」倒退 4，数字迟早对不上。
 * 派生出来的东西没有这个问题。
 */

export interface CollectionEntry {
  readonly cardId: string;
  readonly count: number;
}

export interface CollectionStats {
  /** 不同的卡有多少种。 */
  readonly unique: number;
  /** 一共多少张（含重复）。 */
  readonly total: number;
  /** 每种稀有度各多少种。 */
  readonly byRarity: Readonly<Record<string, number>>;
}

export type RarityOf = (cardId: string) => string | null;

/** 库存里所有拥有量 > 0 的卡。顺序沿用 `inventory` 的键序，排序交给调用方。 */
export function ownedEntries(
  inventory: Readonly<Record<string, number>>,
): readonly CollectionEntry[] {
  return Object.entries(inventory)
    .filter(([, count]) => count > 0)
    .map(([cardId, count]) => ({ cardId, count }));
}

/**
 * 按稀有度排序。
 *
 * 稀有度**未知的排到最后**（`rankOf` 给哨兵值），不会抛也不会变成 `NaN`。
 * 同一稀有度内按 cardId 排，保证顺序稳定——否则每次重渲染都会跳。
 */
export function sortForCollection(
  entries: readonly CollectionEntry[],
  rarityOf: RarityOf,
  rankOf: (rarity: string) => number,
): readonly CollectionEntry[] {
  return [...entries].sort((a, b) => {
    const rankA = rankOf(rarityOf(a.cardId) ?? '');
    const rankB = rankOf(rarityOf(b.cardId) ?? '');
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return a.cardId.localeCompare(b.cardId);
  });
}

export function filterByRarity(
  entries: readonly CollectionEntry[],
  rarityOf: RarityOf,
  rarity: string | null,
): readonly CollectionEntry[] {
  if (rarity === null) {
    return entries;
  }
  return entries.filter((entry) => rarityOf(entry.cardId) === rarity);
}

/** 只统计**已拥有**的卡；图鉴的空缺部分不算在里面。 */
export function collectionStats(
  inventory: Readonly<Record<string, number>>,
  rarityOf: RarityOf,
): CollectionStats {
  const byRarity: Record<string, number> = {};
  let total = 0;
  let unique = 0;

  for (const [cardId, count] of Object.entries(inventory)) {
    if (count <= 0) {
      continue;
    }
    unique += 1;
    total += count;
    const rarity = rarityOf(cardId) ?? '未知';
    byRarity[rarity] = (byRarity[rarity] ?? 0) + 1;
  }

  return { unique, total, byRarity };
}
