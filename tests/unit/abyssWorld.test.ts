// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AbyssWorld } from '../../src/ui/AbyssWorld';
import { useParallax } from '../../src/ui/useParallax';
import { damp } from '../../src/rendering/anim/motion';
import { useSettingsStore } from '../../src/state/settingsStore';

vi.mock('../../src/rendering/abyss/AbyssVortex', () => ({ AbyssVortex: () => h('div', { className: 'mock-vortex' }) }));
let host: HTMLDivElement, root: Root;
let frames: Map<number, FrameRequestCallback>, serial: number;
const request = vi.fn((callback: FrameRequestCallback) => { const id = ++serial; frames.set(id, callback); return id; });
const cancel = vi.fn((id: number) => frames.delete(id));
const frame = (now: number) => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now)); };
const move = (x: number, y: number) => window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
const render = async (active = true, still = false) => {
  await act(async () => root.render(h(AbyssWorld, { backgroundUrl: '/abyss.webp', active, still, revealed: true, flash: { current: 0 } })));
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frames = new Map(); serial = 0; request.mockClear(); cancel.mockClear();
  vi.stubGlobal('requestAnimationFrame', request); vi.stubGlobal('cancelAnimationFrame', cancel);
  useSettingsStore.setState({ reduceMotion: false });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('深渊背景沿用普通鼠标阻尼', () => {
  it('底图和云雾同一平移容器，暗角留在容器外，扩边56px覆盖50px位移', async () => {
    await render();
    const moving = host.querySelector('.abyss-world__parallax')!;
    expect(moving.querySelector('.abyss-scene__background')).not.toBeNull();
    expect(moving.querySelector('.mock-vortex')).not.toBeNull();
    expect(moving.querySelector('.abyss-scene__vignette')).toBeNull();
    expect(moving.parentElement!.querySelector(':scope > .abyss-scene__vignette')).not.toBeNull();
    const css = readFileSync('src/ui/abyssHome.css', 'utf8');
    expect(css).toContain('inset: -56px');
    expect(css).toContain('translate3d(var(--parallax-x, 0px), var(--parallax-y, 0px), 0)');
  });
  it('复用50px目标和rate5阻尼，收敛后无持续rAF，系统偏好不参与', async () => {
    const systemMotion = vi.fn(() => ({ matches: true })); vi.stubGlobal('matchMedia', systemMotion);
    await render(); expect(frames.size).toBe(0);
    move(window.innerWidth, window.innerHeight); expect(frames.size).toBe(1);
    frame(16);
    const world = host.querySelector<HTMLElement>('.abyss-scene__world')!;
    expect(world.style.getPropertyValue('--parallax-x')).toBe(`${damp(0, 50, 5, 1 / 60).toFixed(2)}px`);
    expect(world.style.getPropertyValue('--parallax-y')).toBe(world.style.getPropertyValue('--parallax-x'));
    for (let step = 2; step < 600 && frames.size; step++) frame(step * 16);
    expect(world.style.getPropertyValue('--parallax-x')).toBe('50.00px');
    expect(frames.size).toBe(0); expect(systemMotion).not.toHaveBeenCalled();
  });
  it('后台/减少动态停用时撤掉监听和帧并复位，返回重新跟随', async () => {
    await render(); move(window.innerWidth, 0); frame(16); expect(frames.size).toBe(1);
    await render(false); expect(frames.size).toBe(0);
    const world = host.querySelector<HTMLElement>('.abyss-scene__world')!;
    expect(world.style.getPropertyValue('--parallax-x')).toBe('0px');
    move(0, 0); expect(frames.size).toBe(0);
    await render(); move(0, 0); expect(frames.size).toBe(1);
    await render(true, true); expect(frames.size).toBe(0);
    expect(world.style.getPropertyValue('--parallax-y')).toBe('0px');
    await render(); move(0, 0); await act(async () => root.render(null)); expect(frames.size).toBe(0);
  });
  it('通用hook原有无参调用继续可用，游戏手动减少动态会停止跟随', async () => {
    function Ordinary() { const ref = useParallax(); return h('div', { ref, className: 'ordinary' }); }
    await act(async () => root.render(h(Ordinary))); move(window.innerWidth, 0); expect(frames.size).toBe(1);
    await act(async () => useSettingsStore.setState({ reduceMotion: true })); expect(frames.size).toBe(0);
    expect(host.querySelector<HTMLElement>('.ordinary')!.style.getPropertyValue('--parallax-x')).toBe('0px');
  });
});
