/**
 * 画质档（`V-PP-1..4` / `V-PERF-1..3`）。
 *
 * 档位只影响**表现**，不得改变任何规则结果（`V-FX-5`）。
 * 三档的取值来自 `docs/VISUAL_SPEC.md` 第 7 节的起始预算，
 * 这些是工程起点，不是对未知硬件的承诺——P7 要按实测调整。
 *
 * 参考机器是 **Intel Arc 核显**（见 `docs/validation/P1.md` 第 1 节），
 * 所以中档的默认值刻意保守。
 */

export type QualityTier = 'low' | 'medium' | 'high';

export interface QualityProfile {
  /** 设备像素比上限。核显上 2 倍 DPR 的填充率是主要瓶颈之一。 */
  readonly dprCap: number;
  /** 粒子池容量，对应 V-PERF-1..3 的活跃粒子上限。 */
  readonly particleCapacity: number;
  /** 是否启用 Bloom。低档关闭。 */
  readonly bloom: boolean;
  /**
   * Bloom 强度的**倍率**，乘在台面主题给的基准值上。
   *
   * 台面主题决定泛光的性格（鬼火一样的霓虹 vs 几乎不闪的木桌），
   * 画质档决定同一性格下打多少折。
   */
  readonly bloomScale: number;
  /** 是否投射阴影。低档关闭。 */
  readonly shadows: boolean;
  /** 阴影贴图边长。 */
  readonly shadowMapSize: number;
  /** 卡面纹理档：低档用 thumbnail，中高档用 battle。 */
  readonly cardTier: 'thumbnail' | 'battle';
}

export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  low: {
    dprCap: 1,
    particleCapacity: 250,
    bloom: false,
    bloomScale: 0,
    shadows: false,
    shadowMapSize: 512,
    cardTier: 'thumbnail',
  },
  medium: {
    dprCap: 1.5,
    particleCapacity: 1000,
    bloom: true,
    bloomScale: 1,
    shadows: true,
    shadowMapSize: 1024,
    cardTier: 'battle',
  },
  high: {
    dprCap: 2,
    particleCapacity: 3000,
    bloom: true,
    bloomScale: 1.25,
    shadows: true,
    shadowMapSize: 2048,
    cardTier: 'battle',
  },
};

export const QUALITY_LABELS: Record<QualityTier, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

/**
 * Bloom 亮度阈值的**下限**。
 *
 * 台面主题各自带一个阈值（移植自棋盘项目），那些值是按「深色场景 + 小体积高亮棋子」
 * 调的：棋盘上低到 0.62 也没问题，因为画面里几乎没有大面积亮部。
 *
 * 本项目的画面构成不同——卡面是大块高亮表面，阈值一低整张卡都会发光，
 * 插画与中文被糊掉，正是 `V-PP-2` 要禁止的。实测 0.9 时仅翻转 Bloom
 * 就会让卡面区域平均亮度涨 10.9%。
 *
 * 所以取「主题值与下限的较大者」：保留主题之间的差异，
 * 但不允许任何主题越过会糊卡面的那条线。
 */
export const MIN_BLOOM_THRESHOLD = 0.9;
export const BLOOM_LUMINANCE_SMOOTHING = 0.25;
