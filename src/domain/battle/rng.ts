import type { RngState } from './types';

/**
 * 带 seed 的伪随机数发生器。
 *
 * 用 mulberry32：状态只有一个 32 位整数，可以整体塞进 `BattleState` 里，
 * 于是「同 seed 同命令序列必须得到同一局」这件事是可以**存档与回放**的
 * （PLAN 第 4.2 节）。同 seed 的两次对局必须逐事件一致，
 * 所以这里绝不能用 `Math.random()`。
 *
 * 规则随机与表现随机是**两条独立的线**：粒子、抖动、镜头反馈用另一套源，
 * 画质档与帧率因此不可能反向影响闪避判定或目标选择。
 */

/** 一个随机器实例。每次取数都会推进内部状态。 */
export interface Rng {
  /** 取 [0, 1) 的浮点。 */
  next(): number;
  /** 取 [min, max] 的整数（含两端）。 */
  int(min: number, max: number): number;
  /** 以概率 p 返回 true。p <= 0 恒 false，p >= 1 恒 true。 */
  chance(p: number): boolean;
  /** 从非空数组里等概率取一项。 */
  pick<T>(items: readonly T[]): T;
  /** 原地洗牌（Fisher–Yates）。 */
  shuffle<T>(items: T[]): T[];
  /** 导出状态，用于存档或复现。 */
  snapshot(): RngState;
}

/** mulberry32。常数取自作者公开的实现，周期 2^32。 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  let draws = 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    draws += 1;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (max < min) {
      throw new Error(`rng.int 的区间非法：${min}..${max}`);
    }
    return min + Math.floor(next() * (max - min + 1));
  };

  return {
    next,
    int,
    chance: (p) => (p <= 0 ? false : p >= 1 ? true : next() < p),
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new Error('rng.pick 不能在空数组上调用');
      }
      return items[int(0, items.length - 1)] as T;
    },
    shuffle<T>(items: T[]): T[] {
      for (let i = items.length - 1; i > 0; i -= 1) {
        const j = int(0, i);
        const a = items[i] as T;
        const b = items[j] as T;
        items[i] = b;
        items[j] = a;
      }
      return items;
    },
    snapshot: () => ({ state, draws }),
  };
}

/** 从一个状态快照恢复。用于读档后继续同一局。 */
export function restoreRng(snapshot: RngState): Rng {
  const rng = createRng(0);
  let state = snapshot.state >>> 0;
  let draws = snapshot.draws;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    draws += 1;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    ...rng,
    next,
    snapshot: () => ({ state, draws }),
  };
}

/**
 * 由字符串派生种子。
 *
 * 同一个牌组 / 关卡名总是给出同一局，便于复现问题。
 */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
