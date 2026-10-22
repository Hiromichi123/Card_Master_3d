// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RenderActivity } from '../../src/rendering/RenderActivity';

const fixture = vi.hoisted(() => ({ state: null as unknown, hook: () => ({}) }));
vi.mock('@react-three/fiber', () => ({ useThree: () => fixture.hook() }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('suspends a hidden canvas, retains animation time, resumes and clears its ambient timer', async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let hidden = false, seen!: (entries: { isIntersecting: boolean }[]) => void;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof seen) { seen = callback; }
    observe() {} disconnect = disconnect;
  });
  const state = { frameloop: 'always', clock: { elapsedTime: 17 } };
  const invalidate = vi.fn(), setFrameloop = vi.fn((mode: string) => { state.frameloop = mode; state.clock.elapsedTime = 0; });
  const gl = { domElement: document.createElement('canvas') }, get = () => state;
  fixture.hook = () => ({ gl, get, invalidate, setFrameloop });
  const host = document.createElement('div'), root = createRoot(host);
  await act(async () => root.render(createElement(RenderActivity, { fps: 30 })));
  expect(state.frameloop).toBe('demand'); expect(state.clock.elapsedTime).toBe(17);
  act(() => { vi.advanceTimersByTime(100); }); expect(invalidate.mock.calls.length).toBeGreaterThan(2);
  hidden = true;
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  const count = invalidate.mock.calls.length;
  act(() => { vi.advanceTimersByTime(200); }); expect(invalidate).toHaveBeenCalledTimes(count);
  expect(state.frameloop).toBe('never'); expect(state.clock.elapsedTime).toBe(17);
  hidden = false;
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(state.frameloop).toBe('demand'); expect(state.clock.elapsedTime).toBe(17);
  act(() => seen([{ isIntersecting: false }])); expect(state.frameloop).toBe('never');
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0); expect(disconnect).toHaveBeenCalledOnce();
});
