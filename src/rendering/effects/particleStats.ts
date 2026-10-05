/**
 * 粒子运行统计。
 *
 * 刻意做成一个可变的小对象而不是 React 状态：它每帧都被写，
 * 走状态会触发每帧重渲染。需要读的地方（实验台、P7 的性能 HUD）
 * 自己按较低的频率采样。
 *
 * `docs/VISUAL_SPEC.md` 的 `V-PERF-1..3` 给各画质档定了活跃粒子上限，
 * 这个计数器就是校验它的手段。
 */
export const particleStats = {
  /** 当前存活粒子数。 */
  alive: 0,
  /** 池子容量（画质档决定）。 */
  capacity: 0,
  /** 帧内峰值，用于观察特效叠加时的瞬时压力。 */
  peak: 0,
};

export function resetParticlePeak(): void {
  particleStats.peak = 0;
}
