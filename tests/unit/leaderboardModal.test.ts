// @vitest-environment jsdom
import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeaderboardModal } from '../../src/ui/LeaderboardModal';
import { RankingButton } from '../../src/ui/RankingButton';
import { HubScene } from '../../src/scenes/HubScene';
import { cardDatabase } from '../../src/data';
import { collectionCompletion } from '../../src/domain/progression/collection';
import { createInitialProfile } from '../../src/domain/progression/profile';
import type { ProfileState } from '../../src/domain/progression/types';

vi.mock('../../src/ui/HubLogoLayer', () => ({ HubLogoLayer: ({ items }: { items: readonly { id: string }[] }) =>
  createElement('div', { 'data-testid': 'logos', 'data-ids': items.map(item => item.id).join(',') }) }));
vi.mock('../../src/ui/MenuChrome', () => ({ MenuChrome: ({ children }: { children: ReactNode }) => createElement('div', null, children) }));
vi.mock('../../src/ui/HubWordmark', () => ({ HubWordmark: () => null }));
vi.mock('../../src/ui/HubSideRail', () => ({ HubSideRail: () => null }));
vi.mock('../../src/ui/PosterCarousel', () => ({ PosterCarousel: () => null }));

let host: HTMLDivElement, root: Root;
const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
const close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
let oldShow: PropertyDescriptor | undefined, oldClose: PropertyDescriptor | undefined;
const profile = () => createInitialProfile({ contentVersion: 'test', dayKey: '20261011', starterCardIds: [], now: new Date('2026-10-11T12:00:00Z') });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  oldShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
  oldClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close });
  showModal.mockClear(); close.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  if (oldShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', oldShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (oldClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', oldClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function button(selector: string): HTMLButtonElement { return document.querySelector<HTMLButtonElement>(selector)!; }
function Harness({ current }: { current: ProfileState }) {
  const [open, setOpen] = useState(false);
  return createElement('div', null, createElement(RankingButton, { onClick: () => setOpen(true) }),
    open && createElement(LeaderboardModal, { profile: current, playerName: '测试玩家', onClose: () => setOpen(false) }));
}
async function open(current = profile()) {
  await act(async () => root.render(createElement(Harness, { current })));
  button('.ranking-button').focus();
  await act(async () => button('.ranking-button').click());
}

describe('共享排行榜浮层', () => {
  it('原生模态包含21条、一条本人、本地演示标记与单页禁用按钮', async () => {
    await open();
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog')!.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('.leaderboard__description')!.textContent).toContain('20个虚拟账号 + 当前玩家');
    expect(document.querySelectorAll('tbody tr')).toHaveLength(21);
    expect(document.querySelectorAll('tr[data-self="true"]')).toHaveLength(1);
    expect(document.querySelector('tr[data-self="true"]')!.textContent).toContain('测试玩家');
    expect([...document.querySelectorAll<HTMLButtonElement>('.leaderboard__footer button')].every(item => item.disabled)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
  });
  it('收藏榜使用实时库存和同一统计，切页签键盘可用，不因重渲染重复打开模态', async () => {
    const base = profile();
    await open(base);
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    await act(async () => { tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);
    const first = cardDatabase.definitions.find(card => card.status === 'complete')!;
    const current = { ...base, inventory: { [first.cardId]: 100 } };
    await act(async () => root.render(createElement(Harness, { current })));
    const value = collectionCompletion(current.inventory, cardDatabase.definitions);
    expect(document.querySelector('tr[data-self="true"] .leaderboard__value')!.textContent).toBe(`${(value.ratio * 100).toFixed(2)}%`);
    expect(document.querySelector('tr[data-self="true"]')!.textContent).toContain(`1 / ${value.total}`);
    expect(showModal).toHaveBeenCalledTimes(1);
  });
  it('ESC取消、遮罩与关闭按钮均可关闭并恢复入口焦点', async () => {
    await open();
    await act(async () => { document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })); });
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(button('.ranking-button'));
    expect(document.body.style.overflow).not.toBe('hidden');
    await act(async () => button('.ranking-button').click());
    const dialog = document.querySelector('dialog')!;
    await act(async () => { dialog.dispatchEvent(new Event('pointerdown', { bubbles: true })); dialog.click(); });
    expect(document.querySelector('dialog')).toBeNull();
    await act(async () => button('.ranking-button').click());
    await act(async () => button('[aria-label="关闭排行榜"]').click());
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(button('.ranking-button'));
  });
  it('从面板内部拖到遮罩不误关', async () => {
    await open();
    const dialog = document.querySelector('dialog')!;
    await act(async () => {
      document.querySelector('.leaderboard__panel')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      dialog.click();
    });
    expect(document.querySelector('dialog')).not.toBeNull();
  });
  it('主界面按钮直接打开同一浮层，不导航，旧3D logo列表排除排行图标', async () => {
    const navigate = vi.fn();
    await act(async () => root.render(createElement(HubScene, { profile: profile(), playerName: '主界面玩家', onNavigate: navigate, onReset: vi.fn() })));
    expect(button('.ranking-button').getAttribute('data-unavailable')).toBe('false');
    expect(host.querySelector('[data-testid="logos"]')!.getAttribute('data-ids')!.split(',')).not.toContain('ranking');
    await act(async () => button('.ranking-button').click());
    expect(document.querySelector('tr[data-self="true"]')!.textContent).toContain('主界面玩家');
    expect(navigate).not.toHaveBeenCalled();
  });
});
