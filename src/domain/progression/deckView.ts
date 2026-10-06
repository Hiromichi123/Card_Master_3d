/**
 * 组卡界面的派生数据。
 *
 * 这一层不画任何东西，只把「库存 + 当前卡组」摊成界面直接能渲染的形状。
 *
 * **为什么要有它**：每一行卡同时要三个数——拥有几张、已放进卡组几张、还能放几张——
 * 外加一个「现在能不能放」的判据。散在 JSX 里各算一遍，迟早出现
 * 「按钮是灰的但可用张数显示 1」这种自相矛盾的状态。这里算一次，界面照抄。
 *
 * 判据一律走 `deck.ts` 的 `canAddCard`（**UI 与领域共用同一个判据**，
 * `deck.ts:47` 明写），本文件不重新实现规则、也不自作主张放宽。
 */

import {
  ADD_REJECTION_TEXT,
  DECK_ISSUE_TEXT,
  DECK_LIMIT,
  addCard,
  availableCopies,
  canAddCard,
  countIn,
  validateDeck,
} from './deck';
import type { AddCheck, AddRejection, DeckIssue } from './deck';
import type { Deck } from './types';

/** 收藏里的一行：这张卡当前能拿它做什么。 */
export interface DeckEditorRow {
  readonly cardId: string;
  /** 拥有几张。 */
  readonly count: number;
  /** 已经放进当前卡组的张数。 */
  readonly inDeck: number;
  /** 还能放几张（= 拥有 − 已上阵）。界面上的「可用」徽标就是它。 */
  readonly available: number;
  /** 现在能不能再放一张。**界面直接照它设置 disabled**。 */
  readonly add: AddCheck;
}

/**
 * 把库存摊成收藏列表。
 *
 * 只保留拥有量 > 0 的卡；`known` 用来判「这张卡还在数据里吗」，
 * 缺省恒真（与 `canAddCard` 的缺省一致）。
 */
export function deckEditorRows(
  inventory: Readonly<Record<string, number>>,
  deck: Deck,
  known: (id: string) => boolean = () => true,
): readonly DeckEditorRow[] {
  const rows: DeckEditorRow[] = [];
  for (const [cardId, count] of Object.entries(inventory)) {
    if (count <= 0) {
      continue;
    }
    rows.push({
      cardId,
      count,
      inDeck: countIn(deck, cardId),
      available: availableCopies(inventory, deck, cardId),
      add: canAddCard(deck, inventory, cardId, known),
    });
  }
  return rows;
}

/** 卡组里的一个槽位。空槽 `cardId` 为 `null`。 */
export interface DeckSlot {
  readonly index: number;
  readonly cardId: string | null;
}

/**
 * 摊成固定长度的槽位表（缺省补到 12）。
 *
 * **保序、不去重**：抽到 3 张同卡就能放 3 个同名槽位，
 * 每个槽位靠 `index` 定位——删的时候才能精确删掉点的那一个（`removeCardAt`）。
 */
export function deckSlots(deck: Deck, limit: number = DECK_LIMIT): readonly DeckSlot[] {
  const slots: DeckSlot[] = [];
  for (let index = 0; index < limit; index += 1) {
    slots.push({ index, cardId: deck.cardIds[index] ?? null });
  }
  return slots;
}

export interface DeckSummary {
  readonly size: number;
  readonly limit: number;
  readonly issues: readonly DeckIssue[];
  /** 问题的中文文案，取自 `DECK_ISSUE_TEXT`。 */
  readonly text: readonly string[];
}

/**
 * 页头那一行汇总。
 *
 * 与 `deckEditorRows` 的分工：那边管「编辑时能不能加」，
 * 这边管「这份卡组现在还能不能用」——库存可能被消耗（融合、导入），
 * 上阵的卡就不在库存里了，那是 `missingCopies`。
 */
export function deckSummary(
  deck: Deck,
  inventory: Readonly<Record<string, number>>,
): DeckSummary {
  const issues = validateDeck(deck, inventory);
  return {
    size: deck.cardIds.length,
    limit: DECK_LIMIT,
    issues,
    text: issues.map((issue) => DECK_ISSUE_TEXT[issue]),
  };
}

export interface AddOutcome {
  /** 被拒时是**原来那个引用**（原样返回，界面可以靠 `===` 判断没变）。 */
  readonly deck: Deck;
  readonly rejection: AddRejection | null;
  /** 被拒时的中文文案，取自 `ADD_REJECTION_TEXT`。 */
  readonly message: string | null;
}

/**
 * 加一张卡：**先查后加，包成一个不可绕过的步骤**。
 *
 * 界面不该出现「自己判一遍再调 `addCard`」的写法——那样迟早有人漏判。
 * 被拒时返回原 deck 引用，调用方不需要额外分支去「恢复现场」。
 */
export function addToDeck(
  deck: Deck,
  inventory: Readonly<Record<string, number>>,
  cardId: string,
  now: Date,
  known: (id: string) => boolean = () => true,
): AddOutcome {
  const check = canAddCard(deck, inventory, cardId, known);
  if (!check.ok) {
    return { deck, rejection: check.reason, message: ADD_REJECTION_TEXT[check.reason] };
  }
  return { deck: addCard(deck, cardId, now), rejection: null, message: null };
}
