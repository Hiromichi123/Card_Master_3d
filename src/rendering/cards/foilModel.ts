/**
 * 闪卡的**检视模型**。
 *
 * 这一层不画任何东西，只定义「倾斜到什么程度时，箔片应该是什么状态」。
 * 3D 卡（着色器）与展示位（DOM）都从同一组参数出发。
 *
 * **参考** `pokemon-cards-css`（GPL-3.0）的 Trainer Gallery 箔：
 *
 * > 一种带虹彩光泽的金属感。做法是**一个大尺度的 color-dodge 线性渐变**，
 * > 再在光标位置叠一层 **hard-light 径向渐变**，给出闪烁感。
 *
 * **不复制其实现**：没有它的代码、类名、变量名或数值
 * （`V-HOLO-3`、PLAN 第 3.3 节、`assets-sources.json` 的 `visualReferences`）。
 *
 * 早先的版本做的是「两层交叉的重复渐变 + 扫描线」，读起来是一条条**带**——
 * 那不是这个效果。Trainer Gallery 是**一层大渐变**：渐变周期横跨整张卡，
 * 所以看到的是平滑的虹彩扫过，而不是条纹。
 */

import type { CardRarity } from '../../domain/cards/types';

/** 箔片的种类。 */
export type FoilKind =
  /** 没有箔片：低稀有度就是普通印刷卡。 */
  | 'none'
  /** 虹彩箔：一整个彩虹周期横跨卡片，金属感。 */
  | 'iridescent'
  /** 单色箔：同一个做法，但用该卡稀有度自己的代表色。 */
  | 'tinted';

/**
 * 稀有度 → 箔片种类与强度。
 *
 * 1. **只有 SSS 用虹彩箔**，其余用各自稀有度的代表色（取自 `rarities.json`，
 *    与卡牌外圈光晕同源）；
 * 2. **S / SS 收窄**，让位给 SSS；其余档位沿稀有度单调递增。
 */
const STRENGTH: Record<CardRarity, number> = {
  D: 0,
  C: 0.34,
  'C+': 0.38,
  B: 0.44,
  'B+': 0.48,
  A: 0.52,
  'A+': 0.56,
  S: 0.52,
  'S+': 0.56,
  SS: 0.6,
  'SS+': 0.64,
  SSS: 0.58,
  '#elna': 0.68,
  '#yoroi': 0.52,
};

export function foilStrengthForRarity(rarity: CardRarity): number {
  return STRENGTH[rarity];
}

export function foilKindForRarity(rarity: CardRarity): FoilKind {
  if (STRENGTH[rarity] <= 0) {
    return 'none';
  }
  return rarity === 'SSS' ? 'iridescent' : 'tinted';
}

/** 一次检视的完整描述，交给两个渲染端。 */
export interface FoilSpec {
  readonly kind: FoilKind;
  readonly strength: number;
  /**
   * 渐变的色标。**顺序铺满 0–100%**，不做黑白交替——
   * 交替就是「带」，而这个效果要的是平滑扫过。
   */
  readonly palette: readonly string[];
  readonly rainbow: boolean;
}

/**
 * 虹彩箔的色标。
 *
 * 六个色相均匀铺开，明度也拉开一点（金属箔的反射本来就带明暗），
 * 但**不交替**：交替会立刻变成条纹。
 */
const RAINBOW: readonly string[] = [
  '#8f5cff',
  '#ff5fa8',
  '#ffd166',
  '#5ce1a0',
  '#4fc3f7',
  '#c07bff',
];

/**
 * 把一个代表色摊成渐变色标。
 *
 * 同一个色相上做一次「亮 → 暗 → 亮」的缓慢起伏，读起来是金属表面的明暗过渡
 * 而不是条纹。**不要写成亮暗交替**——那正是上一版做错的地方。
 */
export function tintedPalette(hex: string): readonly string[] {
  const value = hex.replace('#', '');
  if (value.length !== 6) {
    return RAINBOW;
  }
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);

  const mix = (amount: number): string => {
    const target = amount >= 0 ? 255 : 0;
    const t = Math.abs(amount);
    const channel = (base: number): number => Math.round(base + (target - base) * t);
    return `#${[channel(r), channel(g), channel(b)]
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')}`;
  };

  // 固定六段：CSS 那边按 --foil-c1..c6 均匀铺开，段数一致才能写死。
  // 起伏是「中 → 亮 → 中 → 暗 → 亮 → 中」的缓慢过渡，不是交替。
  return [mix(0.1), mix(0.55), mix(0.05), mix(-0.15), mix(0.45), mix(0.2)];
}

export function foilForRarity(rarity: CardRarity, rarityColor: string): FoilSpec {
  const kind = foilKindForRarity(rarity);
  const iridescent = kind === 'iridescent';
  return {
    kind,
    strength: foilStrengthForRarity(rarity),
    palette: iridescent ? RAINBOW : tintedPalette(rarityColor),
    rainbow: iridescent,
  };
}

/**
 * 一次检视的状态。
 *
 * **两个渲染端都产出这一组**：3D 卡由视线方向在卡面局部坐标下的投影算出，
 * 展示位由鼠标在卡面上的位置算出。
 */
export interface FoilView {
  /** 大渐变滑移的横向位置，0..1，0.5 是居中。 */
  readonly backgroundX: number;
  readonly backgroundY: number;
  /** 径向光（闪烁）的中心，0..1。 */
  readonly glareX: number;
  readonly glareY: number;
  /** 距中心的归一化距离，0（正中）..1（边缘）。 */
  readonly fromCenter: number;
  /** 受光程度：1 = 视线垂直卡面，0 = 掠射。 */
  readonly lit: number;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * 从指针在卡面上的归一化位置（0..1）推出检视状态。
 *
 * 两条映射写在这里而不是散在组件里：
 *
 * 1. **渐变滑移比指针位移小得多**（±13%）。指针划过整张卡时渐变若跟着跑满全程，
 *    看起来是「背景图在平移」；压窄之后才是「光扫过金属」。
 * 2. **越靠边越亮**——参考实现就是按「距中心多远」调亮度的，
 *    既符合物理（斜看反射更强），也是「我在照这张卡」的反馈。
 */
export function foilFromPointer(pointerX: number, pointerY: number): FoilView {
  const x = clamp01(pointerX);
  const y = clamp01(pointerY);
  const centeredX = x - 0.5;
  const centeredY = y - 0.5;
  const distance = clamp01(Math.hypot(centeredX, centeredY) * 2);

  return {
    backgroundX: clamp01(0.5 + centeredX * 0.26),
    backgroundY: clamp01(0.5 + centeredY * 0.26),
    glareX: x,
    glareY: y,
    fromCenter: distance,
    lit: clamp01(1 - distance * 1.4),
  };
}

/**
 * 从视线方向在**卡面局部坐标**下的投影推出检视状态（3D 卡的等价物）。
 *
 * 参数是两个归一化到 −1..1 的分量：视线方向点乘卡面的右向量与上向量。
 */
export function foilFromView(viewLocalX: number, viewLocalY: number): FoilView {
  const x = Math.max(-1, Math.min(1, viewLocalX));
  const y = Math.max(-1, Math.min(1, viewLocalY));
  const distance = clamp01(Math.hypot(x, y));
  return {
    backgroundX: clamp01(0.5 + x * 0.13),
    backgroundY: clamp01(0.5 + y * 0.13),
    glareX: clamp01(0.5 + x * 0.5),
    glareY: clamp01(0.5 + y * 0.5),
    fromCenter: distance,
    lit: clamp01(1 - distance * 0.9),
  };
}
