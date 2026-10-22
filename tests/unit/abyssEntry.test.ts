// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityScene } from '../../src/scenes/ActivityScene';
import { HubScene } from '../../src/scenes/HubScene';
import { AbyssCountdown } from '../../src/ui/AbyssCountdown';
import { PosterCarousel } from '../../src/ui/PosterCarousel';
import { menuPosterEntries, menuPosters } from '../../src/scenes/menuPosters';
import { assetManifest } from '../../src/data/assets';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { useSettingsStore } from '../../src/state/settingsStore';

vi.mock('../../src/ui/DesignStage', () => ({ DesignStage: ({ children, className }: { children: ReactNode; className?: string }) => createElement('div', { className }, children) }));
vi.mock('../../src/ui/HubLogoLayer', () => ({ HubLogoLayer: () => null }));
vi.mock('../../src/ui/HubWordmark', () => ({ HubWordmark: () => null }));
vi.mock('../../src/ui/HubSideRail', () => ({ HubSideRail: () => null }));
vi.mock('../../src/ui/PlayerStatus', () => ({ PlayerStatus: () => createElement('div', null, '玩家状态') }));

let host: HTMLDivElement, root: Root;
const profile = createInitialProfile({ contentVersion: 'test', dayKey: '20261011', starterCardIds: [], now: new Date('2026-10-11T12:00:00Z') });
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-11T19:59:59Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  useSettingsStore.setState({ reduceMotion: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const click = async (selector: string) => act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());

describe('深渊入口与结算展示', () => {
  it('轮盘NEW在名称后，选中显示倒计时但不进入，点进入才导航', async () => {
    const navigate = vi.fn();
    await act(async () => root.render(createElement(ActivityScene, { profile, onNavigate: navigate })));
    expect(host.querySelector('.abyss-countdown')).toBeNull();
    const option = host.querySelector('[data-wheel-id="abyss"]')!;
    expect(option.querySelector('.wheel__name')!.nextElementSibling!.textContent).toBe('NEW');
    expect(option.querySelector('.activity-wheel__soon')).toBeNull();
    await click('[data-wheel-id="abyss"]');
    expect(navigate).not.toHaveBeenCalled();
    expect(host.querySelector('.menu--activity-abyss')).not.toBeNull();
    expect(host.querySelector('.abyss-countdown')!.textContent).toContain('UTC+8 · 每周一04:00');
    expect(host.querySelector('.activity-detail__enter')!.textContent).toBe('进入');
    await click('.activity-detail__enter');
    expect(navigate).toHaveBeenCalledWith('abyss');
    await click('[data-wheel-id="coop"]');
    expect(host.querySelector('.abyss-countdown')).toBeNull();
    expect(host.querySelector('.activity-detail__enter')!.textContent).toBe('进入');
  });
  it('倒计时到点滚入下一周，后台暂停更新、回来按真实时间校准，卸载清定时器', async () => {
    await act(async () => root.render(createElement(AbyssCountdown)));
    expect(host.querySelector('time')!.textContent).toBe('0天 00:00:01');
    await act(async () => vi.advanceTimersByTime(1000));
    expect(host.querySelector('time')!.textContent).toBe('7天 00:00:00');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(new Date('2026-10-12T20:00:00Z'));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(host.querySelector('time')!.textContent).toBe('6天 00:00:00');
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
  });
  it('主页独立入口和第一张海报均进入深渊，旧玩法入口保留', async () => {
    const navigate = vi.fn();
    await act(async () => root.render(createElement(HubScene, { profile, onNavigate: navigate, onReset: vi.fn() })));
    expect(host.querySelector('.hub-abyss-entry')!.textContent).toContain('v3.0新模式');
    expect(host.querySelector('.hub-abyss-entry')!.getAttribute('data-still')).toBe('true');
    expect(host.querySelector('.hub-button--start')).not.toBeNull();
    expect(host.querySelector('.poster')!.getAttribute('aria-label')).toBe('海报：深渊降临');
    expect(host.querySelector('.poster__caption')!.textContent).toContain('NEW');
    await click('.hub-abyss-entry');
    expect(navigate).toHaveBeenLastCalledWith('abyss');
    await click('.poster');
    expect(navigate).toHaveBeenLastCalledWith('abyss');
  });
  it('海报资源缺失时图片和路由整条过滤，不按旧下标误跳转', () => {
    const original = assetManifest.shared.poster['poster001'];
    try {
      delete assetManifest.shared.poster['poster001'];
      const entries = menuPosterEntries();
      expect(entries[0]!.id).toBe('abyss');
      expect(entries.find(entry => entry.id === 'poster001')).toBeUndefined();
      expect(entries.find(entry => entry.id === 'chapter_1_enter')!.route).toBe('campaign');
      expect(entries.find(entry => entry.id === 'poster002')!.route).toBe('gacha');
      expect(menuPosters()).toEqual(entries.map(entry => entry.url));
    } finally { if (original) assetManifest.shared.poster['poster001'] = original; }
  });
  it('海报无文案的旧调用仍可键盘激活，标题不再硬编码战役', async () => {
    const select = vi.fn();
    await act(async () => root.render(createElement(PosterCarousel, { posters: ['sample.webp'], onSelect: select })));
    const poster = host.querySelector<HTMLElement>('.poster')!;
    expect(poster.title).toBe('点击进入活动');
    await act(async () => poster.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(select).toHaveBeenCalledWith(0);
    expect(host.querySelector('.poster__caption')).toBeNull();
  });
});
