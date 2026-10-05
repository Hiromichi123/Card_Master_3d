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
  /** Bloom 强度。 */
  readonly bloomIntensity: number;
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
    bloomIntensity: 0,
    shadows: false,
    shadowMapSize: 512,
    cardTier: 'thumbnail',
  },
  medium: {
    dprCap: 1.5,
    particleCapacity: 1000,
    bloom: true,
    bloomIntensity: 0.45,
    shadows: true,
    shadowMapSize: 1024,
    cardTier: 'battle',
  },
  high: {
    dprCap: 2,
    particleCapacity: 3000,
    bloom: true,
    bloomIntensity: 0.7,
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
 * Bloom 的亮度阈值。
 *
 * 取得**很高**是刻意的：阈值低的话整个画面都会发光，卡面插画与中文会被糊掉，
 * 正是 `V-PP-2` 要避免的。
 *
 * 这个值是实测调出来的：0.9 时仅翻转 Bloom 就会让卡面区域平均亮度涨 10.9%
 * （卡面上的金色花纹与白字本身就接近纯白），肉眼可见一层薄雾。
 * 提到 0.96 后只有真正过曝的粒子核心与闪电仍参与泛光，
 * 卡面的变化被压到可忽略。
 */
export const BLOOM_LUMINANCE_THRESHOLD = 0.96;
export const BLOOM_LUMINANCE_SMOOTHING = 0.25;
