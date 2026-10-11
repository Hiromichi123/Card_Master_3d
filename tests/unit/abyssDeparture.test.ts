// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAbyssDeparture } from '../../src/ui/useAbyssDeparture';
import { ABYSS_DEPART_MS, ABYSS_DARKEN_MS } from '../../src/scenes/abyssPresentation';

let host: HTMLDivElement, root: Root;
let departure: ReturnType<typeof useAbyssDeparture>;
const switched = vi.fn();
function Harness({ still = false }: { still?: boolean }) {
  const [route, setRoute] = useState('activity');
  departure = useAbyssDeparture(still, () => { switched(); setRoute('abyss'); });
  return h('div', null,
    h('main', { inert: departure.busy, 'data-route': route, 'data-phase': departure.phase, style: departure.style },
      route === 'activity' ? h('div', { className: 'menu' },
        h('div', { className: 'menu__bg', style: { backgroundImage: 'url(original.webp)' } }),
        h('div', { className: 'menu__scrim' }),
        h('div', { className: 'menu__stage' }, h('button', { onClick: departure.start }, '进入')),
      ) : h('div', { 'data-pre-darkened': true }, '深渊')),
    departure.busy && h('div', { className: 'abyss-departure', 'data-phase': departure.phase }),
  );
}
const tick = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
const phase = () => host.querySelector('main')!.getAttribute('data-phase');
const render = async (still = false) => { await act(async () => root.render(h(Harness, { still }))); };
const start = async () => { await act(async () => departure.start()); };
const visibility = async (hidden: boolean) => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
};
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); switched.mockClear();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('仅深渊入口的源屏交接', () => {
  it('600ms前景退场及1800ms渐黑期间保留同一个原背景DOM，黑透才单次切屏', async () => {
    await render();
    const background = host.querySelector('.menu__bg');
    await act(async () => { departure.start(); departure.start(); });
    expect(phase()).toBe('departing'); expect(host.querySelector('main')!.hasAttribute('inert')).toBe(true);
    await tick(ABYSS_DEPART_MS - 1); expect(phase()).toBe('departing');
    await tick(1); expect(phase()).toBe('darkening');
    await start(); await tick(ABYSS_DARKEN_MS - 1);
    expect(host.querySelector('.menu__bg')).toBe(background);
    expect((background as HTMLElement).style.backgroundImage).toContain('original.webp');
    expect(switched).not.toHaveBeenCalled();
    await tick(1); expect(phase()).toBe('handoff'); expect(switched).not.toHaveBeenCalled();
    await tick(32); expect(switched).toHaveBeenCalledTimes(1);
    expect(host.querySelector('main')!.getAttribute('data-route')).toBe('abyss');
    expect(host.querySelector('.menu__bg')).toBeNull(); expect(host.querySelector('.abyss-departure')).toBeNull();
    expect(host.querySelector('[data-pre-darkened="true"]')).not.toBeNull();
  });
  it('Esc取消保留源屏、解除inert并还焦点；取消后可再进，卸载清时钟', async () => {
    await render(); const entry = host.querySelector('button')!; entry.focus();
    await start(); await tick(ABYSS_DEPART_MS); await tick(500);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
    expect(phase()).toBe('idle'); expect(document.activeElement).toBe(entry);
    expect(host.querySelector('main')!.hasAttribute('inert')).toBe(false);
    await tick(10000); expect(switched).not.toHaveBeenCalled();
    await start(); expect(phase()).toBe('departing');
    await act(async () => root.render(null)); expect(vi.getTimerCount()).toBe(0);
  });
  it('后台暂停并继续剩余时间，不把整段渐黑跳过', async () => {
    await render(); await start(); await tick(200); await visibility(true); await tick(20000);
    expect(phase()).toBe('departing');
    expect((host.querySelector('main') as HTMLElement).style.getPropertyValue('--abyss-play-state')).toBe('paused');
    await visibility(false); await tick(399); expect(phase()).toBe('departing');
    await tick(1); expect(phase()).toBe('darkening');
    await tick(800); await visibility(true); await tick(20000); expect(phase()).toBe('darkening');
    await visibility(false); await tick(999); expect(phase()).toBe('darkening');
    await tick(1); expect(phase()).toBe('handoff'); await tick(32); expect(switched).toHaveBeenCalledTimes(1);
  });
  it('系统减少动态不影响完整退场，也不读取系统偏好', async () => {
    const media = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal('matchMedia', media);
    await render(); await start(); await tick(120); expect(phase()).toBe('departing');
    await tick(ABYSS_DEPART_MS - 120); expect(phase()).toBe('darkening');
    expect((host.querySelector('main') as HTMLElement).style.getPropertyValue('--abyss-darken-ms')).toBe('1800ms');
    await tick(ABYSS_DARKEN_MS); await tick(32); expect(switched).toHaveBeenCalledTimes(1);
    expect(media).not.toHaveBeenCalled();
  });
  it('游戏手动减少动态仍走短淡黑', async () => {
    await render(true); await start(); await tick(1);
    expect(phase()).toBe('darkening');
    expect((host.querySelector('main') as HTMLElement).style.getPropertyValue('--abyss-darken-ms')).toBe('120ms');
    await tick(120); expect(phase()).toBe('handoff'); await tick(32);
    expect(switched).toHaveBeenCalledTimes(1);
  });
});
