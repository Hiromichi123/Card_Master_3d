/**
 * 存档的创建与浅更新。
 *
 * 初始存档必须**能直接玩**：旧版新号是空的（没钱、没卡、没卡组），
 * 得先抽卡才能组卡、才能打战役——而抽卡要先有货币。
 * 新版给一手起始卡组与一点起始货币，打开就能进第一关。
 */

import { DECK_LIMIT, DEFAULT_SETTINGS, SAVE_SCHEMA_VERSION } from './types';
import type { Currencies, Deck, ProfileState, SettingsState } from './types';

/**
 * 起始货币。
 *
 * 5000 金币刚好够一次十连（4500）还剩一点，300 水晶够日常池抽一次。
 * 数值是可以调的，但**不要调到零**——那会让开局又是一条走不通的路。
 */
export const STARTING_CURRENCIES: Currencies = { gold: 5000, crystal: 300, badge: 0 };

/** 起始卡组用的牌组 id（切片里的演示玩家牌组，12 张）。 */
export const STARTING_DECK_ID = 'starter';
export const STARTING_DECK_NAME = '起始卡组';

export interface CreateProfileArgs {
  readonly contentVersion: string;
  readonly dayKey: string;
  /** 起始卡组的 cardId 列表。超过 12 张会被截断。 */
  readonly starterCardIds: readonly string[];
  /**
   * 开号时一并放进库存的卡。
   *
   * 缺省就是起始卡组那 12 张。**传入全部卡就是「什么都拥有」的演示存档**——
   * 现在按需求这么做，好在图鉴里浏览全部卡面；
   * 真正的正式存档应该让玩家从零开始收集。
   */
  readonly ownedCardIds?: readonly string[] | undefined;
  /** 建号时刻，写进卡组的 `updatedAt`。 */
  readonly now: Date;
}

export function createInitialProfile(args: CreateProfileArgs): ProfileState {
  const cardIds = args.starterCardIds.slice(0, DECK_LIMIT);
  const owned = args.ownedCardIds ?? cardIds;

  // 每张按次数记，重复的卡（如果起始牌组里有）得到正好的数量
  const inventory: Record<string, number> = {};
  for (const cardId of owned) {
    inventory[cardId] = (inventory[cardId] ?? 0) + 1;
  }

  const deck: Deck = {
    id: STARTING_DECK_ID,
    name: STARTING_DECK_NAME,
    cardIds,
    updatedAt: args.now.toISOString(),
  };

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    contentVersion: args.contentVersion,
    revision: 0,
    currencies: { ...STARTING_CURRENCIES },
    level: { level: 1, xp: 0, baseXp: 100, xpMultiplier: 1.2 },
    inventory,
    decks: [deck],
    activeDeckId: deck.id,
    gacha: { pullsByPool: {} },
    shop: { dayKey: args.dayKey, seed: 0, soldOut: [] },
    campaign: { clearedStages: [], currentChapterId: null },
    mazeRun: null,
    settings: { ...DEFAULT_SETTINGS },
    settledBattleIds: [],
  };
}

export function withSettings(profile: ProfileState, patch: Partial<SettingsState>): ProfileState {
  return {
    ...profile,
    revision: profile.revision + 1,
    settings: { ...profile.settings, ...patch },
  };
}

/** 新增或整体替换一个卡组（按 id 匹配）。 */
export function withDeck(profile: ProfileState, deck: Deck): ProfileState {
  const exists = profile.decks.some((entry) => entry.id === deck.id);
  return {
    ...profile,
    revision: profile.revision + 1,
    decks: exists
      ? profile.decks.map((entry) => (entry.id === deck.id ? deck : entry))
      : [...profile.decks, deck],
  };
}

/** 删掉一个卡组。**当前出战卡组被删掉时把 `activeDeckId` 一并置空**，
 *  否则会留下一个指向不存在卡组的悬空引用。 */
export function withoutDeck(profile: ProfileState, deckId: string): ProfileState {
  return {
    ...profile,
    revision: profile.revision + 1,
    decks: profile.decks.filter((entry) => entry.id !== deckId),
    activeDeckId: profile.activeDeckId === deckId ? null : profile.activeDeckId,
  };
}

export function withActiveDeck(profile: ProfileState, deckId: string | null): ProfileState {
  return { ...profile, revision: profile.revision + 1, activeDeckId: deckId };
}

/** 当前出战卡组；没有或指向已删除的卡组时返回 `null`。 */
export function activeDeckOf(profile: ProfileState): Deck | null {
  if (!profile.activeDeckId) {
    return null;
  }
  return profile.decks.find((deck) => deck.id === profile.activeDeckId) ?? null;
}
