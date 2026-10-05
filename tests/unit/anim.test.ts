import { describe, expect, it } from 'vitest';

import { clamp01, cubicBezier, easeInOutCubic, easeOutBack, linear } from '../../src/rendering/anim/easings';
import { arcPosition, damp, flipAngle, landingScale } from '../../src/rendering/anim/motion';
import { Timeline } from '../../src/rendering/anim/Timeline';

/**
 * 公共动画工具的单元测试。
 *
 * 这些是纯函数与纯状态机，不需要浏览器——放在这里比用截图验证快得多，
 * 也更能定位问题。3D 那边的浏览器用例只验「最终状态正确」，不验曲线形状。
 */

describe('缓动函数', () => {
  it('端点固定为 0 与 1', () => {
    for (const easing of [linear, easeInOutCubic, easeOutBack]) {
      expect(easing(0)).toBeCloseTo(0, 6);
      expect(easing(1)).toBeCloseTo(1, 6);
    }
  });

  it('clamp01 把越界值压回区间', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(9)).toBe(1);
  });

  it('三次贝塞尔在端点与单调性上表现正确', () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let previous = 0;
    for (let i = 1; i <= 10; i += 1) {
      const value = ease(i / 10);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = value;
    }
  });
});

describe('位移与姿态', () => {
  it('damp 收敛到目标，且与步长无关', () => {
    // 同样的 lambda 与总时长，分成多少步都应落到同一位置
    const oneBigStep = damp(0, 1, 8, 0.1);
    let stepped = 0;
    for (let i = 0; i < 10; i += 1) {
      stepped = damp(stepped, 1, 8, 0.01);
    }
    expect(stepped).toBeCloseTo(oneBigStep, 6);
  });

  it('弧线在两端贴合，中点恰好抬高 height', () => {
    const from = { x: 0, y: 0, z: 0 } as never;
    // 用最小接口模拟 Vector3 的 lerpVectors 行为
    const out = {
      x: 0,
      y: 0,
      z: 0,
      lerpVectors(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, t: number) {
        this.x = a.x + (b.x - a.x) * t;
        this.y = a.y + (b.y - a.y) * t;
        this.z = a.z + (b.z - a.z) * t;
        return this;
      },
    };
    const to = { x: 4, y: 0, z: 2 } as never;

    arcPosition(from, to, 1.5, 0, out as never);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.x).toBeCloseTo(0, 6);

    arcPosition(from, to, 1.5, 0.5, out as never);
    expect(out.y).toBeCloseTo(1.5, 6);
    expect(out.x).toBeCloseTo(2, 6);

    arcPosition(from, to, 1.5, 1, out as never);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.x).toBeCloseTo(4, 6);
  });

  it('翻面角度是半圈', () => {
    expect(flipAngle(0)).toBeCloseTo(0, 6);
    expect(flipAngle(1)).toBeCloseTo(Math.PI, 6);
    expect(flipAngle(0.5)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('落地缩放从起始值插值到 1', () => {
    expect(landingScale(0.6, 0)).toBeCloseTo(0.6, 6);
    expect(landingScale(0.6, 1)).toBeCloseTo(1, 6);
  });
});

describe('Timeline', () => {
  it('按顺序推进并在结束时回调', () => {
    const order: string[] = [];
    const timeline = new Timeline(() => order.push('done'));
    timeline.add({
      duration: 0.5,
      onStart: () => order.push('a:start'),
      onComplete: () => order.push('a:end'),
    });
    timeline.add({
      duration: 0.5,
      onStart: () => order.push('b:start'),
      onComplete: () => order.push('b:end'),
    });

    timeline.update(0.25);
    expect(order).toEqual(['a:start']);
    timeline.update(0.5);
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
    timeline.update(0.5);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'done']);
    expect(timeline.isFinished).toBe(true);
  });

  it('一帧内跨多个步骤也不会漏掉回调', () => {
    const hits: number[] = [];
    const timeline = new Timeline();
    for (let i = 0; i < 3; i += 1) {
      timeline.add({ duration: 0.1, onComplete: () => hits.push(i) });
    }
    // 一帧推进 0.35s，跨过全部三个步骤
    timeline.update(0.35);
    expect(hits).toEqual([0, 1, 2]);
    expect(timeline.isFinished).toBe(true);
  });

  it('skipToEnd 与逐步跑完的结果一致', () => {
    /**
     * 这是施工清单要求的核心性质：跳过演出之后结果必须与正常播放相同。
     * 只把计时器拨到末尾是不够的——必须补发 onUpdate(1) 与 onComplete。
     */
    const run = (skip: boolean): unknown[] => {
      const log: unknown[] = [];
      const timeline = new Timeline();
      timeline.add({ duration: 0.3, onUpdate: (t) => log.push(['a', t]), onComplete: () => log.push(['a:end']) });
      timeline.add({ duration: 0.3, onUpdate: (t) => log.push(['b', t]), onComplete: () => log.push(['b:end']) });
      timeline.add({ duration: 0.3, onUpdate: (t) => log.push(['c', t]), onComplete: () => log.push(['c:end']) });

      if (skip) {
        timeline.skipToEnd();
      } else {
        for (let i = 0; i < 20; i += 1) {
          timeline.update(0.05);
        }
      }

      // 只比较「完成事件」与每个步骤的**末值**：逐步跑会产生大量中间帧
      const lastPerStep = new Map<string, number>();
      for (const entry of log as [string, number][]) {
        if (entry.length === 2) {
          lastPerStep.set(entry[0]!, entry[1]!);
        }
      }
      return [
        log.filter((e) => Array.isArray(e) && String(e[0]).endsWith(':end')),
        [...lastPerStep.entries()].sort(),
      ];
    };

    expect(run(true)).toEqual(run(false));
  });

  it('skipToEnd 在未开始时也能正确收尾', () => {
    const events: string[] = [];
    const timeline = new Timeline(() => events.push('done'));
    timeline.add({ duration: 1, onStart: () => events.push('start'), onComplete: () => events.push('end') });
    timeline.skipToEnd();
    expect(events).toEqual(['start', 'end', 'done']);
    expect(timeline.isFinished).toBe(true);
  });

  it('结束后再 update 不产生副作用', () => {
    const events: string[] = [];
    const timeline = new Timeline();
    timeline.add({ duration: 0.2, onComplete: () => events.push('once') });
    timeline.update(0.5);
    timeline.update(0.5);
    expect(events).toEqual(['once']);
  });
});
