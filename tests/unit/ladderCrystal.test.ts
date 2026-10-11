// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LadderCrystal } from '../../src/rendering/ladder/LadderCrystal';

const canvas = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock('@react-three/fiber', () => ({
  Canvas: (props: { children: ReactNode }) => { canvas.props = props; return props.children; },
  useFrame: vi.fn(),
}));
vi.mock('../../src/scenes/WebGLGuard', () => ({ WebGLGuard: ({ children }: { children: ReactNode }) => children }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('天梯晶体材质契约', () => {
  it('金球与透明壳同组、壳体低透明度，减弱动态使用按需帧', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    // 这里只验证R3F声明树；不启动WebGL，不把DOM材质声明当作视觉渲染验证。
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(LadderCrystal, { color: '#aabbcc', still: true, world: false })));
      expect(canvas.props.frameloop).toBe('demand');
      expect(canvas.props.dpr).toEqual([1, 1.5]);
      const shell = host.querySelector('[name="transparent-shell"]')!;
      const core = host.querySelector('[name="golden-core"]')!;
      expect(shell.parentElement).toBe(core.parentElement);
      expect(shell.querySelector('meshphysicalmaterial')!.getAttribute('opacity')).toBe('0.3');
      expect(core.querySelector('meshstandardmaterial')!.getAttribute('emissive')).toBe('#ffbd32');
      expect(host.querySelector('[name="golden-halo"]')).not.toBeNull();
      await act(async () => root.render(createElement(LadderCrystal, { color: '#aabbcc', still: false, world: true })));
      expect(canvas.props.frameloop).toBe('always');
    } finally { await act(async () => root.unmount()); }
  });
});
