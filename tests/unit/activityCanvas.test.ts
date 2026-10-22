// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ActivityCanvas } from '../../src/rendering/ActivityCanvas';

const canvas = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock('@react-three/fiber', () => ({ Canvas: (props: Record<string, unknown>) => { canvas.props = props; return null; } }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('retains the paced loop on unrelated parent updates and keeps hidden canvases stopped', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const host = document.createElement('div'), root = createRoot(host);
  const render = (label: string) => act(async () => root.render(createElement(ActivityCanvas, { activityFps: 30, 'aria-label': label })));
  await render('first'); expect(canvas.props.frameloop).toBe('demand');
  await render('updated'); expect(canvas.props.frameloop).toBe('demand');
  hidden = true; act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(canvas.props.frameloop).toBe('never');
  await render('background update'); expect(canvas.props.frameloop).toBe('never');
  hidden = false; act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(canvas.props.frameloop).toBe('demand');
  await act(async () => root.unmount());
});
