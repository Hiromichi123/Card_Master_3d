/**
 * 缓动函数。
 *
 * 只保留演出真正需要的几条，不引入缓动库（PLAN 第 2 节：避免多套时间轴/动画依赖）。
 * 所有函数定义域与值域都是 [0,1]，便于直接喂给插值。
 */

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;

export const easeInQuad: Easing = (t) => t * t;
export const easeOutQuad: Easing = (t) => 1 - (1 - t) * (1 - t);
export const easeInOutQuad: Easing = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic: Easing = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** 起步快、尾段非常缓，适合「归位」。 */
export const easeOutExpo: Easing = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** 轻微回弹，用于落地提示。 */
export const easeOutBack: Easing = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** 落地用：先过冲再稳住，且不越界太多。 */
export const easeOutBackSoft: Easing = (t) => {
  const c1 = 1.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** 三次贝塞尔，便于按需微调。 */
export function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number): Easing {
  // 牛顿迭代解 x(t)=input，再取 y(t)。对演出用途精度足够。
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const sampleDx = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;

  return (input) => {
    if (input <= 0) {
      return 0;
    }
    if (input >= 1) {
      return 1;
    }
    let t = input;
    for (let i = 0; i < 6; i += 1) {
      const x = sampleX(t) - input;
      if (Math.abs(x) < 1e-5) {
        break;
      }
      const d = sampleDx(t);
      if (Math.abs(d) < 1e-6) {
        break;
      }
      t -= x / d;
    }
    return sampleY(t);
  };
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
