import { Vector3 } from 'three';

/**
 * 位移与姿态的公共计算。
 *
 * 这些是「出牌、部署、抽卡、还魂」都要用的同几条曲线，
 * 写在公共模块里，避免每个场景各写一遍（`V-CARD-8`）。
 *
 * 所有函数都**避免在调用点新建对象**：把结果写进调用方传入的 `out`。
 * `useFrame` 里每帧 new 一个 Vector3 是 R3F 的典型性能陷阱。
 */

/**
 * 阻尼跟随。
 *
 * `lambda` 越大越跟手。用指数形式而不是线性逼近，
 * 好处是**与帧率无关**——同样的 lambda 在 60Hz 与 144Hz 下收敛速度一致。
 */
export function damp(current: number, target: number, lambda: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}

/**
 * 弧线位移：从 `from` 到 `to`，在中点抬高 `height`。
 *
 * 用抛物线 `4t(1-t)`：t=0 与 t=1 时高度为 0，t=0.5 时恰为 `height`。
 */
export function arcPosition(
  from: Vector3,
  to: Vector3,
  height: number,
  t: number,
  out: Vector3,
): Vector3 {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  out.lerpVectors(from, to, clamped);
  out.y += 4 * clamped * (1 - clamped) * height;
  return out;
}

/**
 * 翻牌角度。
 *
 * 绕卡牌自身的长轴旋转 `progress * π`：0 是正面朝上，1 是背面朝上。
 * 中途（0.5）卡面会侧对相机、宽度趋近 0，这才是「翻过去」而不是「换个贴图」。
 */
export function flipAngle(progress: number): number {
  return progress * Math.PI;
}

/**
 * 落地提示的缩放：从 `from` 落到 1，带轻微过冲。
 * 过冲由调用方传入的缓动负责，这里只做插值。
 */
export function landingScale(from: number, eased: number): number {
  return from + (1 - from) * eased;
}
