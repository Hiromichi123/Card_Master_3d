/**
 * 卡池轮盘的计算。
 *
 * 断的是**环绕与吸附这两件容易写错的事**，不是「看起来转起来了」：
 * 转到头会不会绕回去、松手会不会停在两格中间、正中的那个到底是谁。
 * 这三件事错了，界面上表现为「轮盘转不动」或「高亮跳来跳去」，
 * 光看截图很难判断是计算错了还是样式错了。
 */

import { describe, expect, it } from 'vitest';

import {
  WHEEL_SPREAD_DEG,
  WHEEL_VISIBLE_DEG,
  activeIndex,
  normalizeDeg,
  snapOffset,
  stepOffset,
  wheelPeriod,
  wheelSlots,
} from '../../src/rendering/gacha/wheel';

const COUNT = 8;

describe('角度折返', () => {
  it('折到 (−180, 180]', () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(90)).toBe(90);
    expect(normalizeDeg(180)).toBe(180);
    expect(normalizeDeg(-180)).toBe(180);
    expect(normalizeDeg(540)).toBe(180);
    expect(normalizeDeg(-190)).toBe(170);
    expect(normalizeDeg(370)).toBe(10);
  });
});

describe('吸附', () => {
  it('取最近的一格', () => {
    expect(snapOffset(0, COUNT)).toBe(0);
    expect(snapOffset(14, COUNT)).toBe(0);
    expect(snapOffset(16, COUNT)).toBe(WHEEL_SPREAD_DEG);
    expect(snapOffset(29.9, COUNT)).toBe(WHEEL_SPREAD_DEG);
    expect(snapOffset(-14, COUNT)).toBe(0);
  });

  it('负数与超出一圈的值都能吸附回一个周期内', () => {
    expect(snapOffset(-1, COUNT)).toBe(0);
    // 8 × 30 = 240 是一圈：吸附到 240 等于回到原处
    expect(snapOffset(240, COUNT)).toBe(0);
    expect(snapOffset(-240, COUNT)).toBe(0);
    expect(Math.abs(snapOffset(-250, COUNT))).toBeLessThanOrEqual(
      wheelPeriod(COUNT) / 2,
    );
  });

  it('吸附之后正中那一个就是被吸附到的那一个', () => {
    for (let step = 0; step < COUNT; step += 1) {
      const offset = snapOffset(step * WHEEL_SPREAD_DEG + 9, COUNT);
      expect(activeIndex(COUNT, offset)).toBe(step);
    }
  });
});

describe('步进与环绕', () => {
  it('往后走一格是下一个，往回走一格是上一个', () => {
    expect(activeIndex(COUNT, stepOffset(0, COUNT, 1))).toBe(1);
    // **这条是环绕**：从第 0 个往前一格该落在第 7 个，不是 −1、也不是卡住
    expect(activeIndex(COUNT, stepOffset(0, COUNT, -1))).toBe(COUNT - 1);
  });

  it('连续往前走 count 次回到原处', () => {
    let offset = 0;
    for (let i = 0; i < COUNT; i += 1) {
      offset = stepOffset(offset, COUNT, 1);
    }
    expect(offset).toBe(0);
    expect(activeIndex(COUNT, offset)).toBe(0);
  });

  it('一直往回走也不越界（偏移量始终在一个周期内）', () => {
    let offset = 0;
    for (let i = 0; i < COUNT * 3; i += 1) {
      offset = stepOffset(offset, COUNT, -1);
      expect(Math.abs(offset)).toBeLessThanOrEqual(wheelPeriod(COUNT) / 2);
    }
  });
});

describe('摊开之后的位置', () => {
  it('正中的那个在原点、最大、最亮', () => {
    const slots = wheelSlots(COUNT, 0);
    const center = slots[0];
    expect(center?.angleDeg).toBe(0);
    expect(center?.active).toBe(true);
    expect(center?.x).toBe(0);
    expect(center?.z).toBe(0);
    expect(center?.scale).toBe(1);
    expect(center?.opacity).toBe(1);
  });

  it('左右对称：第 1 个和第 7 个角度相反、缩放相同', () => {
    const slots = wheelSlots(COUNT, 0);
    const right = slots[1];
    const left = slots[COUNT - 1];
    expect(left?.angleDeg).toBe(-(right?.angleDeg ?? 0));
    expect(left?.scale).toBeCloseTo(right?.scale ?? 0, 5);
    expect(left?.x).toBeCloseTo(-(right?.x ?? 0), 5);
  });

  it('越偏越小越暗，超过可见范围就不显示', () => {
    const slots = wheelSlots(COUNT, 0);
    const sorted = [...slots].sort(
      (a, b) => Math.abs(a.angleDeg) - Math.abs(b.angleDeg),
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      expect(current?.scale ?? 1).toBeLessThanOrEqual(previous?.scale ?? 0);
      expect(current?.opacity ?? 1).toBeLessThanOrEqual(previous?.opacity ?? 0);
    }
    for (const slot of slots) {
      if (Math.abs(slot.angleDeg) > WHEEL_VISIBLE_DEG) {
        expect(slot.opacity).toBe(0);
      }
    }
    /*
      8 个池、间隔 30°、周期 240°，角度是 0/±30/±60/±90/120——
      落在 ±75° 里的是 0、±30、±60 共 **5** 个，另外 3 个（±90、120）全暗。
      这一条同时说明「为什么屏幕上只看得到 5 个池」。
    */
    expect(slots.filter((slot) => slot.opacity > 0)).toHaveLength(5);
  });

  it('只有一个 active，且与 activeIndex 一致', () => {
    for (let step = 0; step < COUNT; step += 1) {
      const offset = step * WHEEL_SPREAD_DEG;
      const slots = wheelSlots(COUNT, offset);
      expect(slots.filter((slot) => slot.active)).toHaveLength(1);
      expect(slots.find((slot) => slot.active)?.index).toBe(activeIndex(COUNT, offset));
    }
  });

  it('转盘转起来之后每个池的角度整体平移', () => {
    const before = wheelSlots(COUNT, 0);
    const after = wheelSlots(COUNT, WHEEL_SPREAD_DEG);
    // 转一格之后，原来的第 1 个坐到了正中
    expect(after[1]?.angleDeg).toBe(0);
    expect(after[1]?.active).toBe(true);
    expect(before[1]?.active).toBe(false);
  });
});
