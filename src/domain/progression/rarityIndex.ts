/**
 * 稀有度的排序与配色。
 *
 * 这些信息在三个地方各有一份，容易对不上：
 * - `STANDARD_RARITIES` / `EVENT_RARITIES`（`domain/cards/types.ts`）——**顺序的权威**；
 * - `rarities.json`——**配色的权威**（事件档 `#elna` / `#yoroi` 的配色只在这里）；
 * - 各处硬编码的数组——旧版三处顺序还不一样，其中一处在组卡里把 `+` 版本合并掉了。
 *
 * 所以这里只做一件事：把「顺序」和「配色」拼成一张查询表，
 * **未知稀有度一律给哨兵值**，绝不返回 `undefined`。
 * 旧版按硬编码顺序查 `#yoroi` 得到 `undefined`，排序里就冒出 `NaN`——
 * 那种排序不会报错，只是顺序莫名其妙。（`#yoroi` 自 2026-10-09 起已登记在
 * `EVENT_RARITIES` 里，哨兵值这条规则仍然管着以后的未知档位。）
 */

import { EVENT_RARITIES, STANDARD_RARITIES } from '../cards/types';

/** `rarities.json` 的一条。结构类型，避免领域层 import 数据层。 */
export interface RarityEntryLike {
  readonly rarity: string;
  readonly level: number;
  readonly color: string;
  readonly isEvent: boolean;
  readonly isHighRarity: boolean;
}

export interface RarityIndex {
  /** 由稀有到普通。事件稀有度排在最后。 */
  readonly order: readonly string[];
  /** 序号越小越稀有；**未知返回 `UNKNOWN_RANK`**。 */
  readonly rankOf: (rarity: string) => number;
  /** 十六进制配色；未知返回中性灰。 */
  readonly colorOf: (rarity: string) => string;
  readonly isEvent: (rarity: string) => boolean;
  readonly isHighRarity: (rarity: string) => boolean;
  /** 是否是本轮认识的有效稀有度（只有 `order` 里的档位为 true）。 */
  readonly isKnown: (rarity: string) => boolean;
}

/** 未知稀有度的排序位。比任何真实稀有度都靠后。 */
export const UNKNOWN_RANK = 99;

const FALLBACK_COLOR = '#8a93a6';

export function buildRarityIndex(entries: readonly RarityEntryLike[]): RarityIndex {
  const byRarity = new Map(entries.map((entry) => [entry.rarity, entry]));
  // 顺序取编译期就存在的两份常量，配色取数据——两边各有各的权威，不重复定义
  const order = [...STANDARD_RARITIES, ...EVENT_RARITIES];
  const rank = new Map<string, number>(order.map((rarity, index) => [rarity, index]));
  const known = new Set<string>(order);

  return {
    order,
    rankOf: (rarity) => rank.get(rarity) ?? UNKNOWN_RANK,
    colorOf: (rarity) => byRarity.get(rarity)?.color ?? FALLBACK_COLOR,
    isEvent: (rarity) => byRarity.get(rarity)?.isEvent ?? EVENT_RARITIES.includes(rarity as never),
    isHighRarity: (rarity) => byRarity.get(rarity)?.isHighRarity ?? false,
    isKnown: (rarity) => known.has(rarity),
  };
}
