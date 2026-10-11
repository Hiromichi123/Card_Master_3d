import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ABYSS_VORTEX, coverUvScale, makeSmokeGeometry, makeSmokeWisps, vortexBudget, vortexCoreMask } from '../../src/rendering/abyss/vortexParameters';
import { VORTEX_FRAGMENT, VORTEX_VERTEX } from '../../src/rendering/abyss/vortexShaders';

describe('深渊云雾预算与构图参数', () => {
  it('固定seed样本可复现，分层从后到前，不在帧内生成随机数', () => {
    const wisps = makeSmokeWisps(48);
    expect(wisps).toEqual(makeSmokeWisps(48));
    expect(wisps).toHaveLength(48);
    expect(new Set(wisps.map(wisp => wisp.depth)).size).toBe(4);
    expect(wisps.every((wisp, index) => index === 0 || wisp.depth >= wisps[index - 1]!.depth)).toBe(true);
    expect(new Set(wisps.map(wisp => wisp.speed)).size).toBeGreaterThan(30);
    expect(wisps.every(wisp => wisp.opacity >= 0.32 && wisp.opacity < 0.45)).toBe(true);
    expect(wisps.every(wisp => wisp.speed > 0.1 && wisp.speed < 0.2)).toBe(true);
    // 三秒转过至少17度，但不超过35度；这只是配置断言，不冒充视觉实测。
    expect(wisps.every(wisp => wisp.speed * 3 > 0.3 && wisp.speed * 3 < 0.6)).toBe(true);
  });

  it('低中高32/40/48片，上限DPR1.5且尊重设置的更低上限', () => {
    expect(vortexBudget('low', 3)).toEqual({ count: 32, dpr: 1 });
    expect(vortexBudget('medium', 2)).toEqual({ count: 40, dpr: 1.5 });
    expect(vortexBudget('high', 1.2)).toEqual({ count: 48, dpr: 1.2 });
    expect(vortexBudget('high', Number.NaN).dpr).toBe(1);
  });

  it('生产实例几何经shader切径向/翘曲/cover投影后，所有三角形正面且不退化', () => {
    const geometry = makeSmokeGeometry(48);
    try {
      const positions = geometry.getAttribute('position');
      const orbit = geometry.getAttribute('aOrbit');
      const shape = geometry.getAttribute('aShape');
      const indices = geometry.getIndex()!;
      expect(geometry.instanceCount).toBe(48);
      expect(indices.count).toBe(8 * 3 * 6);
      // 使用生产buffer及与vertex一致的投影，不用与真实几何无关的方向常量。
      const project = (vertex: number, instance: number, time: number, cover: readonly [number, number]) => {
        const x = positions.getX(vertex);
        const y = positions.getY(vertex);
        const angle = orbit.getY(instance) + time * orbit.getZ(instance);
        const radius = orbit.getX(instance) + Math.sin(time * 0.11 + orbit.getW(instance)) * 0.009;
        const rx = Math.cos(angle);
        const ry = Math.sin(angle);
        const bend = Math.sin(x * 2.6 + orbit.getW(instance) + time * 0.07);
        const z = shape.getZ(instance) + bend * 0.075;
        const lx = -ry * x * shape.getX(instance) + rx * (y * shape.getY(instance) + bend * 0.009);
        const ly = rx * x * shape.getX(instance) + ry * (y * shape.getY(instance) + bend * 0.009);
        const u = ABYSS_VORTEX.center[0] + (rx * radius + lx / (1 - z * 0.17)) * ABYSS_VORTEX.ellipse[0];
        const v = ABYSS_VORTEX.center[1] + (ry * radius + ly / (1 - z * 0.17)) * ABYSS_VORTEX.ellipse[1];
        return [(u - 0.5) / cover[0] * 2, (v - 0.5) / cover[1] * 2] as const;
      };
      let minimumArea = Infinity;
      for (const time of [0, 3, 17, 53]) {
        for (const cover of [coverUvScale(900, 900, 768, 457), coverUvScale(1920, 800, 768, 457)]) {
          for (let instance = 0; instance < geometry.instanceCount; instance++) {
            for (let triangle = 0; triangle < indices.count; triangle += 3) {
              const a = project(indices.getX(triangle), instance, time, cover);
              const b = project(indices.getX(triangle + 1), instance, time, cover);
              const c = project(indices.getX(triangle + 2), instance, time, cover);
              const signedArea = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
              minimumArea = Math.min(minimumArea, signedArea);
            }
          }
        }
      }
      expect(Number.isFinite(minimumArea)).toBe(true);
      expect(minimumArea).toBeGreaterThan(0.0001);
      expect(VORTEX_VERTEX).toContain('vec2 tangent = vec2(-radial.y, radial.x)');
      expect(VORTEX_VERTEX).toContain('local / (1.0 - z * 0.17)');
    } finally { geometry.dispose(); }
  });

  it('cover纹理映射与居中DOM底图一致，空尺寸不产生NaN', () => {
    expect(coverUvScale(1600, 900, 1600, 900)).toEqual([1, 1]);
    expect(coverUvScale(900, 900, 1600, 900)).toEqual([0.5625, 1]);
    expect(coverUvScale(1600, 900, 900, 900)).toEqual([1, 0.5625]);
    expect(coverUvScale(0, 0, 0, 0)).toEqual([1, 1]);
  });

  it('常驻基础层只旋转原创渐变，ready减弱而不停转，still/后台暂停且中心透明', () => {
    const css = readFileSync(new URL('../../src/ui/abyssVortex.css', import.meta.url), 'utf8');
    expect(css).toContain('radial-gradient(ellipse closest-side, transparent var(--abyss-core-mask)');
    expect(css).toMatch(/\[data-still="true"\][\s\S]*?\[data-active="false"\][\s\S]*?animation-play-state: paused/);
    expect(css).toMatch(/\.abyss-vortex__base\[data-softened="true"\]\s*\{\s*opacity: \.68;/);
    expect(css).not.toContain('data-fading');
    expect(css).toContain('animation: abyss-cloud-orbit 38s linear infinite');
    expect(css).toContain('animation-duration: 21s');
    expect(css).not.toContain('url(');
    expect(css).not.toContain('filter:');
    expect(css).not.toContain('prefers-reduced-motion');
  });

  it('内核透明区保护底图黑洞，边缘渐变而非不透明挡片', () => {
    const [x, y] = ABYSS_VORTEX.center;
    expect(vortexCoreMask(x, y)).toBe(0);
    expect(vortexCoreMask(x + ABYSS_VORTEX.innerRadius - 0.001, y)).toBe(0);
    expect(vortexCoreMask(x + ABYSS_VORTEX.innerRadius + 0.025, y)).toBeGreaterThan(0);
    expect(vortexCoreMask(x + ABYSS_VORTEX.innerRadius + 0.025, y)).toBeLessThan(1);
    expect(vortexCoreMask(x + 0.3, y)).toBe(1);
    expect(VORTEX_FRAGMENT).toContain('uFlash');
    expect(VORTEX_FRAGMENT).toContain('texture2D(uBackground');
    expect(VORTEX_FRAGMENT).toContain('alpha = edge * density * vOpacity * core * outer');
    expect(VORTEX_VERTEX).toContain('uTime * aOrbit.z');
    expect(VORTEX_VERTEX).toContain('(imageUv - 0.5) / uCover + 0.5');
  });
});
