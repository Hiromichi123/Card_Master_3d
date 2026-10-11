import { describe, expect, it } from 'vitest';
import { initializeDeckSlots, ladderDeckOf, validDeckSlots } from '../../src/domain/progression/deckSlots';
import { createInitialProfile, withActiveDeck, withoutDeck } from '../../src/domain/progression/profile';
import { migrateToCurrent } from '../../src/domain/progression/migrations';
import { normalizeProfile } from '../../src/domain/progression/saveTransfer';
import { SAVE_SCHEMA_VERSION, type Deck, type ProfileState } from '../../src/domain/progression/types';

const now = new Date('2026-10-11T12:00:00Z');
const context = { knownCardIds: new Set(['a', 'b']), contentVersion: 'test', dayKey: '20261011', now };
const fresh = () => createInitialProfile({ ...context, starterCardIds: ['a', 'a', 'b'] });
const deck = (id: string): Deck => ({ id, name: id, cardIds: ['a'], updatedAt: now.toISOString() });

describe('四槽卡组与天梯存档', () => {
  it('新号四槽，天梯复制普通active但不共用数组，不多发库存', () => {
    const p = fresh();
    expect(p.decks).toHaveLength(4);
    expect(new Set([...p.normalDeckIds, p.ladder.deckId]).size).toBe(4);
    expect(ladderDeckOf(p)!.cardIds).toEqual(p.decks[0]!.cardIds);
    expect(ladderDeckOf(p)!.cardIds).not.toBe(p.decks[0]!.cardIds);
    expect(p.inventory).toEqual({ a: 2, b: 1 });
    expect(p.ladder.points).toBe(0);
    expect(p.decks.find(d => d.id === p.normalDeckIds[1])!.cardIds).toEqual([]);
  });

  it('迁移保留全部旧卡组，active优先映射1，ID冲突不覆盖', () => {
    const oldDecks = ['normal-2', 'normal-3', 'ladder', 'old-extra', 'active'].map(deck);
    const slots = initializeDeckSlots(oldDecks, 'active');
    expect(slots.decks.slice(0, oldDecks.length)).toEqual(oldDecks);
    expect(slots.normalDeckIds).toEqual(['active', 'normal-2', 'normal-3']);
    expect(slots.ladder.deckId).not.toBe('ladder');
    expect(slots.decks.find(d => d.id === 'old-extra')).toEqual(oldDecks[3]);
    expect(slots.decks).toHaveLength(6);
  });

  it('0/1套旧卡组补空槽，不擅自设置普通active', () => {
    for (const oldDecks of [[], [deck('one')]]) {
      const slots = initializeDeckSlots(oldDecks, null);
      expect(slots.decks).toHaveLength(4);
      expect(slots.decks.find(d => d.id === slots.ladder.deckId)!.cardIds).toEqual([]);
      expect(validDeckSlots(slots.decks, slots.normalDeckIds, slots.ladder, null)).toBe(true);
    }
  });

  it('v1/v2/v3升级到当前版本，再加载不增生卡组，迷宫与资源不丢', () => {
    for (const version of [1, 2, 3]) {
      const old = { ...fresh(), schemaVersion: version, decks: [deck('active')], activeDeckId: 'active' };
      const result = migrateToCurrent(old, version);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const upgraded = result.value as ProfileState;
      expect(upgraded.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
      expect(upgraded.decks).toHaveLength(4);
      expect(upgraded.activeDeckId).toBe('active');
      expect(upgraded.inventory).toEqual(old.inventory);
      expect(upgraded.mazeRun).toEqual(old.mazeRun);
      expect(upgraded.mazeProgress).toEqual(old.mazeProgress);
      const again = migrateToCurrent(upgraded, SAVE_SCHEMA_VERSION);
      expect(again.ok && again.value).toEqual(upgraded);
    }
  });

  it('固定槽不可删除，天梯/不存在ID不可成为普通出战，extra仍可用', () => {
    const p = fresh();
    for (const id of [...p.normalDeckIds, p.ladder.deckId]) expect(withoutDeck(p, id)).toBe(p);
    expect(withActiveDeck(p, p.ladder.deckId)).toBe(p);
    expect(withActiveDeck(p, 'missing')).toBe(p);
    const extra = { ...p, decks: [...p.decks, deck('extra')], activeDeckId: 'extra' };
    expect(validDeckSlots(extra.decks, extra.normalDeckIds, extra.ladder, extra.activeDeckId)).toBe(true);
    expect(withoutDeck(extra, 'extra').activeDeckId).toBeNull();
  });

  it('原生往返保存真实积分与映射，坏槽位不偷偷重建', () => {
    const p = { ...fresh(), ladder: { ...fresh().ladder, points: 2700 } };
    const result = normalizeProfile(JSON.parse(JSON.stringify(p)), context);
    expect(result.ok && result.profile).toEqual(p);
    for (const patch of [
      { ladder: { ...p.ladder, points: -1 } },
      { ladder: { ...p.ladder, points: Infinity } },
      { ladder: { ...p.ladder, points: 3.5 } },
      { ladder: { ...p.ladder, deckId: p.normalDeckIds[0] } },
      { normalDeckIds: [p.normalDeckIds[0], p.normalDeckIds[0], p.normalDeckIds[2]] },
      { normalDeckIds: undefined },
      { activeDeckId: p.ladder.deckId },
      { activeDeckId: 'missing' },
    ]) expect(normalizeProfile({ ...p, ...patch }, context).ok).toBe(false);
  });
});
