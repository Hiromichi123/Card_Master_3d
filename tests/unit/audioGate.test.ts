/**
 * 音效限流器（`src/services/audio/CueGate.ts`）。
 *
 * 这里要证的是「一帧几十次命中不会打爆节点」这条承诺的**可判定形式**：
 * 极端输入下，独立声部数不超过窗口预算，合并声不超过策略允许的次数，
 * 其余被丢弃。
 */

import { describe, expect, it } from 'vitest';

import { admit, BurstGate, createGates } from '../../src/services/audio/CueGate';
import { CUE_POLICIES, type SoundCue } from '../../src/services/audio/cues';

function run(cue: SoundCue, count: number, gapMs: number) {
  const gates = createGates();
  const result = { play: 0, merge: 0, drop: 0 };
  for (let i = 0; i < count; i += 1) {
    const admission = admit(gates, cue, i * gapMs);
    if (admission === null) {
      result.drop += 1;
    } else if (admission.kind === 'merge') {
      result.merge += 1;
    } else {
      result.play += 1;
    }
  }
  return result;
}

describe('音效限流', () => {
  it('新增攻击/施法同帧触发只响一次，不叠加合并增益', () => {
    for (const cue of ['uiClick', 'play', 'deploy', 'attack', 'slash', 'fire', 'ice', 'lightning', 'heal', 'shield', 'teleport'] as const) {
      expect(run(cue, 40, 0)).toEqual({ play: 1, merge: 0, drop: 39 });
    }
  });

  it('不同元素共享总预算，80ms内最多四声，复位后恢复', () => {
    const gate = new BurstGate();
    expect(Array.from({ length: 30 }, () => gate.admit(0)).filter(Boolean)).toHaveLength(4);
    expect(gate.admit(79)).toBe(false);
    expect(gate.admit(80)).toBe(true);
    gate.reset();
    expect(gate.admit(0)).toBe(true);
  });
  it('同一帧 40 次命中：独立声部受窗口预算约束，合并声不超过一次（冷却内）', () => {
    const policy = CUE_POLICIES.hit;
    const result = run('hit', 40, 0);
    expect(result.play).toBeLessThanOrEqual(policy.windowMax);
    expect(result.merge).toBeLessThanOrEqual(1);
    expect(result.play + result.merge + result.drop).toBe(40);
  });

  it('同一帧 40 次死亡只出声寥寥几次', () => {
    const policy = CUE_POLICIES.death;
    const result = run('death', 40, 0);
    expect(result.play).toBeLessThanOrEqual(policy.windowMax);
    expect(result.merge).toBeLessThanOrEqual(1);
  });

  it('稀疏的命中（间隔大于最小间隔）全部独立出声', () => {
    const policy = CUE_POLICIES.hit;
    const result = run('hit', 5, policy.minGapMs + policy.windowMs + 10);
    expect(result.play).toBe(5);
    expect(result.merge).toBe(0);
    expect(result.drop).toBe(0);
  });

  it('一次融合只响一声（哪怕连着调两次）', () => {
    const gates = createGates();
    expect(admit(gates, 'fusion', 0)?.kind).toBe('play');
    // 立刻再来一次：在最小间隔与冷却之内
    expect(admit(gates, 'fusion', 10)).toBeNull();
  });

  it('窗口滚动之后计数复位，可以再次独立出声', () => {
    const policy = CUE_POLICIES.hit;
    const gates = createGates();
    // 用满一个窗口
    for (let i = 0; i < policy.windowMax; i += 1) {
      expect(admit(gates, 'hit', i * (policy.minGapMs + 1))?.kind).toBe('play');
    }
    // 越过窗口 + 冷却之后，下一次又是独立声部
    const later = policy.windowMs + policy.minGapMs + policy.cooldownMs + 100;
    expect(admit(gates, 'hit', later)?.kind).toBe('play');
  });
});
