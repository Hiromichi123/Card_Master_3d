/**
 * 导入数据的类型化入口。
 *
 * `src/data/*.json` 全部由 `scripts/import-legacy-data.py` 生成并可 `--check` 复现。
 * 这里不做业务逻辑，只做两件事：
 * 1. 把 JSON 收窄成领域类型；
 * 2. 用一次轻量结构校验尽早发现「生成物与类型定义不一致」——
 *    否则一个字段改名会以 `undefined` 的形式渗透到渲染层，很难定位。
 */

import type { CardDefinition, CardRarity } from '../domain/cards/types';
import type { Currencies } from '../domain/progression/types';
import type { FusionSpec } from '../domain/progression/fusion';

import cardsJson from './cards.json';
import { withModernTraits } from '../domain/skills/modernTraits';
import decksJson from './decks.json';
import gachaPoolsJson from './gacha-pools.json';
import incompleteJson from './incomplete-cards.json';
import raritiesJson from './rarities.json';
import shopsJson from './shops.json';
import sliceJson from './slice.json';
import stagesJson from './stages.json';

function fail(message: string): never {
  throw new Error(`数据文件不符合预期：${message}。请重新运行 scripts/import-legacy-data.py`);
}

function assertArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${label} 不是数组`);
  }
  return value;
}

const rawDefinitions = assertArray(
  (cardsJson as { definitions?: unknown }).definitions,
  'cards.json 的 definitions',
);

/** 只校验渲染一定会用到的字段，不做全量 schema 校验。 */
for (const [index, entry] of rawDefinitions.entries()) {
  const card = entry as Partial<CardDefinition>;
  if (typeof card.cardId !== 'string' || typeof card.name !== 'string') {
    fail(`cards.json 第 ${index} 项缺少 cardId 或 name`);
  }
  if (!Array.isArray(card.rawTraits) || !Array.isArray(card.skills)) {
    fail(`${card.cardId} 缺少 rawTraits 或 skills`);
  }
  if (card.rawTraits.length !== card.skills.length) {
    fail(`${card.cardId} 的 rawTraits 与 skills 长度不一致`);
  }
}

export interface CardDatabase {
  readonly contentVersion: string;
  readonly definitions: readonly CardDefinition[];
}

export const cardDatabase: CardDatabase = {
  contentVersion: (cardsJson as { contentVersion?: string }).contentVersion ?? '未知',
  definitions: (rawDefinitions as CardDefinition[]).map(withModernTraits),
};

/** cardId → 定义。战斗与界面都通过它取卡，不使用数组下标。 */
export const cardById: ReadonlyMap<string, CardDefinition> = new Map(
  cardDatabase.definitions.map((card) => [card.cardId, card]),
);

/**
 * 稀有度表，**带类型**。
 *
 * 它是**配色的权威**：`rarityIndex` 的顺序取自代码里的常量，配色一律走这张表。
 * 不要另硬编码一份顺序——旧版就是那么干的，`#yoroi` 会查到 `undefined`、
 * 排序里冒出 `NaN`（P5 开工前实测过）。
 */
export interface RarityEntry {
  readonly rarity: string;
  readonly slug: string;
  /** 越小越稀有。SSS 与 #elna 同为 0，D 为 6。 */
  readonly level: number;
  readonly color: string;
  readonly entryCount: number;
  readonly loadedByLegacy: boolean;
  readonly isEvent: boolean;
  readonly isHighRarity: boolean;
}

export const rarityList = assertArray(
  (raritiesJson as { rarities?: unknown }).rarities,
  'rarities.json 的 rarities',
) as readonly RarityEntry[];

/** 兼容旧调用点；新代码用 `rarityList`。 */
export const rarities = rarityList;

export const incompleteCards = incompleteJson as readonly {
  cardId: string;
  name: string;
  missingFields: string[];
}[];

export interface SliceDeck {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly cardIds: readonly string[];
  readonly size: number;
}

export interface SliceScenario {
  readonly id: string;
  readonly goal: string;
  readonly covers: readonly string[];
  readonly coversNames: readonly string[];
}

export const slice = sliceJson as {
  seedBase: number;
  cards: readonly { cardId: string; why: string; rarity: string; rawTraits: readonly string[] }[];
  decks: readonly SliceDeck[];
  scenarios: readonly SliceScenario[];
  familiesCovered: readonly string[];
  familiesMissing: readonly string[];
  count: number;
};

export interface EnemyDeck {
  readonly cardIds: readonly string[];
  /** 导入时无法映射的旧路径，保留下来供排查。 */
  readonly unknown: readonly string[];
  readonly size: number;
  readonly distinct: number;
  /**
   * 导入期记下的问题。**必须保留**：2-3 与 2-4 的牌组是 13 张，
   * 超过引擎的 12 张上限，`createBattle` 会直接抛错——启动关卡时要按这个裁剪。
   */
  readonly notes: readonly string[];
}

export const decks = decksJson as {
  enemy: Record<string, EnemyDeck>;
  demo: { cardIds: readonly string[]; size: number } | null;
};

/** 关卡的奖励配置。`items` 是**魔法旗标**，战斗结算时按字符串识别。 */
export interface StageRewardSpec {
  readonly gold?: number;
  readonly xp?: number;
  readonly crystals?: number;
  readonly badges?: number;
  readonly items?: readonly string[];
}

export interface StageConfig {
  readonly id: string;
  readonly name: string;
  readonly posterId: string | null;
  readonly summary: string | null;
  readonly reward: StageRewardSpec | null;
}

export interface ChapterConfig {
  readonly id: string;
  readonly name: string;
  readonly posterId: string | null;
  readonly bgType: string | null;
  readonly stages: readonly StageConfig[];
}

export const stages = stagesJson as {
  chapters: readonly ChapterConfig[];
  /** 只有第 4 章。它没有关卡，海报也不在 manifest 里——界面要能渲染「待续」。 */
  readonly emptyChapters: readonly string[];
};

export interface ShopPrice {
  readonly currency: keyof Currencies;
  readonly amount: number;
}

export interface ShopPack {
  readonly name: string;
  readonly rarity: string;
  readonly currency: keyof Currencies;
  readonly amount: number;
  /** 旧版的承诺文案（「必出SSS」）。旧版只扣钱不发货，新版的礼包要真的按它发货。 */
  readonly note: string;
}

export interface ShopShelf {
  readonly label: string;
  readonly rarities: readonly string[];
  readonly count_range: readonly [number, number];
  readonly allow_repeat: boolean;
}

/**
 * 把 `shops.json` 的 snake_case 摊成领域层要的形状。
 *
 * 放在数据层而不是场景里：**测试与界面要读同一份**。
 * 之前只有 `progression.test.ts` 里有一份私有映射，界面再抄一份就是两处真相。
 *
 * **顺手补一处导入缺陷**：活动商店的 `priceByRarity` 是**裸数字**
 * （`{"#elna": 1080}`），而常规商店是 `{currency, amount}`。
 * 直接用的话 `entry.price.amount` 是 `undefined`——界面会显示「undefined」、
 * 购买校验会拿 `undefined` 去比大小（永远为假），而且**不会报错**。
 *
 * 这里按该商店自己的 `unknownRarityFallback.currency` 补上货币：
 * 活动商店的兜底价写的是 `badge`，与「徽章是活动商店用的」这条约定一致
 * （见 `ui/CurrencyBar.tsx` 的注释）。缺兜底时退回金币。
 */
function toShopSpec(raw: {
  priceByRarity: Record<string, ShopPrice | number>;
  unknownRarityFallback: ShopPrice;
  packs?: readonly ShopPack[];
  shelves: Record<string, ShopShelf>;
} | null) {
  if (!raw) {
    return null;
  }
  const impliedCurrency: keyof Currencies = raw.unknownRarityFallback?.currency ?? 'gold';
  const normalize = (price: ShopPrice | number): ShopPrice =>
    typeof price === 'number' ? { currency: impliedCurrency, amount: price } : price;
  return {
    priceByRarity: Object.fromEntries(
      Object.entries(raw.priceByRarity).map(([rarity, price]) => [rarity, normalize(price)]),
    ),
    unknownRarityFallback: raw.unknownRarityFallback,
    packs: raw.packs ?? [],
    shelves: Object.fromEntries(
      Object.entries(raw.shelves).map(([key, value]) => [
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

export const shopSpecs = {
  normal: toShopSpec(shopsJson.normalShop as never),
  activity: toShopSpec(shopsJson.activityShop as never),
};

export const fusionSpec = shopsJson.fusion as FusionSpec;

export const shops = shopsJson as unknown as {
  available: boolean;
  normalShop: {
    priceByRarity: Record<string, ShopPrice>;
    unknownRarityFallback: ShopPrice;
    packs: readonly ShopPack[];
    shelves: Record<string, ShopShelf>;
    refresh: { dayKeyFormat: string; seedDerivation: string; seedReproducible: boolean };
  } | null;
  activityShop: {
    priceByRarity: Record<string, ShopPrice>;
    unknownRarityFallback: ShopPrice;
    shelves: Record<string, ShopShelf>;
    refresh: { dayKeyFormat: string; seedDerivation: string; seedReproducible: boolean };
  } | null;
  fusion: FusionSpec | null;
  /**
   * 旧版的真实缺陷清单。**这一轮是「修不要抄」**：
   * 每条都写了新版本该怎么处理，实现时逐条对照。
   */
  readonly knownIssues: readonly {
    area: string;
    issue: string;
    evidence?: string;
    newVersionDecision?: string;
  }[];
};

/** 抽卡卡池配置。`probTable` 是**表名**，要用它去 `tables` 里取权重。 */
export interface GachaPool {
  readonly id: string;
  readonly name: string;
  readonly bgType: string;
  readonly description: string;
  readonly probTable: string;
  /**
   * 旧版手写的概率文案。**界面不得渲染它**——`normal` 那条写的是 8.9%，
   * 而权重表算出来是 6.3%。留着只作审计对照。
   */
  readonly probLabel: string;
  readonly currency: keyof Currencies;
  readonly singleCost: number;
  readonly tenCost: number;
  readonly showcaseCards: readonly string[];
  readonly declaredRarePercent: number | null;
  readonly computedRarePercent: number;
}

export type WeightTable = Readonly<Partial<Record<CardRarity, number>>>;

export const gachaPools = gachaPoolsJson as unknown as {
  pools: readonly GachaPool[];
  tables: Readonly<Record<string, WeightTable>>;
  /**
   * 每个权重表的自检结果。旧版的表有两条不足 100（holiday 64.5、special 94.0），
   * 这里如实记着——新版按表内总和归一化，`missingRarities` 就成了「这些稀有度抽不到」
   * 的明确声明，而不是掉进随机兜底。
   */
  tableDiagnostics: readonly {
    table: string;
    total: number;
    rareTotal: number;
    missingRarities: readonly string[];
  }[];
  sourceHash: string;
};

/*
  一次轻量校验，只为拦住「Python 侧改了名、前端静默拿到空表」这一类错误：
  每个卡池引用的权重表必须存在，且表里不能一个稀有度都没有。
*/
for (const pool of gachaPools.pools) {
  const table = gachaPools.tables[pool.probTable];
  if (!table) {
    fail(`卡池 ${pool.id} 引用了不存在的权重表 ${pool.probTable}`);
  }
  if (Object.keys(table).length === 0) {
    fail(`卡池 ${pool.id} 引用的权重表 ${pool.probTable} 是空的`);
  }
}
