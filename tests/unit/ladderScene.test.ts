// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LadderScene } from '../../src/scenes/LadderScene';
import { BattleMenuScene } from '../../src/scenes/BattleMenuScene';
import { ActivityScene } from '../../src/scenes/ActivityScene';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { LADDER_TIERS } from '../../src/domain/progression/ladder';
import { cardDatabase } from '../../src/data';
import { fixedClock } from '../../src/domain/progression/clock';
import { ProfileStore } from '../../src/state/createProfileStore';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import { useSettingsStore } from '../../src/state/settingsStore';
import { WebGLGuard } from '../../src/scenes/WebGLGuard';

vi.mock('../../src/ui/DesignStage', () => ({ DesignStage: ({ children }: { children: ReactNode }) => createElement('div', null, children) }));
vi.mock('../../src/ui/PlayerStatus', () => ({ PlayerStatus: () => null }));
vi.mock('../../src/ui/PosterCarousel', () => ({ PosterCarousel: () => null }));
vi.mock('../../src/rendering/ladder/LadderCrystal', () => ({ LadderCrystal: ({ color, still }: { color: string; still: boolean }) => createElement('div', { 'data-testid': 'crystal', 'data-color': color, 'data-still': still }) }));

let host: HTMLDivElement, root: Root, store: ProfileStore;
const navigate = vi.fn();
const firstCard = cardDatabase.definitions.find(card => card.status === 'complete')!.cardId;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  navigate.mockClear();
  useSettingsStore.setState({ reduceMotion: false });
});
afterEach(async () => { await act(async () => root.unmount()); store?.dispose(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup(points = 0) {
  const base = createInitialProfile({ contentVersion: 'test', dayKey: '20261011', starterCardIds: [firstCard], now: new Date('2026-10-11T12:00:00Z') });
  const profile = { ...base, ladder: { ...base.ladder, points } };
  store = new ProfileStore({ repository: new MemorySaveRepository(profile), clock: fixedClock(new Date('2026-10-11T12:00:00Z')), seedSource: () => 1, contentVersion: 'test', starterCardIds: [firstCard] });
  await store.load();
  return store.getSnapshot().profile!;
}
async function renderLadder(points = 0) {
  const profile = await setup(points);
  await act(async () => root.render(createElement(LadderScene, { profile, store, onNavigate: navigate })));
}
function byText(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(button => button.textContent?.includes(text));
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found;
}

describe('天梯子页', () => {
  it('减弱动态传到水晶，WebGL不可用时仅替代装饰区', async () => {
    await renderLadder();
    await act(async () => useSettingsStore.setState({ reduceMotion: true }));
    expect(host.querySelector('[data-testid="crystal"]')!.getAttribute('data-still')).toBe('true');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await act(async () => root.render(createElement(WebGLGuard, {
      fallback: createElement('div', { 'data-testid': 'static-crystal' }, '静态水晶'),
      children: createElement('div', null, '3D'),
    })));
    expect(host.querySelector('[data-testid="static-crystal"]')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('匹配按钮禁用、2v2有NEW，配置入口可用，零分正确展示', async () => {
    await renderLadder();
    const before = store.getSnapshot().profile;
    expect(host.querySelectorAll('.ladder__actions button')).toHaveLength(3);
    expect(byText('单人匹配').disabled).toBe(true);
    expect(byText('2v2').disabled).toBe(true);
    expect(byText('2v2').textContent).toContain('NEW');
    expect(byText('单人匹配').querySelector('.ladder__score')).toBeNull();
    const score = host.querySelector('.ladder__action[data-mode="solo"] .ladder__score')!;
    expect(score.textContent).toContain('胜 +30');
    expect(score.textContent).toContain('负 −0');
    expect(score.nextElementSibling).toBe(byText('单人匹配'));
    expect(byText('配置卡组').textContent).toBe('配置卡组');
    await act(async () => { byText('单人匹配').click(); byText('2v2').click(); });
    expect(navigate).not.toHaveBeenCalled();
    expect(store.getSnapshot().profile).toBe(before);
    await act(async () => byText('配置卡组').click());
    expect(navigate).toHaveBeenCalledWith('deck');
    const bar = host.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('2400');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('只展示天梯专用卡组，卡槽保序且有强度统计', async () => {
    await renderLadder();
    expect(host.querySelectorAll('.ladder__card')).toHaveLength(12);
    expect(host.querySelectorAll('.ladder__card[data-card-id]')).toHaveLength(1);
    expect(host.querySelector('.ladder__card')!.getAttribute('data-card-id')).toBe(firstCard);
    expect(host.querySelector('.ladder__strength strong')!.textContent).toMatch(/^\d\.\d{2}$/);
    await act(async () => { store.saveDeck({ ...store.getSnapshot().profile!.decks.find(d => d.id === store.getSnapshot().profile!.ladder.deckId)!, cardIds: [] }); await store.flushDecks(); });
    expect(host.querySelectorAll('.ladder__card[data-card-id]')).toHaveLength(0);
    expect(host.querySelector('.ladder__strength strong')!.textContent).toBe('未配置');
    expect(store.getActiveDeck()!.cardIds).toEqual([firstCard]);
  });

  it('最高档颜色与称号一致，进度封顶但实际积分不截断', async () => {
    await renderLadder(2800);
    expect(host.querySelector('.ladder__rank')!.textContent).toBe('世界卡牌师');
    expect(host.querySelector('.ladder__points strong')!.textContent).toBe('2800');
    expect(host.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('2400');
    expect(host.querySelector('[data-testid="crystal"]')!.getAttribute('data-color')).toBe(LADDER_TIERS.at(-1)!.color);
    expect(host.querySelectorAll('.ladder__rank-step')).toHaveLength(9);
    expect(host.querySelectorAll('.ladder__rank-step[data-current="true"]')).toHaveLength(1);
  });

  it('九档各有颜色与不同徽章，零分只可领取新手奖励且重渲染不重领', async () => {
    await renderLadder();
    const before = store.getSnapshot().profile!;
    const rows = [...host.querySelectorAll<HTMLElement>('.ladder__rank-step')];
    expect(rows).toHaveLength(9);
    expect(new Set(rows.map(row => row.querySelector('svg')!.innerHTML)).size).toBe(9);
    rows.forEach((row, index) => {
      expect(row.style.getPropertyValue('--step-color')).toBe(LADDER_TIERS[index]!.color);
      expect(row.querySelector('svg')!.getAttribute('data-tier-logo')).toBe(String(LADDER_TIERS[index]!.floor));
      expect(row.querySelector('.ladder__tier-reward')!.textContent).toContain('水晶');
    });
    const claim = rows[0]!.querySelector('button')!;
    expect(claim.disabled).toBe(false);
    expect(rows.slice(1).every(row => row.querySelector('button')!.disabled)).toBe(true);
    await act(async () => { claim.click(); claim.click(); });
    const after = store.getSnapshot().profile!;
    expect(after.ladder.claimedTierFloors).toEqual([0]);
    expect(after.currencies.crystal - before.currencies.crystal).toBe(100);
    expect(claim.disabled).toBe(true);
    expect(claim.textContent).toBe('已领取');
    expect(host.querySelector('[role="status"]')!.textContent).toContain('已领取：水晶 ×100');
    await act(async () => root.render(createElement(LadderScene, { profile: before, store, onNavigate: navigate })));
    expect(store.getSnapshot().profile).toBe(after);
    expect(host.querySelector('[data-floor="0"] button')!.textContent).toBe('已领取');
  });

  it('排行榜悬浮打开且不切路由，关闭回到天梯', async () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
    await renderLadder();
    await act(async () => byText('排行榜').click());
    expect(showModal).toHaveBeenCalled();
    expect(document.querySelector('dialog')!.textContent).toContain('本地演示');
    expect(navigate).not.toHaveBeenCalled();
    const close = document.querySelector<HTMLButtonElement>('dialog button[aria-label="关闭排行榜"]')!;
    await act(async () => close.click());
    expect(document.querySelector('dialog')).toBeNull();
    expect(host.querySelector('.ladder__rank')!.textContent).toBe('新手卡牌师');
  });

  it('对战菜单天梯紧接活动模式，活动大厅入口使用相同路由', async () => {
    const profile = await setup();
    await act(async () => root.render(createElement(BattleMenuScene, { profile, onNavigate: navigate })));
    const labels = [...host.querySelectorAll('.menu__entry-label')].map(el => el.textContent);
    expect(labels.indexOf('天梯赛')).toBe(labels.indexOf('活动模式') + 1);
    await act(async () => byText('天梯赛').click());
    expect(navigate).toHaveBeenLastCalledWith('ladder');
    await act(async () => root.render(createElement(ActivityScene, { profile, onNavigate: navigate })));
    await act(async () => byText('天梯赛').click());
    await act(async () => (host.querySelector('.activity-detail__enter') as HTMLButtonElement).click());
    expect(navigate).toHaveBeenLastCalledWith('ladder');
  });
});
