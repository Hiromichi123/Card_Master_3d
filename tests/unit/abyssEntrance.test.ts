// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AbyssEntrance } from '../../src/ui/AbyssEntrance';
import { ABYSS_BUTTON_ENTER_MS, ABYSS_BUTTON_STAGGER_MS, ABYSS_UI_FADE_MS } from '../../src/scenes/abyssPresentation';

let host: HTMLDivElement, root: Root;
const tick = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
const entries = () => [...host.querySelectorAll<HTMLElement>('.abyss-entrance')];
const locked = () => entries().map(node => node.hasAttribute('inert'));
const render = async (still = false, play = true) => {
  await act(async () => root.render(h('div', null, [0, 1, 2, 3].map(index => h(AbyssEntrance, {
    index, still, play, key: index, children: h('button', { disabled: index === 1 }, String(index)),
  })))));
};
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

describe('深渊按钮屏外依次浮入', () => {
  it('900ms入场、160ms错峰且逐个解锁，保留业务disabled', async () => {
    await render(); expect(locked()).toEqual([true, true, true, true]);
    expect(entries().map(node => node.style.getPropertyValue('--abyss-enter-delay'))).toEqual(['0ms', '160ms', '320ms', '480ms']);
    expect(entries().every(node => node.style.getPropertyValue('--abyss-enter-duration') === '900ms')).toBe(true);
    await tick(ABYSS_BUTTON_ENTER_MS - 1); expect(locked()).toEqual([true, true, true, true]);
    await tick(1); expect(locked()).toEqual([false, true, true, true]);
    await tick(ABYSS_BUTTON_STAGGER_MS); expect(locked()).toEqual([false, false, true, true]);
    await tick(ABYSS_BUTTON_STAGGER_MS); expect(locked()).toEqual([false, false, false, true]);
    await tick(ABYSS_BUTTON_STAGGER_MS); expect(locked()).toEqual([false, false, false, false]);
    expect([...host.querySelectorAll('button')].map(node => node.disabled)).toEqual([false, true, false, false]);
    await render(); expect(locked()).toEqual([false, false, false, false]); expect(vi.getTimerCount()).toBe(0);
  });
  it('抵达回调在包装层解锁时通知一次，重渲染不重复通知', async () => {
    const arrived = vi.fn();
    const props = { index: 3, still: false, play: true, onArrived: arrived, children: h('button', null, '历史') };
    await act(async () => root.render(h(AbyssEntrance, props)));
    await tick(1379); expect(arrived).not.toHaveBeenCalled();
    await tick(1); expect(arrived).toHaveBeenCalledExactlyOnceWith(3);
    await act(async () => root.render(h(AbyssEntrance, { ...props, onArrived: arrived })));
    expect(arrived).toHaveBeenCalledOnce();
  });
  it('屏外起点使用视口高度而非按钮自身高度，动画由包装层负责', () => {
    const css = readFileSync('src/ui/abyss.css', 'utf8');
    expect(css).toContain('transform: translateY(100vh); transform: translateY(100dvh)');
    expect(css).toContain('animation: abyss-button-rise var(--abyss-enter-duration)');
    expect(css).toContain('var(--abyss-enter-delay) both');
    expect(css).toContain('.abyss-scene[data-visible="false"] * { animation-play-state: paused !important; }');
    expect(css).not.toContain('animation-name: abyss-from-left');
    expect(css).not.toContain('animation-name: abyss-from-right');
  });
  it('后台等待不解锁，恢复走剩余时长', async () => {
    await render(); await tick(400); await visibility(true); await tick(20000);
    expect(locked()).toEqual([true, true, true, true]);
    await visibility(false); await tick(499); expect(locked()[0]).toBe(true);
    await tick(1); expect(locked()).toEqual([false, true, true, true]);
  });
  it('中途减弱动态去掉排队，短淡入后无残留inert', async () => {
    await render(); await tick(300); await render(true);
    expect(entries().map(node => node.style.getPropertyValue('--abyss-enter-delay'))).toEqual(['0ms', '0ms', '0ms', '0ms']);
    await tick(ABYSS_UI_FADE_MS); expect(locked()).toEqual([false, false, false, false]);
    await render(false); expect(locked()).toEqual([false, false, false, false]);
  });
  it('返回大厅新挂载时不重播，未结束卸载清计时', async () => {
    await render(false, false); expect(locked()).toEqual([false, false, false, false]); expect(vi.getTimerCount()).toBe(0);
    await act(async () => root.render(null)); await render(); expect(vi.getTimerCount()).toBe(4);
    await act(async () => root.render(null)); expect(vi.getTimerCount()).toBe(0);
  });
});
