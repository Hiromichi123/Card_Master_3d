/**
 * 闪卡的**检视模型**。
 *
 * 这一层不画任何东西，只定义「倾斜到什么程度时，箔片应该是什么状态」。
 * 3D 卡（着色器）与展示位（DOM）都从同一组参数出发，
 * 于是两处是一件东西的两个实现，而不是各调各的。
 *
 * **参考** `pokemon-cards-css`（GPL-3.0）的**视觉规律**：
 * 色带随倾斜滑移、两组错位色带互相干涉、细扫描线、跟着指针走的眩光，
 * 以及「Trainer Gallery」那种浅角度宽色带 + 大口径柔光。
 * **不复制其实现**：这里没有它的代码、类名、变量名或数值
 * （`V-HOLO-3`、PLAN 第 3.3 节、`assets-sources.json` 的 `visualReferences`）。
 */

import type { CardRarity } from '../../domain/cards/types';

/** 箔片的种类。种类决定色带的**几何**，不只是颜色。 */
export type FoilKind =
  /** 没有箔片：低稀有度就是普通印刷卡。 */
  | 'none'
  /** 常规箔：斜向色带 + 细扫描线，用该卡自己稀有度的代表色。 */
  | 'plain'
  /**
   * 画廊箔（Trainer Gallery 那一类）：
   * **浅角度、宽间距**的彩虹带，**不画扫描线**，再叠一团大口径柔光。
   * 与 `plain` 的差别是几何而不是配色——它是「箔纸」，不是「密纹全息」。
   */
  | 'tg';

/**
 * 箔片几何参数。
 *
 * **调密度用 `background-size`，不要用色标。** 早先写过
 * 「色标 ÷ 密度」再配 300% 铺展，结果每个色带只剩两三个像素，
 * 在缩略图上直接变成噪声。
 */
export interface FoilGeometry {
  /** 色带重复密度。越大带越细。 */
  readonly density: number;
  /** 细扫描线的频率；0 表示这类箔不画。 */
  readonly scanlines: number;
  /** 色带的软硬：越大带越窄越锐。 */
  readonly sharpness: number;
}

const GEOMETRY: Record<FoilKind, FoilGeometry> = {
  none: { density: 0, scanlines: 0, sharpness: 1 },
  // 常规箔：中等密度 + 扫描线
  plain: { density: 3.4, scanlines: 22, sharpness: 1 },
  // 画廊箔：**带更宽、没有扫描线**——那两条是它和常规箔最大的区别
  tg: { density: 2.6, scanlines: 0, sharpness: 0.55 },
};

/**
 * 稀有度 → 箔片种类与强度。
 *
 * 两条规则按需求定：
 *
 * 1. **只有 SSS 用画廊箔**，其余稀有度一律走常规箔、**用自己那个代表色**
 *    （配色取自 `rarities.json`，与卡牌外圈光晕同源）；
 * 2. **S / SS 比上一版减弱**——它们原先是最抢眼的两档，现在让位给 SSS。
 *    强度仍然沿稀有度单调递增，否则「越高越闪」这条直觉会断。
 */
const STRENGTH: Record<CardRarity, number> = {
  D: 0,
  C: 0.3,
  'C+': 0.34,
  B: 0.4,
  'B+': 0.44,
  A: 0.48,
  'A+': 0.52,
  S: 0.5,
  'S+': 0.54,
  SS: 0.58,
  'SS+': 0.62,
  SSS: 0.78,
  '#elna': 0.66,
};

export function foilKindForRarity(rarity: CardRarity): FoilKind {
  if (rarity === 'SSS') {
    return 'tg';
  }
  return STRENGTH[rarity] > 0 ? 'plain' : 'none';
}

export function foilStrengthForRarity(rarity: CardRarity): number {
  return STRENGTH[rarity];
}

/** 一次检视的完整描述，交给两个渲染端。 */
export interface FoilSpec {
  readonly kind: FoilKind;
  readonly strength: number;
  readonly geometry: FoilGeometry;
  /**
   * 六段色带配色。
   *
   * `tg` 用固定彩虹；`plain` 用该稀有度代表色的明暗变体——
   * 于是同一套几何在每个稀有度上呈现不同的颜色，而深浅交替仍能读出条带。
   */
  readonly palette: readonly [string, string, string, string, string, string];
  /** 是否用彩虹而非单色（着色器用它决定混色方式）。 */
  readonly rainbow: boolean;
}

/** 画廊箔的彩虹。六段循环，相邻两段明度差开，条带才读得出来。 */
const TG_PALETTE: readonly [string, string, string, string, string, string] = [
  '#b06bff',
  '#ff6a6a',
  '#ffd76a',
  '#7fe0a0',
  '#6fd3e8',
  '#8fb6ff',
];

/**
 * 把一个代表色摊成六段明暗变体。
 *
 * 不是简单地调亮度：**相邻两段要一亮一暗交替**，否则六段挤在一起看不出条带，
 * 只是一块被切成六份的同一个颜色。
 */
export function bandPalette(hex: string): readonly [string, string, string, string, string, string] {
  const value = hex.replace('#', '');
  if (value.length !== 6) {
    return TG_PALETTE;
  }
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);

  const mix = (amount: number): string => {
    // amount > 0 往白走，< 0 往黑走
    const target = amount >= 0 ? 255 : 0;
    const t = Math.abs(amount);
    const channel = (base: number): number => Math.round(base + (target - base) * t);
    return `#${[channel(r), channel(g), channel(b)]
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')}`;
  };

  /*
    明暗**必须拉开**。第一版取的是 0.45 / -0.25 / 0.15 / -0.05 / 0.6 / -0.15，
    相邻两段几乎同色，叠出来是一块被切成六份的同一个颜色——
    在卡面上读不到任何条带。现在一亮一暗交替，落差也加大。
  */
  return [
    mix(0.75),
    mix(-0.55),
    mix(0.35),
    mix(-0.3),
    mix(0.9),
    mix(-0.45),
  ];
}

export function foilForRarity(rarity: CardRarity, rarityColor: string): FoilSpec {
  const kind = foilKindForRarity(rarity);
  return {
    kind,
    strength: foilStrengthForRarity(rarity),
    geometry: GEOMETRY[kind],
    palette: kind === 'tg' ? TG_PALETTE : bandPalette(rarityColor),
    rainbow: kind === 'tg',
  };
}

/**
 * 一次检视的状态。
 *
 * **两个渲染端都产出这一组**：3D 卡由视线方向在卡面局部坐标下的投影算出，
 * 展示位由鼠标在卡面上的位置算出。物理来源不同，下游用法完全一样。
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

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * 从指针在卡面上的归一化位置（0..1）推出检视状态。
 *
 * 两项映射是这套观感的关键，写在这里而不是散在组件里：
 *
 * 1. **色带的位移比指针的位移小得多**（压到 ±13%）。指针划过整张卡时
 *    色带若跟着跑满全程，看起来是「背景图在平移」；压窄之后才是「反光扫过」。
 * 2. **越靠边越亮**。参考展示页就是按「距中心多远」调亮度的——
 *    这既是物理（斜看时反射更强），也是让玩家有「我在照这张卡」的反馈。
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
    // 指针在正中时最「正对」，越靠边越像斜着看
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
