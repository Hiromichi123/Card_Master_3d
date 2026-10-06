/**
 * 卡组规则。
 *
 * 三条约束照搬旧版 `utils/deck_manager.py` 与组卡界面的行为：
 * 1. 上限 12 张（`DECK_LIMIT`）；
 * 2. **可用张数 = 拥有张数 − 已放进卡组的张数**——旧版组卡界面实时算这个，
 *    用尽的卡显示「已上阵」且点不动；
 * 3. 重复卡允许，除了拥有量之外**没有**每张卡的上限。
 */

import { DECK_LIMIT } from './types';
import type { Deck } from './types';

export { DECK_LIMIT };

export function createDeck(id: string, name: string, cardIds: readonly string[], now: Date): Deck {
  return {
    id,
    name,
    cardIds: cardIds.slice(0, DECK_LIMIT),
    updatedAt: now.toISOString(),
  };
}

/** 新建一个空卡组，id 由调用方给（通常是时间戳或递增序号）。 */
export function emptyDeck(id: string, name: string, now: Date): Deck {
  return createDeck(id, name, [], now);
}

export function countIn(deck: Deck, cardId: string): number {
  return deck.cardIds.filter((id) => id === cardId).length;
}

/** 这张卡还能往卡组里放几张。 */
export function availableCopies(
  inventory: Readonly<Record<string, number>>,
  deck: Deck,
  cardId: string,
): number {
  return Math.max(0, (inventory[cardId] ?? 0) - countIn(deck, cardId));
}

export type AddRejection = 'full' | 'noneLeft' | 'unknownCard';

export type AddCheck = { readonly ok: true } | { readonly ok: false; readonly reason: AddRejection };

/** 能不能往卡组里再加一张。**UI 与领域共用这一个判据**，不各写一份。 */
export function canAddCard(
  deck: Deck,
  inventory: Readonly<Record<string, number>>,
  cardId: string,
  known: (id: string) => boolean = () => true,
): AddCheck {
  if (!known(cardId)) {
    return { ok: false, reason: 'unknownCard' };
  }
  if (deck.cardIds.length >= DECK_LIMIT) {
    return { ok: false, reason: 'full' };
  }
  if (availableCopies(inventory, deck, cardId) <= 0) {
    return { ok: false, reason: 'noneLeft' };
  }
  return { ok: true };
}

export const ADD_REJECTION_TEXT: Record<AddRejection, string> = {
  full: `卡组已满（${DECK_LIMIT} 张）`,
  noneLeft: '这张卡已经全部上阵了',
  unknownCard: '不认识这张卡',
};

/**
 * 同一组拒绝原因的**短文案**，用在卡片角标上。
 *
 * 角标位置只放得下几个字，长文案会盖住卡面；而长文案留给横幅与 toast。
 * 键必须与 `ADD_REJECTION_TEXT` 完全一致——加一种拒绝原因时两处一起补，
 * `deckView.test.ts` 有一条断言盯着这个覆盖关系。
 */
export const ADD_REJECTION_NOTE: Record<AddRejection, string> = {
  full: '卡组已满',
  noneLeft: '已上阵',
  unknownCard: '不认识的卡',
};

export function addCard(deck: Deck, cardId: string, now: Date): Deck {
  return { ...deck, cardIds: [...deck.cardIds, cardId], updatedAt: now.toISOString() };
}

/** 按下标移除——**不能按 cardId 移除**：重复卡只能精确删掉点击的那一张。 */
export function removeCardAt(deck: Deck, index: number, now: Date): Deck {
  if (index < 0 || index >= deck.cardIds.length) {
    return deck;
  }
  return {
    ...deck,
    cardIds: deck.cardIds.filter((_, at) => at !== index),
    updatedAt: now.toISOString(),
  };
}

export function clearDeck(deck: Deck, now: Date): Deck {
  return { ...deck, cardIds: [], updatedAt: now.toISOString() };
}

export function renameDeck(deck: Deck, name: string, now: Date): Deck {
  const trimmed = name.trim().slice(0, 24);
  return { ...deck, name: trimmed.length > 0 ? trimmed : deck.name, updatedAt: now.toISOString() };
}

export type DeckIssue = 'empty' | 'overLimit' | 'missingCopies';

/**
 * 卡组能不能拿去打。战役启动前会再查一次——
 * 界面上的 `canAddCard` 管的是「编辑时能不能加」，
 * 这一条管的是「现在这份卡组还能不能用」（库存可能被融合消耗掉了）。
 */
export function validateDeck(deck: Deck, inventory: Readonly<Record<string, number>>): DeckIssue[] {
  const issues: DeckIssue[] = [];
  if (deck.cardIds.length === 0) {
    issues.push('empty');
  }
  if (deck.cardIds.length > DECK_LIMIT) {
    issues.push('overLimit');
  }
  const needed = new Map<string, number>();
  for (const cardId of deck.cardIds) {
    needed.set(cardId, (needed.get(cardId) ?? 0) + 1);
  }
  for (const [cardId, count] of needed) {
    if ((inventory[cardId] ?? 0) < count) {
      issues.push('missingCopies');
      break;
    }
  }
  return issues;
}

export const DECK_ISSUE_TEXT: Record<DeckIssue, string> = {
  empty: '卡组是空的',
  overLimit: `卡组超过 ${DECK_LIMIT} 张`,
  missingCopies: '有卡已经不在库存里了',
};
