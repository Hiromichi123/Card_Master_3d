import { describe, expect, it } from 'vitest';
import { ProfileStore } from '../../src/state/createProfileStore';
import { fixedClock } from '../../src/domain/progression/clock';
import { createInitialProfile } from '../../src/domain/progression/profile';
import type { ProfileState } from '../../src/domain/progression/types';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import type { SaveRepository } from '../../src/services/save/SaveRepository';

async function setup(repository: SaveRepository = new MemorySaveRepository()) {
  const store = new ProfileStore({ repository, clock: fixedClock(new Date('2026-10-11T12:00:00Z')),
    seedSource: () => 1, contentVersion: 'test', starterCardIds: ['a', 'b'], debounceMs: 100000 });
  await store.load();
  return store;
}
function flaky(initial: ProfileState | null = null) {
  const inner = new MemorySaveRepository(initial);
  let fail = true;
  const repository: SaveRepository = {
    kind: 'memory', load: () => inner.load(), clear: () => inner.clear(), close: () => {},
    commit: p => fail ? Promise.reject(new Error('disk full')) : inner.commit(p),
  };
  return { repository, inner, recover: () => { fail = false; } };
}

describe('多卡组保存队列', () => {
  it('快速切三槽各自保留最新草稿，一批落盘且不改普通active', async () => {
    const repository = new MemorySaveRepository();
    const store = await setup(repository);
    const p = store.getSnapshot().profile!;
    const ids = [p.normalDeckIds[0], p.normalDeckIds[1], p.ladder.deckId];
    for (const [index, id] of ids.entries()) store.saveDeck({ ...store.getDeckDraft(id)!, name: `edit-${index}` });
    store.saveDeck({ ...store.getDeckDraft(ids[0]!)!, name: 'latest' });
    expect(store.getSnapshot().deckDirty).toBe(true);
    expect(store.getDeckDraft(ids[0]!)!.name).toBe('latest');
    expect(await store.flushDecks()).toEqual({ ok: true });
    expect(repository.commitCount).toBe(1);
    expect(store.getSnapshot().profile!.activeDeckId).toBe(p.activeDeckId);
    expect(ids.map(id => store.getDeckDraft(id)!.name)).toEqual(['latest', 'edit-1', 'edit-2']);
    expect(store.hasUnsavedDecks()).toBe(false);
    store.dispose();
  });

  it('失败保留会话草稿/原profile，拒绝旧档导出和覆盖，重试读最新资源', async () => {
    const failed = flaky();
    const store = await setup(failed.repository);
    const before = store.getSnapshot().profile!;
    const id = before.normalDeckIds[1];
    store.saveDeck({ ...store.getDeckDraft(id)!, cardIds: ['b'], name: '未保存' });
    expect((await store.flushDecks()).ok).toBe(false);
    expect(store.getSnapshot().profile).toBe(before);
    expect(store.getSnapshot().deckSaveError).toContain('disk full');
    expect(store.getDeckDraft(id)!.name).toBe('未保存');
    expect(await store.exportProfile()).toBeNull();
    expect((await store.importProfile([{ name: 'old.json', text: JSON.stringify(before) }])).ok).toBe(false);
    await expect(store.resetProfile()).rejects.toThrow('尚未保存');
    expect(store.getDeckDraft(id)!.name).toBe('未保存');
    failed.recover();
    expect((await store.commitEconomic(() => ({ transaction: { operationId: 'reward', currencyDelta: { gold: 9 }, inventoryDelta: {} }, view: null }))).ok).toBe(true);
    expect((await store.flushDecks()).ok).toBe(true);
    expect(store.getSnapshot().profile!.currencies.gold).toBe(before.currencies.gold + 9);
    expect(store.getSnapshot().deckSaveError).toBeNull();
    expect(failed.inner.peek()!.decks.find(d => d.id === id)!.name).toBe('未保存');
    store.dispose();
  });

  it('旧批次在飞时的新编辑不会被旧成功确认清除', async () => {
    const inner = new MemorySaveRepository();
    let release!: () => void;
    let started!: () => void;
    const begun = new Promise<void>(resolve => { started = resolve; });
    let first = true;
    const repository: SaveRepository = {
      kind: 'memory', load: () => inner.load(), clear: () => inner.clear(), close: () => {},
      commit: async p => {
        if (first) { first = false; started(); await new Promise<void>(resolve => { release = resolve; }); }
        await inner.commit(p);
      },
    };
    const store = await setup(repository);
    const id = store.getSnapshot().profile!.ladder.deckId;
    store.saveDeck({ ...store.getDeckDraft(id)!, name: 'old' });
    const saving = store.flushDecks();
    await begun;
    store.saveDeck({ ...store.getDeckDraft(id)!, name: 'new' });
    release();
    expect((await saving).ok).toBe(false);
    expect(store.getDeckDraft(id)!.name).toBe('new');
    expect(store.getSnapshot().profile!.decks.find(d => d.id === id)!.name).toBe('old');
    expect((await store.flushDecks()).ok).toBe(true);
    expect(inner.peek()!.decks.find(d => d.id === id)!.name).toBe('new');
    store.dispose();
  });

  it('旧批次失败保留更晚草稿，切普通active也只在成功保存后发布', async () => {
    const inner = new MemorySaveRepository();
    let reject!: (error: Error) => void;
    let started!: () => void;
    const begun = new Promise<void>(resolve => { started = resolve; });
    let first = true;
    const repository: SaveRepository = {
      kind: 'memory', load: () => inner.load(), clear: () => inner.clear(), close: () => {},
      commit: async p => {
        if (first) { first = false; started(); await new Promise<void>((_, fail) => { reject = fail; }); }
        await inner.commit(p);
      },
    };
    const store = await setup(repository);
    const profile = store.getSnapshot().profile!;
    const id = profile.normalDeckIds[1];
    store.saveDeck({ ...store.getDeckDraft(id)!, name: 'old' });
    store.setActiveDeck(id);
    const saving = store.flushDecks();
    await begun;
    store.saveDeck({ ...store.getDeckDraft(id)!, name: 'new' });
    reject(new Error('disk full'));
    expect((await saving).ok).toBe(false);
    expect(store.getDeckDraft(id)!.name).toBe('new');
    expect(store.getSnapshot().profile!.activeDeckId).toBe(profile.activeDeckId);
    expect((await store.flushDecks()).ok).toBe(true);
    expect(store.getSnapshot().profile!.activeDeckId).toBe(id);
    expect(inner.peek()!.decks.find(d => d.id === id)!.name).toBe('new');
    store.dispose();
  });

  it('自动加载拒绝坏v4槽位；成功整档替换不留下旧草稿', async () => {
    const original = createInitialProfile({ contentVersion: 'test', dayKey: '20261011', starterCardIds: ['a'], now: new Date() });
    const invalid = { ...original, ladder: { ...original.ladder, deckId: 'missing' } };
    const bad = await setup(new MemorySaveRepository(invalid));
    expect(bad.getSnapshot().status).toBe('error'); bad.dispose();
    const store = await setup();
    const id = store.getSnapshot().profile!.normalDeckIds[0];
    store.saveDeck({ ...store.getDeckDraft(id)!, name: 'draft' });
    expect((await store.importProfile([{ name: 'valid.json', text: JSON.stringify(original) }])).ok).toBe(true);
    expect(store.hasUnsavedDecks()).toBe(false);
    expect(store.getDeckDraft(id)!.name).not.toBe('draft');
    await store.flush();
    expect(store.getSnapshot().profile).toEqual(original);
    store.dispose();
  });
});
