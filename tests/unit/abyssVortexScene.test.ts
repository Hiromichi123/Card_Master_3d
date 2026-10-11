// @vitest-environment jsdom
import { act, createElement, StrictMode, type ReactElement, type ReactNode } from 'react';
import { BufferGeometry, ShaderMaterial, Texture, TextureLoader } from 'three';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ABYSS_LOAD_TIMEOUT_MS } from '../../src/scenes/abyssPresentation';
import { AbyssVortex } from '../../src/rendering/abyss/AbyssVortex';
import { ABYSS_SPARKS } from '../../src/rendering/abyss/abyssSparks';
import { useSettingsStore } from '../../src/state/settingsStore';

const capture = vi.hoisted(() => ({
  props: {} as Record<string, unknown>, renderSmoke: false, three: {} as Record<string, unknown>,
  frame: null as ((state: unknown, delta: number) => void) | null,
  materials: [] as { uniforms: Record<string, { value: unknown }> }[],
}));
vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  return { ...actual, ShaderMaterial: class extends actual.ShaderMaterial {
    constructor(parameters?: ConstructorParameters<typeof actual.ShaderMaterial>[0]) {
      super(parameters); capture.materials.push(this);
    }
  } };
});
vi.mock('@react-three/fiber', () => ({
  Canvas: (props: Record<string, unknown>) => {
    capture.props = props;
    return createElement('div', { 'data-mock-canvas': true }, capture.renderSmoke ? props.children as ReactNode : null);
  },
  useFrame: (callback: (state: unknown, delta: number) => void) => { capture.frame = callback; },
  useThree: () => capture.three,
}));
function smokeCallbacks() {
  return (capture.props.children as ReactElement<{ onReady: () => void; onUnavailable: () => void }>).props;
}
beforeEach(() => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  capture.materials = []; capture.frame = null;
});
afterEach(() => { capture.renderSmoke = false; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('深渊云雾装饰声明', () => {
  it('动态仅前台运行，系统偏好不参与，still/非active使用按需帧，预算读取设置', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const systemMotion = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal('matchMedia', systemMotion);
    const loseContext = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension: () => ({ loseContext }),
    } as unknown as WebGL2RenderingContext);
    const previous = useSettingsStore.getState();
    useSettingsStore.setState({ dprCap: 1.2, particleBudget: 'high' });
    const flash = { current: 0.6 };
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(AbyssVortex, { backgroundUrl: '/abyss.webp', still: false, active: true, flash })));
      expect(capture.props.frameloop).toBe('always');
      expect(host.querySelector('.abyss-vortex')!.getAttribute('data-motion')).toBe('running');
      expect(capture.props.dpr).toEqual([1, 1.2]);
      expect(host.querySelector('.abyss-vortex')!.getAttribute('data-smoke-count')).toBe('48');
      expect(loseContext).toHaveBeenCalledOnce();
      expect(host.querySelector('.abyss-vortex')!.getAttribute('data-vortex-status')).toBe('loading');
      expect(host.querySelectorAll('.abyss-vortex__cloud')).toHaveLength(4);
      await act(async () => root.render(createElement(AbyssVortex, { backgroundUrl: '/abyss.webp', still: true, active: true, flash })));
      expect(capture.props.frameloop).toBe('demand');
      expect(host.querySelector('.abyss-vortex')!.getAttribute('data-still')).toBe('true');
      expect(host.querySelector('.abyss-vortex')!.getAttribute('data-motion')).toBe('still');
      await act(async () => root.render(createElement(AbyssVortex, { backgroundUrl: '/abyss.webp', still: false, active: false, flash })));
      expect(capture.props.frameloop).toBe('demand');
      expect(host.querySelector('.abyss-vortex')!.getAttribute('data-motion')).toBe('hidden');
      expect(host.querySelectorAll('.abyss-vortex__spark')).toHaveLength(36);
      expect(systemMotion).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      useSettingsStore.setState({ dprCap: previous.dprCap, particleBudget: previous.particleBudget });
    }
  });

  it('ready只减弱基础层且保持四层运动，后续失败恢复强度并撤Canvas', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension: () => ({ loseContext: vi.fn() }),
    } as unknown as WebGL2RenderingContext);
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(AbyssVortex, { backgroundUrl: '/abyss.webp', still: false, active: true, flash: { current: 0 } })));
      const callbacks = smokeCallbacks();
      await act(async () => callbacks.onReady());
      expect(host.querySelector('.abyss-vortex')!.getAttribute('data-vortex-status')).toBe('ready');
      const base = host.querySelector('.abyss-vortex__base')!;
      const sparks = [...base.querySelectorAll<SVGGElement>('.abyss-vortex__spark')];
      expect(sparks).toHaveLength(36);
      expect(base.querySelectorAll('.abyss-vortex__spark path')).toHaveLength(72);
      expect(base.querySelector('.abyss-vortex__fallback-ring > .abyss-vortex__sparks')).not.toBeNull();
      expect(base.querySelector('.abyss-vortex__sparks')!.getAttribute('aria-hidden')).toBe('true');
      for (const [index, node] of sparks.entries()) {
        expect(node.style.getPropertyValue('--spark-period')).toBe(`${ABYSS_SPARKS[index]!.periodMs}ms`);
        expect(node.style.getPropertyValue('--spark-delay')).toBe(`${ABYSS_SPARKS[index]!.delayMs}ms`);
        const paths = node.querySelectorAll('path');
        expect(paths[0]!.getAttribute('d')).toBe(ABYSS_SPARKS[index]!.path);
        expect(paths[1]!.getAttribute('d')).toBe(ABYSS_SPARKS[index]!.path);
      }
      expect(base.getAttribute('data-softened')).toBe('true');
      await act(async () => vi.advanceTimersByTime(30000));
      expect(host.querySelector('.abyss-vortex__base')).toBe(base);
      expect(host.querySelectorAll('.abyss-vortex__cloud')).toHaveLength(4);
      expect(host.querySelector('.abyss-vortex')!.getAttribute('data-motion')).toBe('running');
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => callbacks.onUnavailable());
      expect(base.getAttribute('data-softened')).toBe('false');
      expect([...base.querySelectorAll('.abyss-vortex__spark')]).toEqual(sparks);
      expect(host.querySelector('.abyss-vortex')!.getAttribute('data-vortex-status')).toBe('fallback');
      expect(host.querySelectorAll('.abyss-vortex__cloud')).toHaveLength(4);
      expect(host.querySelector('[data-mock-canvas]')).toBeNull();
      await act(async () => callbacks.onReady());
      expect(host.querySelector('.abyss-vortex')!.getAttribute('data-vortex-status')).toBe('fallback');
    } finally { await act(async () => root.unmount()); }
  });

  it('加载中卸载取消前台超时，基础云层ResizeObserver断开', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() { disconnect(); } });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension: () => ({ loseContext: vi.fn() }),
    } as unknown as WebGL2RenderingContext);
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(AbyssVortex, { backgroundUrl: '/abyss.webp', still: false, active: true, flash: { current: 0 } })));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('加载超时只计前台时间，显式停用不误报，超时后基础云层保留', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension: () => ({ loseContext: vi.fn() }),
    } as unknown as WebGL2RenderingContext);
    const host = document.createElement('div'), root = createRoot(host);
    const render = async (active: boolean) => act(async () => root.render(createElement(AbyssVortex, {
      backgroundUrl: '/abyss.webp', still: false, active, flash: { current: 0 },
    })));
    const tick = async (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
    const status = () => host.querySelector('.abyss-vortex')!.getAttribute('data-vortex-status');
    try {
      await render(false); await tick(ABYSS_LOAD_TIMEOUT_MS * 2); expect(status()).toBe('loading');
      await render(true); await tick(4000);
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      await render(false); // 场景也会把document.hidden反映为active=false，不能重置剩余时长。
      expect(host.querySelector('.abyss-vortex')!.getAttribute('data-motion')).toBe('hidden');
      await tick(ABYSS_LOAD_TIMEOUT_MS * 2); expect(status()).toBe('loading');
      await render(true);
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      await tick(ABYSS_LOAD_TIMEOUT_MS - 4001); expect(status()).toBe('loading');
      await tick(1); expect(status()).toBe('fallback');
      expect(host.querySelectorAll('.abyss-vortex__cloud')).toHaveLength(4);
      expect(host.querySelector('.abyss-vortex__base')!.getAttribute('data-softened')).toBe('false');
      expect(host.querySelector('[data-mock-canvas]')).toBeNull();
    } finally { await act(async () => root.unmount()); }
  });

  it('实际useFrame推进GPU uniform，静止/后台冻结，恢复仅累加新帧', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension: () => ({ loseContext: vi.fn() }),
    } as unknown as WebGL2RenderingContext);
    capture.three = { gl: { domElement: document.createElement('canvas'), debug: { onShaderError: null } },
      size: { width: 1280, height: 720 }, invalidate: vi.fn() };
    capture.renderSmoke = true;
    let loaded!: () => void;
    vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
      const image = document.createElement('img'); image.width = 768; image.height = 457;
      const texture = new Texture(image); loaded = () => onLoad?.(texture); return texture;
    });
    const host = document.createElement('div'), root = createRoot(host), flash = { current: 0.6 };
    const render = async (still = false, active = true) => act(async () => root.render(createElement(AbyssVortex, {
      backgroundUrl: '/abyss.webp', still, active, flash,
    })));
    try {
      await render(); await act(async () => loaded());
      const uniforms = capture.materials.at(-1)!.uniforms;
      const frame = (delta: number) => capture.frame!({}, delta);
      frame(0.016); frame(0.02); frame(0.014);
      expect(uniforms.uTime!.value).toBeCloseTo(0.05);
      expect(uniforms.uFlash!.value).toBe(0.6);
      await render(true); frame(1);
      expect(uniforms.uTime!.value).toBeCloseTo(0.05); expect(uniforms.uFlash!.value).toBe(0);
      await render(false, false); frame(1);
      expect(uniforms.uTime!.value).toBeCloseTo(0.05);
      await render();
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      frame(10); expect(uniforms.uTime!.value).toBeCloseTo(0.05);
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      frame(0.02); expect(uniforms.uTime!.value).toBeCloseTo(0.07);
      frame(10); expect(uniforms.uTime!.value).toBeCloseTo(0.12);
      expect(capture.materials).toHaveLength(1);
      expect(host.querySelectorAll('.abyss-vortex__cloud')).toHaveLength(4);
    } finally { await act(async () => root.unmount()); }
  });

  it.each(['texture', 'shader', 'context'] as const)('%s失败确实从Smoke传播，StrictMode资源逐个释放且迟到load无效', async failure => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    // 在DOM中挂mock mesh仅为effect生命周期断言，不声明验证了WebGL画面。
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension: () => ({ loseContext: vi.fn() }),
    } as unknown as WebGL2RenderingContext);
    const canvas = document.createElement('canvas');
    const previousShaderError = vi.fn();
    const debug = { onShaderError: previousShaderError as (() => void) | null };
    capture.three = { gl: { domElement: canvas, debug }, size: { width: 1280, height: 720 }, invalidate: vi.fn() };
    capture.renderSmoke = true;
    const loads: { texture: Texture<HTMLImageElement>; onLoad: ((texture: Texture<HTMLImageElement>) => void) | undefined; onError: ((error: unknown) => void) | undefined; dispose: ReturnType<typeof vi.fn> }[] = [];
    vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((_url, onLoad, _progress, onError) => {
      const image = document.createElement('img'); image.width = 768; image.height = 457;
      const texture = new Texture(image);
      const dispose = vi.fn();
      texture.addEventListener('dispose', dispose);
      loads.push({ texture, onLoad, onError, dispose });
      return texture;
    });
    const geometryDispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(ShaderMaterial.prototype, 'dispose');
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(StrictMode, null,
        createElement(AbyssVortex, { backgroundUrl: '/abyss.webp', still: false, active: true, flash: { current: 0 } }),
      )));
      expect(loads.length).toBeGreaterThanOrEqual(2);
      expect(loads[0]!.dispose).toHaveBeenCalledOnce();
      await act(async () => loads[0]!.onLoad?.(loads[0]!.texture));
      expect(host.querySelector('mesh')).toBeNull();
      const latest = loads[loads.length - 1]!;
      await act(async () => {
        if (failure === 'texture') latest.onError?.(new Error('load failed'));
        else if (failure === 'shader') debug.onShaderError?.();
        else canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      });
      expect(host.querySelector('.abyss-vortex')!.getAttribute('data-vortex-status')).toBe('fallback');
      expect(host.querySelector('[data-mock-canvas]')).toBeNull();
      expect(debug.onShaderError).toBe(previousShaderError);
      for (const load of loads) expect(load.dispose).toHaveBeenCalledOnce();
      expect(materialDispose.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(new Set(materialDispose.mock.contexts).size).toBe(materialDispose.mock.contexts.length);
      expect(new Set(geometryDispose.mock.contexts).size).toBe(geometryDispose.mock.contexts.length);
      await act(async () => latest.onLoad?.(latest.texture));
      expect(host.querySelector('.abyss-vortex')!.getAttribute('data-vortex-status')).toBe('fallback');
    } finally { await act(async () => root.unmount()); }
  });

  it('没有WebGL时不插错误屏或加载文字，调用方底图与退出入口不受影响', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement('section', null,
        createElement('img', { src: '/abyss.webp', alt: '深渊底图' }),
        createElement(AbyssVortex, { backgroundUrl: '/abyss.webp', still: false, active: true, flash: { current: 0 } }),
        createElement('button', null, '返回'),
      )));
      expect(host.querySelector('img')).not.toBeNull();
      expect(host.querySelector('button')!.textContent).toBe('返回');
      expect(host.querySelector('.abyss-vortex')!.getAttribute('data-vortex-status')).toBe('fallback');
      expect(host.querySelectorAll('.abyss-vortex__cloud')).toHaveLength(4);
      expect(host.querySelector('[data-mock-canvas]')).toBeNull();
      expect(host.querySelector('.abyss-vortex')!.getAttribute('data-active')).toBe('true');
      expect(host.querySelectorAll('.abyss-vortex__spark')).toHaveLength(36);
      expect(host.textContent).not.toContain('WebGL');
    } finally { await act(async () => root.unmount()); }
  });
});
