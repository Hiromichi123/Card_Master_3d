export const ABYSS_SPARK_COUNT = 36;
export const ABYSS_SPARK_PULSE_FRACTION = 0.18;
export type SparkPoint = readonly [number, number];

export interface AbyssSpark {
  readonly id: number;
  readonly main: readonly SparkPoint[];
  readonly branch: readonly SparkPoint[];
  readonly path: string;
  readonly periodMs: number;
  readonly delayMs: number;
}

const pathOf = (points: readonly SparkPoint[]) => points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');

/** 1000方形环坐标由SVG整体压成椭圆；固定seed让重渲染不改变电弧形状和相位。 */
export function makeAbyssSparks(seed = 0x5e71a9c3): readonly AbyssSpark[] {
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return Array.from({ length: ABYSS_SPARK_COUNT }, (_, id) => {
    const angle = id * Math.PI * 2 / ABYSS_SPARK_COUNT + (random() - 0.5) * 0.18;
    const radius = 235 + random() * 160;
    const length = 24 + random() * 20;
    const radial = [Math.cos(angle), Math.sin(angle)] as const;
    const tangent = [-radial[1], radial[0]] as const;
    const point = (along: number, out: number): SparkPoint => [
      500 + radial[0] * (radius + out) + tangent[0] * along,
      500 + radial[1] * (radius + out) + tangent[1] * along,
    ];
    const main = [-0.5, -0.3, -0.1, 0.12, 0.31, 0.5].map((along, index) =>
      point(along * length, (index % 2 ? 1 : -1) * (1.5 + random() * 3.5)));
    const branch = [main[3]!, point(length * 0.02, 7 + random() * 3), point(-length * 0.12, 12 + random() * 4)];
    const periodMs = 3000 + Math.floor(random() * 2001);
    // 分区错相，多个短电弧交叠余辉，不用同步闪烁照亮整环。
    const delayMs = -Math.round(periodMs * (id + 0.15 + random() * 0.6) / ABYSS_SPARK_COUNT);
    return { id, main, branch, path: `${pathOf(main)} ${pathOf(branch)}`, periodMs, delayMs };
  });
}

export const ABYSS_SPARKS = makeAbyssSparks();
