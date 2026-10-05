/**
 * 导入数据的类型化入口。
 *
 * `src/data/*.json` 全部由 `scripts/import-legacy-data.py` 生成并可 `--check` 复现。
 * 这里不做业务逻辑，只做两件事：
 * 1. 把 JSON 收窄成领域类型；
 * 2. 用一次轻量结构校验尽早发现「生成物与类型定义不一致」——
 *    否则一个字段改名会以 `undefined` 的形式渗透到渲染层，很难定位。
 */

import type { CardDefinition } from '../domain/cards/types';

import cardsJson from './cards.json';
import decksJson from './decks.json';
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
  definitions: rawDefinitions as CardDefinition[],
};

/** cardId → 定义。战斗与界面都通过它取卡，不使用数组下标。 */
export const cardById: ReadonlyMap<string, CardDefinition> = new Map(
  cardDatabase.definitions.map((card) => [card.cardId, card]),
);

export const rarities = assertArray(
  (raritiesJson as { rarities?: unknown }).rarities,
  'rarities.json 的 rarities',
);

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

export const decks = decksJson as {
  enemy: Record<string, { cardIds: readonly string[]; size: number }>;
  demo: { cardIds: readonly string[]; size: number } | null;
};

export const stages = stagesJson as {
  chapters: readonly {
    id: string;
    name: string;
    stages: readonly { id: string; name: string }[];
  }[];
  emptyChapters: readonly string[];
};

export const shops = shopsJson as {
  available: boolean;
  knownIssues: readonly { area: string; issue: string }[];
};
