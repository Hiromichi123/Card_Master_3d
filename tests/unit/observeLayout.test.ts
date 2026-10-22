// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { observeLayout } from '../../src/ui/observeLayout';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('stops polling idle DOM anchors and follows a real ancestor transition', () => {
  let now = 0, next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
  const parent = document.createElement('div'), anchor = document.createElement('span'), canvas = document.createElement('canvas');
  parent.append(anchor); document.body.append(parent, canvas);
  const measure = vi.fn(), stop = observeLayout(canvas, [anchor], measure);
  const advance = (time: number) => {
    now = time; const work = [...frames.values()]; frames.clear(); work.forEach(callback => callback(now));
  };
  advance(100); advance(1000);
  expect(frames.size).toBe(0); expect(measure).toHaveBeenCalledTimes(2);
  advance(2000); expect(measure).toHaveBeenCalledTimes(2);
  parent.dispatchEvent(new Event('transitionrun', { bubbles: true }));
  advance(2100); expect(frames.size).toBe(1);
  stop(); expect(frames.size).toBe(0); expect(disconnect).toHaveBeenCalledOnce();
  parent.remove(); canvas.remove();
});
