// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cardDatabase } from '../../src/data';
import { makeAbyssCard } from '../../src/domain/progression/abyssRules';
import { emptyAbyssState } from '../../src/domain/progression/abyssRun';
import { AbyssHistoryDialog, AbyssTraitsDialog } from '../../src/ui/AbyssRecords';
import { AbyssCard } from '../../src/ui/AbyssCard';
import { useCardTipStore } from '../../src/state/cardTipStore';
import { CardTipHost } from '../../src/ui/CardTipHost';

vi.mock('../../src/ui/CardHoverTip', () => ({ CardHoverTip: () => null }));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useCardTipStore.getState().hide(); vi.unstubAllGlobals(); });

it('历史显示冻结培养卡，不用runtime ID回查主卡库；关闭恢复焦点', async () => {
  const trigger = document.createElement('button'); document.body.appendChild(trigger); trigger.focus();
  const base = cardDatabase.definitions.find(card => card.status === 'complete' && card.hp > 0)!;
  const card = makeAbyssCard(base, 'abyss/history/unique', 5, 8);
  const close = vi.fn();
  await act(async () => root.render(createElement(AbyssHistoryDialog, { state: { ...emptyAbyssState(), history: [{
    runId: 'abyss/history', startedAt: '2026-10-11T00:00:00Z', endedAt: '2026-10-11T01:00:00Z', reason: 'settled', floor: 1, encounter: 10,
    wins: 10, losses: 0, coins: 15, earnedCoins: 420, cards: [card],
  }] }, onClose: close })));
  expect(host.querySelector('dialog')?.open).toBe(true);
  expect(host.textContent).toContain('主动结算');
  expect(host.textContent).toContain(`ATK ${base.atk + 5}`);
  expect(host.textContent).toContain(`HP ${base.hp + 8}`);
  await act(async () => host.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true })));
  expect(close).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  expect(document.activeElement).toBe(trigger); trigger.remove();
});

it('特性目录可切三类，并标记遭遇，不以未实现占位代替规则', async () => {
  await act(async () => root.render(createElement(AbyssTraitsDialog, { state: { ...emptyAbyssState(), knownEffectIds: ['might'] }, onClose: vi.fn() })));
  expect(host.querySelector('[data-known="true"]')?.textContent).toContain('战意');
  const tabs = [...host.querySelectorAll<HTMLButtonElement>('.abyss-tabs button')];
  await act(async () => tabs.find(button => button.textContent === '绑定负面')!.click());
  expect(host.textContent).toContain('脆弱'); expect(host.textContent).not.toContain('虚无庇护');
  await act(async () => tabs.find(button => button.textContent === '培养特性')!.click());
  expect(host.textContent).toContain('火球1'); expect(host.textContent).toContain('未获得');
});

it('临时卡悬停传完整定义，卸载清理提示，动态属性不读原图文字', async () => {
  const base = cardDatabase.definitions.find(card => card.status === 'complete' && card.hp > 0)!;
  const card = makeAbyssCard(base, 'abyss/card/unique', 3, 2).definition;
  await act(async () => root.render(createElement(AbyssCard, { card })));
  await act(async () => (host.querySelector('article') as HTMLElement).focus());
  expect(useCardTipStore.getState().target?.card).toBe(card);
  expect(host.textContent).toContain(`ATK ${card.atk}`);
  await act(async () => root.render(null)); expect(useCardTipStore.getState().target).toBeNull();
});

it('全局提示宿主移动到临时卡子元素仍保留完整definition', async () => {
  let frame: FrameRequestCallback | null = null;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const card = cardDatabase.definitions.find(item => item.status === 'complete')!;
  const owner = document.createElement('article'); const child = document.createElement('span'); owner.appendChild(child); document.body.appendChild(owner);
  await act(async () => root.render(createElement(CardTipHost)));
  await act(async () => useCardTipStore.getState().show(card.cardId, { x: 0, y: 0 }, { card, ownerElement: owner, ownerKey: 'explicit' }));
  await act(async () => {
    child.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 24, clientY: 33 }));
    if (frame) (frame as FrameRequestCallback)(0);
  });
  expect(useCardTipStore.getState().target?.card).toBe(card);
  expect(useCardTipStore.getState().target?.pointer).toEqual({ x: 24, y: 33 });
  owner.remove();
});
