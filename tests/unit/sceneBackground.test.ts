// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CrossfadeBackground, SceneBackgroundProvider } from '../../src/ui/SceneBackground';
import { useSettingsStore } from '../../src/state/settingsStore';

let root: Root | null = null;
const images: { src: string; onload: (() => void) | null; onerror: (() => void) | null }[] = [];
let host: HTMLDivElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null; images.length = 0;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('carries the lobby background into each directory, blends only images and supports nested back navigation', async () => {
  useSettingsStore.getState().setReduceMotion(false);
  vi.stubGlobal('Image', class {
    src = ''; onload: (() => void) | null = null; onerror: (() => void) | null = null;
    constructor() { images.push(this); }
  });
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => callbacks.delete(key));
  const frameAt = async (time: number): Promise<void> => {
    await act(async () => {
      const current = [...callbacks.values()]; callbacks.clear();
      for (const callback of current) callback(time);
    });
  };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const render = async (route: string, url: string): Promise<void> => {
    await act(async () => root!.render(createElement(SceneBackgroundProvider, null,
      createElement('section', { key: route }, createElement(CrossfadeBackground, { url }),
        createElement('h1', null, route)))));
  };
  const base = (): HTMLElement => host.querySelector('[data-background-layer="base"]')!;
  const incoming = (): HTMLElement | null => host.querySelector('[data-background-layer="incoming"]');
  const load = async (): Promise<void> => { await act(async () => images.at(-1)!.onload?.()); };

  await render('lobby', '/lobby.webp'); await load();
  expect(base().style.backgroundImage).toContain('lobby.webp');
  await render('world', '/world.webp');
  expect(host.querySelector('h1')!.textContent).toBe('world');
  expect(base().style.backgroundImage).toContain('lobby.webp');
  await load(); await frameAt(0); await frameAt(160);
  expect(base().style.backgroundImage).toContain('lobby.webp');
  expect(incoming()!.style.backgroundImage).toContain('world.webp');
  expect(Number(incoming()!.style.opacity)).toBeCloseTo(0.5);
  expect(host.querySelector('.fade')).toBeNull();
  await frameAt(320);
  expect(base().style.backgroundImage).toContain('world.webp'); expect(incoming()).toBeNull();

  // Same directory component, deeper chapter; changing the URL must also crossfade.
  await render('world', '/chapter.webp'); await load();
  await frameAt(400); await frameAt(560);
  expect(base().style.backgroundImage).toContain('world.webp');
  expect(Number(incoming()!.style.opacity)).toBeCloseTo(0.5);
  await frameAt(720);
  await render('world', '/world.webp'); await load();
  await frameAt(800); await frameAt(960);
  expect(base().style.backgroundImage).toContain('chapter.webp');
  expect(incoming()!.style.backgroundImage).toContain('world.webp');
  await frameAt(1120);
  expect(base().style.backgroundImage).toContain('world.webp');
});
