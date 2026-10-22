import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ABYSS_SPARK_COUNT, ABYSS_SPARK_PULSE_FRACTION, ABYSS_SPARKS, makeAbyssSparks, type SparkPoint } from '../../src/rendering/abyss/abyssSparks';
import { ABYSS_VORTEX } from '../../src/rendering/abyss/vortexParameters';

const radius = ([x, y]: SparkPoint) => Math.hypot(x - 500, y - 500);
const length = (points: readonly SparkPoint[]) => points.slice(1).reduce((sum, point, index) =>
  sum + Math.hypot(point[0] - points[index]![0], point[1] - points[index]![1]), 0);

describe('深渊云间金黄色短电弧', () => {
  it('固定seed三十六条分叉短线，可复现且路径与测试点使用相同数据', () => {
    expect(ABYSS_SPARKS).toEqual(makeAbyssSparks());
    expect(ABYSS_SPARKS).toHaveLength(ABYSS_SPARK_COUNT);
    expect(ABYSS_SPARK_COUNT).toBe(36);
    expect(new Set(ABYSS_SPARKS.map(spark => spark.path)).size).toBe(36);
    for (const spark of ABYSS_SPARKS) {
      expect(spark.main).toHaveLength(6); expect(spark.branch).toHaveLength(3);
      expect(spark.branch[0]).toEqual(spark.main[3]);
      expect(spark.path.match(/M/g)).toHaveLength(2);
      expect(spark.path).toContain(spark.main[0]![0].toFixed(2));
      expect(spark.path).not.toMatch(/NaN|Infinity/);
      expect(length(spark.main)).toBeLessThan(80);
      expect(length(spark.branch)).toBeLessThan(40);
    }
  });

  it('每一段都在云环内，留出中心安全区，绕转不会扫入洞心', () => {
    const clearCore = (ABYSS_VORTEX.innerRadius + 0.055) / ABYSS_VORTEX.outerRadius * 500;
    for (const spark of ABYSS_SPARKS) {
      for (const points of [spark.main, spark.branch]) {
        for (let index = 1; index < points.length; index++) {
          const a = points[index - 1]!, b = points[index]!;
          for (let step = 0; step <= 10; step++) {
            const point: SparkPoint = [a[0] + (b[0] - a[0]) * step / 10, a[1] + (b[1] - a[1]) * step / 10];
            expect(radius(point)).toBeGreaterThan(clearCore + 35);
            expect(radius(point)).toBeLessThan(420);
          }
        }
      }
    }
  });

  it('3–5秒周期，余辉持续540–900ms且逐条错相', () => {
    const phases = new Set<number>();
    for (const spark of ABYSS_SPARKS) {
      expect(spark.periodMs).toBeGreaterThanOrEqual(3000); expect(spark.periodMs).toBeLessThanOrEqual(5000);
      expect(spark.periodMs * ABYSS_SPARK_PULSE_FRACTION).toBeGreaterThanOrEqual(540);
      expect(spark.periodMs * ABYSS_SPARK_PULSE_FRACTION).toBeLessThanOrEqual(900);
      expect(spark.delayMs).toBeLessThanOrEqual(0); expect(spark.delayMs).toBeGreaterThan(-spark.periodMs);
      phases.add(Math.floor(-spark.delayMs / spark.periodMs * ABYSS_SPARK_COUNT));
    }
    expect(phases.size).toBe(36);
  });

  it('CSS只受游戏still与active控制，后台同时暂停公转和亮灭，静止隐藏电弧', () => {
    const css = readFileSync('src/ui/abyssVortex.css', 'utf8');
    expect(css).not.toContain('prefers-reduced-motion');
    expect(css).toContain(`0%, ${ABYSS_SPARK_PULSE_FRACTION * 100}%, 100% { opacity: 0; }`);
    expect(ABYSS_SPARK_PULSE_FRACTION).toBe(0.18);
    expect(css).toContain('animation: abyss-spark-orbit 54s linear infinite');
    expect(css).toContain('animation: abyss-spark-pulse var(--spark-period) linear var(--spark-delay) infinite both');
    expect(css).toContain('.abyss-vortex[data-active="false"] .abyss-vortex__spark-orbit');
    expect(css).toContain('.abyss-vortex[data-active="false"] .abyss-vortex__spark,');
    expect(css).toContain('.abyss-vortex[data-still="true"] .abyss-vortex__spark { animation-play-state: paused; }');
    expect(css).toContain('.abyss-vortex[data-still="true"] .abyss-vortex__sparks { display: none; }');
    expect(css).toContain('stroke: #ffc83d'); expect(css).toContain('stroke: #fff3a6');
    expect(css).not.toContain('filter:');
  });
});
