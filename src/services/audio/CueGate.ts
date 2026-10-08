import { CUE_POLICIES, type SoundCue } from './cues';

/**
 * 音效限流器。**纯函数式**：状态由调用方拿着（一个 `Map<SoundCue, GateState>`），
 * 于是「一帧 40 次命中」这类极端输入可以在 node 里逐帧断言，不需要真的开音频。
 *
 * 主策略是**合并而非丢弃**——见 `CUE_POLICIES` 的注释。
 */

export interface GateState {
  /** 上一次出声（独立或合并）的时间。 */
  lastAt: number;
  /** 当前计数窗口的起点。 */
  windowStart: number;
  /** 当前窗口内的独立声部数。 */
  windowCount: number;
  /** 上一次「合并声」的时间。 */
  mergedAt: number;
}

export type Admission = { readonly kind: 'play' } | { readonly kind: 'merge' } | null;

const EMPTY: GateState = {
  lastAt: Number.NEGATIVE_INFINITY,
  windowStart: Number.NEGATIVE_INFINITY,
  windowCount: 0,
  mergedAt: Number.NEGATIVE_INFINITY,
};

export function createGates(): Map<SoundCue, GateState> {
  return new Map();
}

export function resetGates(gates: Map<SoundCue, GateState>): void {
  gates.clear();
}

/**
 * 判定这一声该不该出声。
 *
 * - `{kind:'play'}` —— 独立声部；
 * - `{kind:'merge'}` —— 合并成一声更响的（依然出声）；
 * - `null` —— 丢弃。两种情况会走到这里：连合并都还太近（冷却之内），
 *   以及**合并本身没有意义**的 cue（`mergeGain <= 1`，例如融合那 700ms 的扫频——
 *   把两声融合叠成「更响的一声」是错的，它只该响一次）。
 */
export function admit(
  gates: Map<SoundCue, GateState>,
  cue: SoundCue,
  nowMs: number,
): Admission {
  const policy = CUE_POLICIES[cue];
  const state = gates.get(cue) ?? { ...EMPTY, windowStart: nowMs };
  gates.set(cue, state);

  if (nowMs - state.windowStart > policy.windowMs) {
    state.windowStart = nowMs;
    state.windowCount = 0;
  }

  const tooSoon = nowMs - state.lastAt < policy.minGapMs;
  const overBudget = state.windowCount >= policy.windowMax;

  if (tooSoon || overBudget) {
    // 合并无意义的 cue 直接丢弃
    if (policy.mergeGain <= 1) {
      return null;
    }
    if (nowMs - state.mergedAt < policy.cooldownMs) {
      return null;
    }
    state.mergedAt = nowMs;
    state.lastAt = nowMs;
    state.windowCount += 1;
    return { kind: 'merge' };
  }

  state.lastAt = nowMs;
  state.windowCount += 1;
  return { kind: 'play' };
}
