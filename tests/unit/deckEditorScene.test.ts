// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardById, cardDatabase } from '../../src/data';
import { collectionCompletion } from '../../src/domain/progression/collection';
import { fixedClock } from '../../src/domain/progression/clock';
import { DeckEditorScene } from '../../src/scenes/DeckEditorScene';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import { ProfileStore } from '../../src/state/createProfileStore';

vi.mock('../../src/ui/CardTile', () => ({
  CardTile: ({ cardId, disabled, onClick }: { cardId: string; disabled?: boolean; onClick?: () => void }) =>
    createElement('button', { type: 'button', disabled, onClick, 'data-card-id': cardId }, cardId),
}));
vi.mock('../../src/ui/ScrollArea', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));
vi.mock('../../src/ui/SceneBackground', () => ({ CrossfadeBackground: () => null }));
vi.mock('../../src/ui/useParallax', () => ({ useParallax: () => ({ current: null }) }));

const cards = [...cardById.values()].filter(card => card.status === 'complete').slice(0, 2).map(card => card.cardId);
const firstCard = cards[0]!;
const secondCard = cards[1]!;
let host: HTMLDivElement, root: Root, store: ProfileStore, repository: MemorySaveRepository;
const navigate = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  navigate.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  store?.dispose(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function setup(ladder = false): Promise<void> {
  repository = new MemorySaveRepository();
  store = new ProfileStore({
    repository, clock: fixedClock(new Date('2026-10-11T12:00:00Z')), seedSource: () => 123,
    contentVersion: 'test', starterCardIds: [firstCard, secondCard],
    ownedCardIds: [firstCard, firstCard, secondCard, secondCard], debounceMs: 60_000,
  });
  await store.load();
  await render(ladder ? store.getSnapshot().profile!.ladder.deckId : undefined);
}
async function render(initialDeckId?: string): Promise<void> {
  await act(async () => root.render(createElement(DeckEditorScene, {
    profile: store.getSnapshot().profile!, store, initialDeckId, onNavigate: navigate,
  })));
}
function button(selector: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(selector);
  if (!found) throw new Error(`找不到 ${selector}`);
  return found;
}
async function click(selector: string): Promise<void> {
  await act(async () => button(selector).click());
}
function tab(id: string): string { return `[role="tab"][data-deck-id="${id}"]`; }
function selectedDeck(): string | undefined {
  return host.querySelector<HTMLElement>('.deckedit__slots')!.dataset.deckId;
}
function slotCards(): string[] {
  return [...host.querySelectorAll<HTMLElement>('.deckedit__grid [data-card-id]')].map(card => card.dataset.cardId!);
}

function addCardSelector(id: string): string { return `.deckedit__collection button[data-card-id="${id}"]`; }

describe('四套卡组配置', () => {
  it('拥有率采用完整卡库且不随筛选与卡组编辑改变', async () => {
    await setup();
    const completion = collectionCompletion(store.getSnapshot().profile!.inventory, cardDatabase.definitions);
    const label = () => host.querySelector('.deckedit__completion')!.textContent;
    expect(label()).toContain(`${(completion.ratio * 100).toFixed(2)}%`);
    expect(label()).toContain(`${completion.owned}/${completion.total}`);
    const before = label();
    const filter = [...host.querySelectorAll<HTMLButtonElement>('.deckedit__filter button')].find(item => !item.disabled && item.textContent !== '全部')!;
    await act(async () => filter.click());
    expect(label()).toBe(before);
    await click('.deckedit__grid button');
    expect(label()).toBe(before);
    await click(tab(store.getSnapshot().profile!.ladder.deckId));
    expect(label()).toBe(before);
  });

  it('显示1/2/3/天梯四页签，天梯入口默认选天梯且无普通出战按钮', async () => {
    await setup(true);
    const profile = store.getSnapshot().profile!;
    expect([...host.querySelectorAll('[role="tab"]')].map(node => node.firstChild!.textContent))
      .toEqual(['卡组1', '卡组2', '卡组3', '天梯赛卡组']);
    expect(selectedDeck()).toBe(profile.ladder.deckId);
    expect(button(tab(profile.ladder.deckId)).getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('[data-action="activate"]')).toBeNull();
    expect(store.getSnapshot().profile!.activeDeckId).toBe(profile.activeDeckId);
    await click('[data-action="battle-menu"]');
    expect(navigate).toHaveBeenCalledWith('battlemenu');
  });

  it('快速切换普通1→2→天梯各自保留草稿，保存后不串卡、不改普通active', async () => {
    await setup();
    const profile = store.getSnapshot().profile!;
    const [one, two] = profile.normalDeckIds;
    await click('.deckedit__grid button');
    expect(slotCards()).toEqual([secondCard]);
    await click(tab(two));
    await click(addCardSelector(firstCard));
    await click(tab(profile.ladder.deckId));
    await click(addCardSelector(firstCard));
    expect(slotCards()).toEqual([firstCard, secondCard, firstCard]);
    await click(tab(one));
    expect(slotCards()).toEqual([secondCard]);
    await click(tab(two));
    expect(slotCards()).toEqual([firstCard]);
    expect(store.getSnapshot().profile!.activeDeckId).toBe(profile.activeDeckId);
    await click('[data-action="ladder"]');
    expect(navigate).toHaveBeenCalledWith('ladder');
    const saved = repository.peek()!;
    expect(saved.decks.find(deck => deck.id === one)!.cardIds).toEqual([secondCard]);
    expect(saved.decks.find(deck => deck.id === two)!.cardIds).toEqual([firstCard]);
    expect(saved.decks.find(deck => deck.id === profile.ladder.deckId)!.cardIds).toEqual([firstCard, secondCard, firstCard]);
    expect(saved.activeDeckId).toBe(profile.activeDeckId);
  });

  it('页内导航保存失败留在配置、保留草稿，重试成功后可以进入天梯', async () => {
    await setup(true);
    const ladderId = store.getSnapshot().profile!.ladder.deckId;
    await click('.deckedit__grid button');
    const commit = vi.spyOn(repository, 'commit').mockRejectedValue(new Error('磁盘不可写'));
    await click('[data-action="ladder"]');
    expect(navigate).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')!.textContent).toContain('未保存');
    expect(slotCards()).toEqual([secondCard]);
    expect(store.getDeckDraft(ladderId)!.cardIds).toEqual([secondCard]);
    expect(repository.peek()!.decks.find(deck => deck.id === ladderId)!.cardIds).toEqual([firstCard, secondCard]);
    commit.mockRestore();
    await click('[data-action="retry-save"]');
    expect(host.querySelector('[data-action="retry-save"]')).toBeNull();
    expect(host.querySelector('[role="status"]')!.textContent).toContain('本次会话');
    await click('[data-action="ladder"]');
    expect(navigate).toHaveBeenCalledWith('ladder');
  });

  it('全局离开后重新挂载仍显示未保存的天梯草稿', async () => {
    await setup(true);
    const ladderId = store.getSnapshot().profile!.ladder.deckId;
    vi.spyOn(repository, 'commit').mockRejectedValue(new Error('磁盘不可写'));
    await click('.deckedit__grid button');
    await click('[data-action="ladder"]');
    await act(async () => root.unmount()); root = createRoot(host);
    await render(ladderId);
    expect(selectedDeck()).toBe(ladderId);
    expect(slotCards()).toEqual([secondCard]);
    expect(host.querySelector('[role="status"]')!.textContent).toContain('未保存');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('切普通页签不会出战，只有明确设置且保存成功才改active', async () => {
    await setup();
    const profile = store.getSnapshot().profile!;
    const two = profile.normalDeckIds[1];
    await click(tab(two));
    await click(addCardSelector(firstCard));
    expect(store.getSnapshot().profile!.activeDeckId).toBe(profile.activeDeckId);
    await click('[data-action="activate"]');
    expect(repository.peek()!.activeDeckId).toBe(two);
    expect(button('[data-action="activate"]').textContent).toBe('普通出战中');
    await click(tab(profile.ladder.deckId));
    expect(host.querySelector('[data-action="activate"]')).toBeNull();
    expect(store.getSnapshot().profile!.activeDeckId).toBe(two);
  });

  it('失败的设为出战不提前显示普通出战标记', async () => {
    await setup();
    const before = store.getSnapshot().profile!;
    const two = before.normalDeckIds[1];
    await click(tab(two));
    vi.spyOn(repository, 'commit').mockRejectedValue(new Error('磁盘不可写'));
    await click('[data-action="activate"]');
    expect(store.getSnapshot().profile!.activeDeckId).toBe(before.activeDeckId);
    expect(button('[data-action="activate"]').textContent).toBe('设为普通出战');
    expect(button(tab(two)).textContent).not.toContain('普通出战');
    expect(host.querySelector('[role="status"]')!.textContent).toContain('未保存');
  });

  it('额外旧卡组可编辑，不挤占三个槽位或自动修改active', async () => {
    await setup();
    const before = store.getSnapshot().profile!;
    await act(async () => {
      store.saveDeck({ id: 'legacy-extra', name: '旧配置', cardIds: [secondCard], updatedAt: '2026-10-11T12:00:00Z' });
      await store.flushDecks();
    });
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="其他已有卡组"]')!;
    await act(async () => {
      select.value = 'legacy-extra'; select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(selectedDeck()).toBe('legacy-extra');
    expect(slotCards()).toEqual([secondCard]);
    expect(store.getSnapshot().profile!.normalDeckIds).toEqual(before.normalDeckIds);
    expect(store.getSnapshot().profile!.activeDeckId).toBe(before.activeDeckId);
  });
});
