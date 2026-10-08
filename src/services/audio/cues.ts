/**
 * 音效词汇表与限流策略。
 *
 * **纯模块**：不 import DOM / three / React。这样 `presentation/director.ts`
 * 与 `presentation/session.ts` 可以只 `import type { SoundCue }`（编译后不产生
 * 运行时依赖），维持「会话层整局能在 node 里跑完」这条纪律——两张 node 测试网
 * 都会 import 这两个文件。
 */

/** 五类音效。这是全工程唯一的音效词汇表。 */
export type SoundCue = 'deal' | 'hit' | 'death' | 'gacha' | 'fusion';

/**
 * 单个 cue 的限流策略。
 *
 * 一次群体技能或**跳过模式**会在一帧之内落地几十次命中 / 若干次死亡
 * （`director.skipToEnd()` 会给每个未完成步骤补发 `onComplete`）。
 * 策略的目标是「读作一声更响更宽的碾压音」，而不是几十声刺耳叠加、也不是全静音。
 */
export interface CuePolicy {
  /** 两次同 cue 之间的最小间隔；之内一律合并。 */
  readonly minGapMs: number;
  /** 计数窗口。 */
  readonly windowMs: number;
  /** 一个窗口内最多几个独立声部，超出的走合并。 */
  readonly windowMax: number;
  /** 合并声的增益倍数（听起来是「很多下」，不是「一下」）。 */
  readonly mergeGain: number;
  /** 合并声自己的最小间隔，防止合并本身连发。 */
  readonly cooldownMs: number;
}

export const CUE_POLICIES: Record<SoundCue, CuePolicy> = {
  hit: { minGapMs: 40, windowMs: 120, windowMax: 3, mergeGain: 1.9, cooldownMs: 220 },
  death: { minGapMs: 60, windowMs: 200, windowMax: 2, mergeGain: 1.5, cooldownMs: 300 },
  gacha: { minGapMs: 90, windowMs: 400, windowMax: 4, mergeGain: 1.25, cooldownMs: 260 },
  deal: { minGapMs: 45, windowMs: 300, windowMax: 3, mergeGain: 1.4, cooldownMs: 300 },
  fusion: { minGapMs: 800, windowMs: 2000, windowMax: 1, mergeGain: 1, cooldownMs: 1500 },
};
