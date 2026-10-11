// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbyssScene } from '../../src/scenes/AbyssScene';
import { useSettingsStore } from '../../src/state/settingsStore';
import { ProfileStore } from '../../src/state/createProfileStore';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import { cardDatabase } from '../../src/data';
import { fixedClock } from '../../src/domain/progression/clock';
import { ABYSS_LOAD_TIMEOUT_MS, ABYSS_LIGHTNING_INTERVAL_MS, abyssFlashIntensity,
  ABYSS_DARKEN_MS, ABYSS_BLACK_MS, ABYSS_REVEAL_MS, ABYSS_REVEAL_FLASH_DELAY_MS,
} from '../../src/scenes/abyssPresentation';

const vortex = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock('../../src/rendering/abyss/AbyssVortex', () => ({ AbyssVortex: (props: Record<string, unknown>) => { vortex.props = props; return null; } }));
vi.mock('../../src/ui/AbyssCountdown', () => ({ AbyssCountdown: () => createElement('div', null, '结算倒计时') }));
vi.mock('../../src/scenes/AbyssBattleScene', () => ({ AbyssBattleScene: () => null }));
vi.mock('../../src/scenes/AbyssPreparationScene', () => ({ AbyssPreparationScene: ({ onHome }: { onHome: () => void }) =>
  createElement('div', { className: 'abyss-preparation' }, createElement('button', { onClick: onHome }, '返回深渊大厅')) }));
vi.mock('../../src/ui/CardTipHost', () => ({ CardTipHost: () => null }));
vi.mock('../../src/ui/ToastHost', () => ({ ToastHost: () => null }));
class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 768;
  complete = false;
  src = '';
  decode = vi.fn(async () => {});
  constructor() { FakeImage.instances.push(this); }
}
let host: HTMLDivElement, root: Root;
const navigate = vi.fn();
const phase = () => host.querySelector('.abyss-scene')?.getAttribute('data-phase');
const image = () => FakeImage.instances.at(-1)!;
const tick = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
async function render(preDarkened = false) { await act(async () => root.render(createElement(AbyssScene, { onNavigate: navigate, preDarkened }))); }
async function reveal() {
  await act(async () => image().onload?.());
  await tick(ABYSS_DARKEN_MS); await tick(ABYSS_BLACK_MS);
  await tick(ABYSS_REVEAL_FLASH_DELAY_MS); await tick(ABYSS_REVEAL_MS - ABYSS_REVEAL_FLASH_DELAY_MS);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  FakeImage.instances = []; navigate.mockClear();
  useSettingsStore.setState({ reduceMotion: false });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('深渊入场', () => {
  it('旧UI消失，先渐黑并保持黑屏，decode成功才能揭示，HUD最后出现', async () => {
    await render(); expect(phase()).toBe('darkening');
    expect(host.querySelector('nav')).toBeNull();
    await tick(ABYSS_DARKEN_MS); expect(phase()).toBe('black');
    await tick(ABYSS_BLACK_MS); expect(phase()).toBe('black');
    let finish!: () => void;
    image().decode.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    await act(async () => image().onload?.());
    expect(phase()).toBe('black');
    await act(async () => finish()); expect(phase()).toBe('reveal');
    expect(host.querySelector('.abyss-scene__world')!.getAttribute('data-visible')).toBe('true');
    expect(host.querySelector('nav')).toBeNull();
    await tick(ABYSS_REVEAL_MS); expect(phase()).toBe('active');
    expect(host.querySelector('.abyss-scene__hud')).toBeNull();
    await tick(999); expect(host.querySelector('.abyss-scene__hud')).toBeNull();
    await tick(1);
    expect(host.textContent).toContain('结算倒计时');
    expect([...host.querySelectorAll('button')].map(button => button.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('新的开始'), expect.stringContaining('继续进度'), expect.stringContaining('已知特性'), expect.stringContaining('游玩历史'),
    ]));
    expect([...host.querySelectorAll('button')].find(button => button.textContent?.includes('继续进度'))?.disabled).toBe(true);
    expect(host.querySelector('img')!.src).toContain('activity_abyss_bg2.webp');
    const entrants = [...host.querySelectorAll<HTMLElement>('.abyss-entrance')];
    expect(entrants).toHaveLength(4);
    expect(entrants.every(node => node.hasAttribute('inert'))).toBe(true);
    expect(entrants.map(node => node.style.getPropertyValue('--abyss-enter-delay'))).toEqual(['0ms', '160ms', '320ms', '480ms']);
    await tick(900); expect(entrants.map(node => node.hasAttribute('inert'))).toEqual([false, true, true, true]);
    await tick(480); expect(entrants.every(node => !node.hasAttribute('inert'))).toBe(true);
    await render(); expect(entrants.every(node => !node.hasAttribute('inert'))).toBe(true);
  });
  it('选组页返回大厅不重播四按钮的首次屏外序列', async () => {
    const store = new ProfileStore({ repository: new MemorySaveRepository(), clock: fixedClock(new Date('2026-10-11')),
      contentVersion: cardDatabase.contentVersion, starterCardIds: [], seedSource: () => 5 });
    await store.load();
    await act(async () => root.render(createElement(AbyssScene, { onNavigate: navigate, store })));
    await reveal(); await tick(1000); await tick(1380);
    const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes(label))!;
    await act(async () => button('新的开始').click());
    expect(host.querySelector('.abyss-preparation')).not.toBeNull();
    expect(host.querySelector('.abyss-scene__world')).toBeNull();
    expect(host.querySelector('.abyss-entrance')).toBeNull();
    await act(async () => button('返回深渊大厅').click());
    const entrants = [...host.querySelectorAll<HTMLElement>('.abyss-entrance')];
    expect(entrants).toHaveLength(4); expect(entrants.every(node => node.dataset.arrived === 'true' && !node.hasAttribute('inert'))).toBe(true);
    await act(async () => root.render(null)); store.dispose();
  });
  it('预黑交接不再重画旧背景或重复渐黑，揭示闪电延后到650ms', async () => {
    await render(true);
    expect(phase()).toBe('black'); expect(host.querySelector('.abyss-scene__previous')).toBeNull();
    await act(async () => image().onload?.());
    await tick(ABYSS_BLACK_MS - 1); expect(phase()).toBe('black');
    await tick(1); expect(phase()).toBe('reveal');
    const flash = vortex.props.flash as { current: number };
    await tick(ABYSS_REVEAL_FLASH_DELAY_MS - 1); expect(flash.current).toBe(0);
    await tick(1); await tick(64); expect(flash.current).toBeGreaterThan(0);
    expect(phase()).toBe('reveal');
    expect((host.querySelector('.abyss-scene') as HTMLElement).style.getPropertyValue('--abyss-reveal-ms')).toBe('1600ms');
  });
  it('后台暂停黑屏、揭示与HUD延迟，回来只走剩余时间', async () => {
    const visibility = async (hidden: boolean) => {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    };
    await render(true); await act(async () => image().onload?.());
    await tick(200); await visibility(true); await tick(5000); expect(phase()).toBe('black');
    expect(host.querySelector('.abyss-scene')?.getAttribute('data-visible')).toBe('false');
    await visibility(false); await tick(399); expect(phase()).toBe('black');
    await tick(1); expect(phase()).toBe('reveal');
    await tick(400); await visibility(true); await tick(5000); expect(phase()).toBe('reveal');
    await visibility(false); await tick(1199); expect(phase()).toBe('reveal');
    await tick(1); expect(phase()).toBe('active');
    await tick(300); await visibility(true); await tick(5000);
    expect(host.querySelector('.abyss-scene__hud')).toBeNull();
    await visibility(false); await tick(699); expect(host.querySelector('.abyss-scene__hud')).toBeNull();
    await tick(1); expect(host.querySelector('.abyss-scene__hud')).not.toBeNull();
  });
  it('超时可重试，过期decode不覆盖新请求，Esc可在黑屏退出', async () => {
    await render();
    let finish!: () => void;
    image().decode.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    await act(async () => image().onload?.());
    await tick(ABYSS_LOAD_TIMEOUT_MS); expect(phase()).toBe('error');
    await act(async () => (host.querySelector('.abyss-scene__error button') as HTMLButtonElement).click());
    expect(phase()).toBe('black');
    await act(async () => finish()); expect(phase()).toBe('black');
    await act(async () => image().onload?.()); await tick(ABYSS_BLACK_MS); expect(phase()).toBe('reveal');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(navigate).toHaveBeenCalledWith('activity');
  });
  it('图片失败立即可返回，卸载清理所有倒计时', async () => {
    await render(); await act(async () => image().onerror?.());
    expect(phase()).toBe('error'); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
    await act(async () => buttons.find(button => button.textContent === '返回活动')!.click());
    expect(navigate).toHaveBeenCalledWith('activity');
    await act(async () => root.render(null)); expect(vi.getTimerCount()).toBe(0);
  });
  it('每15秒一轮同源闪电，后台恢复不补闪，减弱动态停闪停转', async () => {
    await render(); await reveal(); expect(phase()).toBe('active');
    const flash = vortex.props.flash as { current: number };
    expect(flash.current).toBe(0);
    await tick(ABYSS_LIGHTNING_INTERVAL_MS - 1); expect(flash.current).toBe(0);
    await tick(65); expect(flash.current).toBeGreaterThan(0);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(flash.current).toBe(0); expect(vortex.props.active).toBe(false);
    await tick(60000);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await tick(100); expect(flash.current).toBe(0);
    await act(async () => useSettingsStore.setState({ reduceMotion: true }));
    expect(vortex.props.still).toBe(true);
    await tick(30000); expect(flash.current).toBe(0);
  });
  it('系统偏好reduce也播放云雾和错峰浮入，不读取matchMedia', async () => {
    const media = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal('matchMedia', media);
    await render(); await tick(120); expect(phase()).toBe('darkening');
    await act(async () => image().onload?.());
    await tick(ABYSS_DARKEN_MS - 120); await tick(ABYSS_BLACK_MS);
    await tick(ABYSS_REVEAL_FLASH_DELAY_MS); await tick(ABYSS_REVEAL_MS - ABYSS_REVEAL_FLASH_DELAY_MS);
    expect(phase()).toBe('active'); expect(vortex.props.still).toBe(false); expect(vortex.props.active).toBe(true);
    expect(host.querySelector('.abyss-scene')?.getAttribute('data-still')).toBe('false');
    await tick(1000);
    const entries = [...host.querySelectorAll<HTMLElement>('.abyss-entrance')];
    expect(entries.map(node => node.style.getPropertyValue('--abyss-enter-delay'))).toEqual(['0ms', '160ms', '320ms', '480ms']);
    expect(entries.every(node => node.style.getPropertyValue('--abyss-enter-duration') === '900ms')).toBe(true);
    expect(media).not.toHaveBeenCalled();
    await act(async () => useSettingsStore.setState({ reduceMotion: true }));
    expect(vortex.props.still).toBe(true);
    await act(async () => useSettingsStore.setState({ reduceMotion: false }));
    expect(vortex.props.still).toBe(false);
    expect(media).not.toHaveBeenCalled();
  });
  it('减弱动态走短淡入，不闪电；光强只有一个峰值并归零', async () => {
    useSettingsStore.setState({ reduceMotion: true }); await render();
    await act(async () => image().onload?.()); await tick(120); await tick(1); await tick(180);
    expect(phase()).toBe('active'); expect(vortex.props.still).toBe(true);
    expect(abyssFlashIntensity(-1)).toBe(0); expect(abyssFlashIntensity(0)).toBe(0);
    expect(abyssFlashIntensity(45)).toBeGreaterThan(abyssFlashIntensity(200));
    expect(abyssFlashIntensity(200)).toBeGreaterThan(abyssFlashIntensity(400));
    expect(abyssFlashIntensity(700)).toBe(0);
  });
});
