/**
 * 闪卡的**检视模型**。
 *
 * 这一层不画任何东西，只定义「倾斜到什么程度时，箔片应该是什么状态」——
 * 3D 卡（着色器）与图鉴卡格（DOM）都从同一组参数出发，
 * 于是两处的观感是一件东西的两个实现，而不是各调各的。
 *
 * **参考**：`pokemon-cards-css`（GPL-3.0）的**视觉规律**——
 * 色带随倾斜滑移、细扫描线、跟指针走的眩光、以及「两组错位的彩虹带相互干涉」
 * 这个关键手法。**不复制其实现**：这里没有任何它的代码、类名、变量名或数值，
 * 全部按本项目自己的参数重写（`V-HOLO-3`、PLAN 第 3.3 节）。
 */

import type { CardRarity } from '../../domain/cards/types';

/** 箔片的种类。不同种类决定色带的密度与铺法，不是只改颜色。 */
export type FoilKind =
  /** 没有箔片：低稀有度就是普通印刷卡。 */
  | 'none'
  /** 最经典的一种：斜向彩虹带 + 细扫描线。 */
  | 'bands'
  /** 星点：细碎的亮点，像撒了金粉。 */
  | 'speckle'
  /** 全息彩虹：色带极密、色相铺满一整圈。 */
  | 'prism'
  /** 金箔：色带收敛成金色，反光更强。 */
  | 'gold';

/**
 * 稀有度 → 箔片种类。
 *
 * 照的是「越稀有，箔片越复杂」这条直觉：低稀有度不打箔，
 * 中档是经典斜带，高档往上加星点与彩虹，顶稀有度是金箔。
 */
export function foilKindForRarity(rarity: CardRarity): FoilKind {
  switch (rarity) {
    case 'D':
    case 'C':
    case 'C+':
      return 'none';
    case 'B':
    case 'B+':
      return 'bands';
    case 'A':
    case 'A+':
      return 'speckle';
    case 'S':
    case 'S+':
      // 金箔：低调的金属光泽。**放在 S 档而不是顶档**——
      // 顶档若用金色，稀有度最高的那张反而比 SS 的彩虹带低调，梯子是反的。
      return 'gold';
    case 'SS':
    case 'SS+':
    case 'SSS':
      // 彩虹带最抢眼，留给最高的三档
      return 'prism';
    default:
      return 'none';
  }
}

/** 箔片种类 → 着色器/样式的参数。 */
export interface FoilTuning {
  /** 0..1，整体强度。 */
  readonly strength: number;
  /** 色带的重复密度。 */
  readonly density: number;
  /** 色相在卡面上的铺开速度；越大越容易在同一张卡上看到整圈彩虹。 */
  readonly hueSpread: number;
  /** 细扫描线的频率；0 表示不画。 */
  readonly scanlines: number;
  /** 星点的强度；0 表示不撒。 */
  readonly speckle: number;
  /** 金色的收敛程度；0 是纯彩虹，1 是纯金。 */
  readonly gilt: number;
}

export const FOIL_TUNING: Record<FoilKind, FoilTuning> = {
  none: { strength: 0, density: 0, hueSpread: 0, scanlines: 0, speckle: 0, gilt: 0 },
  bands: { strength: 0.42, density: 3.4, hueSpread: 0.55, scanlines: 26, speckle: 0.2, gilt: 0 },
  speckle: { strength: 0.5, density: 3.0, hueSpread: 0.7, scanlines: 0, speckle: 1, gilt: 0.1 },
  prism: { strength: 0.62, density: 5.2, hueSpread: 1.5, scanlines: 18, speckle: 0.35, gilt: 0 },
  gold: { strength: 0.7, density: 2.6, hueSpread: 0.35, scanlines: 30, speckle: 0.5, gilt: 0.85 },
};

/**
 * 一次检视的状态。
 *
 * **两个渲染端都产出这一组**：3D 卡由视线方向在卡面局部坐标下的投影算出，
 * 图鉴卡格由鼠标在卡面上的位置算出。物理来源不同，但下游的用法完全一样。
 */
export interface FoilView {
  /** 色带滑移的横向位置，0..1，0.5 是居中。 */
  readonly backgroundX: number;
  readonly backgroundY: number;
  /** 眩光中心，0..1。 */
  readonly glareX: number;
  readonly glareY: number;
  /** 距中心的归一化距离，0（正中）..1（边缘）。 */
  readonly fromCenter: number;
  /** 受光程度：1 = 视线垂直卡面，0 = 掠射。 */
  readonly lit: number;
}

/** 正对时的基准状态。 */
export const FOIL_REST: FoilView = {
  backgroundX: 0.5,
  backgroundY: 0.5,
  glareX: 0.5,
  glareY: 0.5,
  fromCenter: 0,
  lit: 1,
};

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * 从指针在卡面上的归一化位置（0..1）推出检视状态。
 *
 * 两项映射是这套观感的关键，两条都写在这里而不是散在组件里：
 *
 * 1. **色带的位移比指针的位移小得多**（这里压到 ±14%）。指针划过整张卡时
 *    色带若跟着跑满全程，看起来是「背景图在平移」；压窄之后才是「箔片反光扫过」。
 * 2. **眩光跟着指针走，且越靠边越亮**——`fromCenter` 同时喂给强度。
 */
export function foilFromPointer(pointerX: number, pointerY: number): FoilView {
  const x = clamp01(pointerX);
  const y = clamp01(pointerY);
  const centeredX = x - 0.5;
  const centeredY = y - 0.5;

  return {
    backgroundX: clamp01(0.5 + centeredX * 0.28),
    backgroundY: clamp01(0.5 + centeredY * 0.28),
    glareX: x,
    glareY: y,
    fromCenter: clamp01(Math.hypot(centeredX, centeredY) * 2),
    // 指针在正中时最"正对"，越靠边越像斜着看
    lit: clamp01(1 - Math.hypot(centeredX, centeredY) * 1.4),
  };
}

/**
 * 从视线方向在**卡面局部坐标**下的投影推出检视状态（3D 卡的等价物）。
 *
 * 参数是两个已经归一化到 −1..1 的分量：视线方向点乘卡面的右向量与上向量。
 * 转成和 `foilFromPointer` 同一个形状，于是着色器与 DOM 用的是同一套参数含义。
 */
export function foilFromView(viewLocalX: number, viewLocalY: number): FoilView {
  const x = Math.max(-1, Math.min(1, viewLocalX));
  const y = Math.max(-1, Math.min(1, viewLocalY));
  return {
    backgroundX: clamp01(0.5 + x * 0.14),
    backgroundY: clamp01(0.5 + y * 0.14),
    glareX: clamp01(0.5 + x * 0.5),
    glareY: clamp01(0.5 + y * 0.5),
    fromCenter: clamp01(Math.hypot(x, y)),
    lit: clamp01(1 - Math.hypot(x, y) * 0.9),
  };
}
