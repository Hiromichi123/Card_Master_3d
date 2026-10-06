/**
 * 组卡界面的派生层。
 *
 * 断的是**界面会照着做的那些数**：可用张数、槽位顺序、判据结果。
 * 这里的规则本身（上限、判据）由 `progression.test.ts` 的「卡组」一组守着，
 * 这一份只管「摊给界面之后还是不是那回事」。
 *
 * **文案一律从领域常量反查，不在测试里抄一遍中文**——抄一遍就等于把
 * 两处字符串钉在一起，改一处文案要改两处，而漏改的那次不会有人发现。
 */

import { describe, expect, it } from 'vitest';

import {
  ADD_REJECTION_NOTE,
  ADD_REJECTION_TEXT,
  DECK_ISSUE_TEXT,
  DECK_LIMIT,
  createDeck,
  removeCardAt,
} from '../../src/domain/progression/deck';
import {
  addToDeck,
  deckEditorRows,
  deckSlots,
  deckSummary,
} from '../../src/domain/progression/deckView';
import type { Deck } from '../../src/domain/progression/types';

const at = (cardIds: readonly string[]): Deck =>
  createDeck('d', 'd', cardIds, new Date(0));

describe('组卡派生：每一行', () => {
  const inventory = { A: 3, B: 1, C: 0 };

  it('可用 = 拥有 − 已上阵，判据也是同一个数', () => {
    const rows = deckEditorRows(inventory, at(['A', 'A']));
    const a = rows.find((row) => row.cardId === 'A');
    expect(a).toMatchObject({ count: 3, inDeck: 2, available: 1 });
    expect(a?.add.ok).toBe(true);
  });

  it('拥有量为 0 的卡不进列表（库存里残留下的 0 不该出现在收藏里）', () => {
    const rows = deckEditorRows(inventory, at([]));
    expect(rows.map((row) => row.cardId)).toEqual(['A', 'B']);
  });

  it('库存用尽时那一行给 noneLeft，可用为 0', () => {
    const rows = deckEditorRows(inventory, at(['B']));
    const b = rows.find((row) => row.cardId === 'B');
    expect(b?.available).toBe(0);
    expect(b?.add.ok).toBe(false);
    expect(b?.add.ok === false ? b.add.reason : '').toBe('noneLeft');
  });

  it('卡组满 12 张时**每一行**都是 full，不只是某一张', () => {
    const full = at(Array.from({ length: DECK_LIMIT }, () => 'A'));
    const rows = deckEditorRows({ A: 99, B: 99 }, full);
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.add.ok).toBe(false);
      expect(row.add.ok === false ? row.add.reason : '').toBe('full');
    }
  });

  it('known 说这张卡不认识，那一行就是 unknownCard', () => {
    const rows = deckEditorRows(inventory, at([]), (id) => id !== 'A');
    const a = rows.find((row) => row.cardId === 'A');
    expect(a?.add.ok === false ? a.add.reason : '').toBe('unknownCard');
  });
});

describe('组卡派生：加卡', () => {
  const inventory = { A: 2 };

  it('通过时新卡组多一张，且 updatedAt 变了', () => {
    const before = at(['A']);
    const outcome = addToDeck(before, inventory, 'A', new Date(1000));
    expect(outcome.rejection).toBeNull();
    expect(outcome.message).toBeNull();
    expect(outcome.deck.cardIds).toEqual(['A', 'A']);
    expect(outcome.deck.updatedAt).not.toBe(before.updatedAt);
  });

  it('被拒时返回**原来那个引用**，界面不用自己恢复现场', () => {
    const before = at(['A', 'A']);
    const outcome = addToDeck(before, inventory, 'A', new Date(1000));
    expect(outcome.deck).toBe(before);
    expect(outcome.rejection).toBe('noneLeft');
    expect(outcome.message).toBe(ADD_REJECTION_TEXT.noneLeft);
  });

  it('满 12 张时被拒且文案来自领域常量', () => {
    const full = at(Array.from({ length: DECK_LIMIT }, () => 'A'));
    const outcome = addToDeck(full, { A: 99 }, 'A', new Date(1000));
    expect(outcome.deck).toBe(full);
    expect(outcome.rejection).toBe('full');
    expect(outcome.message).toBe(ADD_REJECTION_TEXT.full);
  });
});

describe('组卡派生：槽位', () => {
  it('长度恒为 12，前 N 个照卡组顺序（重复卡不被合并）', () => {
    const slots = deckSlots(at(['A', 'B', 'A']));
    expect(slots).toHaveLength(DECK_LIMIT);
    expect(slots.map((slot) => slot.cardId).slice(0, 4)).toEqual(['A', 'B', 'A', null]);
    expect(slots.map((slot) => slot.index)).toEqual(
      Array.from({ length: DECK_LIMIT }, (_, index) => index),
    );
  });

  it('按下标删，删掉的是点的那一个而不是同名的第一个', () => {
    const deck = at(['A', 'B', 'A']);
    const after = removeCardAt(deck, 2, new Date(1000));
    expect(after.cardIds).toEqual(['A', 'B']);
  });
});

describe('组卡派生：页头汇总', () => {
  const inventory = { A: 2, B: 1 };

  it('空卡组给出 empty 文案（来自 DECK_ISSUE_TEXT）', () => {
    const summary = deckSummary(at([]), inventory);
    expect(summary.size).toBe(0);
    expect(summary.limit).toBe(DECK_LIMIT);
    expect(summary.issues).toContain('empty');
    expect(summary.text).toContain(DECK_ISSUE_TEXT.empty);
  });

  it('上阵的卡被消耗掉之后给出 missingCopies', () => {
    const summary = deckSummary(at(['A', 'A']), { A: 1 });
    expect(summary.issues).toContain('missingCopies');
    expect(summary.text).toContain(DECK_ISSUE_TEXT.missingCopies);
  });

  it('正常卡组没有问题', () => {
    const summary = deckSummary(at(['A', 'B']), inventory);
    expect(summary.size).toBe(2);
    expect(summary.issues).toEqual([]);
    expect(summary.text).toEqual([]);
  });
});

describe('组卡派生：文案表的守门', () => {
  /**
   * 界面上的「点不动」的理由常显在卡片角标上，用的是 `ADD_REJECTION_TEXT`。
   * 将来给 `AddRejection` 加了新成员却忘了补文案，`Record` 类型会报错；
   * 但**删掉**某个成员、或有人把文案拆成两张表，类型就管不住了——
   * 这条断言把「拒绝原因 ↔ 文案」的覆盖关系钉死。
   */
  it('每一种拒绝原因都有文案，且没有多余的键', () => {
    const reasons = ['full', 'noneLeft', 'unknownCard'] as const;
    expect(Object.keys(ADD_REJECTION_TEXT).sort()).toEqual([...reasons].sort());
    for (const reason of reasons) {
      expect(ADD_REJECTION_TEXT[reason].length).toBeGreaterThan(0);
    }
  });

  /** 角标那份短文案（`ADD_REJECTION_NOTE`）必须与长文案同键——两处键集合相等。 */
  it('长文案与角标短文案的键集合完全一致', () => {
    expect(Object.keys(ADD_REJECTION_NOTE).sort()).toEqual(
      Object.keys(ADD_REJECTION_TEXT).sort(),
    );
    for (const [reason, note] of Object.entries(ADD_REJECTION_NOTE)) {
      expect(note.length).toBeGreaterThan(0);
      // 短文案就该短：长了会在卡片角标上盖住卡面
      expect(note.length).toBeLessThanOrEqual(
        (ADD_REJECTION_TEXT[reason as keyof typeof ADD_REJECTION_TEXT] ?? '').length,
      );
    }
  });
});
