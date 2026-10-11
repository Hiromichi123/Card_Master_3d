// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AbyssHome, useAbyssHomePresentation } from '../../src/ui/AbyssHome';
import { ABYSS_HOME_SETTLE_WAIT_MS, ABYSS_HOME_SHIFT_MS } from '../../src/scenes/abyssPresentation';

vi.mock('../../src/ui/AbyssCountdown', () => ({ AbyssCountdown: () => h('div', null, '倒计时') }));
let host: HTMLDivElement, root: Root;
const noop = () => {};
function Harness({ still = false, shown = true }: { still?: boolean; shown?: boolean }) {
  const presentation = useAbyssHomePresentation(still, shown);
  return shown ? h(AbyssHome, { presentation, still, busy: false, available: true, run: null,
    onStart: noop, onContinue: noop, onTraits: noop, onHistory: noop }) : null;
}
const render = async (still = false, shown = true) => { await act(async () => root.render(h(Harness, { still, shown }))); };
const tick = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
const layout = () => host.querySelector<HTMLElement>('.abyss-home-stage')?.dataset.layout;
const visibility = async (hidden: boolean) => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
};
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('深渊大厅落稳后的第二阶段', () => {
  it('第四按钮1380ms抵达，另外等1000ms才开始同步移位', async () => {
    await render(); expect(layout()).toBe('waiting');
    await tick(1379); expect(host.querySelectorAll('.abyss-entrance[inert]')).toHaveLength(1);
    await tick(1); expect(host.querySelectorAll('.abyss-entrance[inert]')).toHaveLength(0);
    await tick(ABYSS_HOME_SETTLE_WAIT_MS - 1); expect(layout()).toBe('waiting');
    await tick(1); expect(layout()).toBe('moving');
    await tick(ABYSS_HOME_SHIFT_MS - 1); expect(layout()).toBe('moving');
    await tick(1); expect(layout()).toBe('settled');
  });
  it('后台不消耗等待和移位时长，回前台只走剩余时间', async () => {
    await render(); await tick(1380); await tick(400);
    await visibility(true); await tick(60000); expect(layout()).toBe('waiting');
    await visibility(false); await tick(599); expect(layout()).toBe('waiting');
    await tick(1); expect(layout()).toBe('moving');
    await tick(250); await visibility(true); await tick(60000); expect(layout()).toBe('moving');
    await visibility(false); await tick(749); expect(layout()).toBe('moving');
    await tick(1); expect(layout()).toBe('settled');
  });
  it('离开后回大厅采用最终布局，不重播按钮或遗留半程状态', async () => {
    await render(); await tick(900); await render(false, false);
    await tick(10000); await render(); expect(layout()).toBe('settled');
    expect(host.querySelectorAll('.abyss-entrance[inert]')).toHaveLength(0);
    await tick(5000); expect(layout()).toBe('settled');
  });
  it('游戏减少动态保留最终布局，中途切换不留下半程动画', async () => {
    await render(true); await tick(180); await tick(1000); expect(layout()).toBe('settled');
    await act(async () => root.render(null)); await render(); await tick(1380); await tick(1000);
    expect(layout()).toBe('moving'); await render(true); expect(layout()).toBe('settled');
    await render(false); expect(layout()).toBe('settled');
  });
  it('标题独立上移和深红光晕；倒计时左靠安全区，窄屏避免占同一行', () => {
    const css = readFileSync(new URL('../../src/ui/abyssHome.css', import.meta.url), 'utf8');
    expect(css).toContain('@keyframes abyss-home-title-shift');
    expect(css).toContain('@keyframes abyss-home-countdown-shift');
    expect(css).toContain('color: #8f1427');
    expect(css).toContain('0 0 28px #b51d4bad');
    expect(css).toContain('left: var(--abyss-home-left-edge)');
    expect(css).toContain('calc(var(--abyss-home-top-edge) + 64px)');
    expect(css).not.toContain('prefers-reduced-motion');
  });
});
