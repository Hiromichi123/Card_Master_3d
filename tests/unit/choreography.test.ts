/**
 * 抽卡演出的编排。
 *
 * 这一层能在 node 里测，正是把它从 3D 里拆出来的理由：
 * 「十张一起翻」「跳过之后没播完」「高亮卡有两张」这类问题在画面上
 * 表现为「看着有点怪」，而在这里是**一句断言**。
 *
 * 断的是形状与不变量，不是具体数值：数值调一次就要改一遍用例，
 * 而不变量（单调、落位、时长差异、纯净性）才是这个模块的契约。
 */

import { describe, expect, it } from 'vitest';

import {
  CARD_ASPECT,
  FLIP_HIGH,
  SINGLE_CARD_SCALE,
  STAGGER,
  TEN_CARD_SCALE,
  backdropSize,
  buildChoreography,
  createCameraPose,
  createPose,
  dueBursts,
  frameDistance,
  gridSlots,
  sampleCamera,
  samplePose,
} from '../../src/rendering/gacha/choreography';
import type { GachaChoreography } from '../../src/rendering/gacha/choreography';

/** 稀有度顺序假装成「越小越稀有」，与 `rarityIndex.rankOf` 相反，正好检验调用方没搞反。 */
const RANKS: Record<string, number> = { D: 0, C: 1, B: 2, A: 3, S: 4, SS: 5, SSS: 6 };
const rankOf = (rarity: string): number => RANKS[rarity] ?? -1;
const isHigh = (rarity: string): boolean => (RANKS[rarity] ?? -1) >= 3;

function build(rarities: readonly string[]): GachaChoreography {
  return buildChoreography({
    cards: rarities.map((rarity, index) => ({ cardId: `card-${index}`, rarity })),
    rankOf,
    isHighRarity: isHigh,
    aspect: 16 / 9,
  });
}

const TEN_LOW = build(Array.from({ length: 10 }, () => 'D'));
const TEN_WITH_SSS = build(['D', 'C', 'D', 'SSS', 'C', 'D', 'D', 'C', 'D', 'D']);

describe('落位', () => {
  it('单抽一张在正中', () => {
    expect(gridSlots(1, 1)).toEqual([[0, 0]]);
  });

  it('十连是 5 列 2 行，位置两两不同', () => {
    const slots = gridSlots(10, TEN_CARD_SCALE);
    expect(slots).toHaveLength(10);
    const xs = new Set(slots.map((slot) => slot[0].toFixed(4)));
    const ys = new Set(slots.map((slot) => slot[1].toFixed(4)));
    expect(xs.size).toBe(5);
    expect(ys.size).toBe(2);
    expect(new Set(slots.map((slot) => `${slot[0]},${slot[1]}`)).size).toBe(10);
    // 关于原点对称
    expect(Math.max(...slots.map((s) => s[0]))).toBeCloseTo(
      -Math.min(...slots.map((s) => s[0])),
      6,
    );
  });
});

describe('采样：起手与收尾', () => {
  it('no paid cards appear before UI exit and camera pullback have completed', () => {
    const pose = createPose();
    for (let index = 0; index < TEN_LOW.shots.length; index++) {
      samplePose(TEN_LOW, index, 0, pose);
      expect(pose.visible).toBe(false);
      expect(pose.flip).toBe(1);
    }
  });

  it('**播完的那一刻每张都落位、正面朝上、原尺寸**——这就是「跳过 = 播完」', () => {
    const pose = createPose();
    TEN_LOW.shots.forEach((shot, index) => {
      samplePose(TEN_LOW, index, TEN_LOW.total, pose);
      expect(pose.visible).toBe(true);
      expect(pose.position[0]).toBeCloseTo(shot.slot[0], 6);
      expect(pose.position[1]).toBeCloseTo(shot.slot[1], 6);
      expect(pose.position[2]).toBeCloseTo(0, 6);
      expect(pose.flip).toBe(0);
      expect(pose.scale).toBeCloseTo(TEN_LOW.cardScale, 6);
      expect(pose.rotationY).toBeCloseTo(0, 6);
    });
  });

  it('each face-down card starts above its own landing slot', () => {
    const pose = createPose();
    const first = TEN_LOW.shots[0]!;
    samplePose(TEN_LOW, 0, first.delay + 0.0001, pose);
    expect(pose.visible).toBe(true);
    expect(pose.position[0]).toBeCloseTo(first.slot[0]);
    expect(pose.position[1]).toBeGreaterThan(first.slot[1] + 2);
    expect(pose.flip).toBe(1);
  });

  it('the landing descends smoothly to the board before revealing', () => {
    const pose = createPose();
    const shot = TEN_LOW.shots[0]!;
    const at = (progress: number): number => {
      samplePose(TEN_LOW, 0, shot.delay + progress * shot.flight, pose);
      return pose.position[1];
    };
    expect(at(0)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(1));
    expect(at(1)).toBeCloseTo(shot.slot[1]);
    expect(pose.flip).toBe(1);
  });
});

describe('采样：翻面', () => {
  it('每张卡都从盖着翻到揭开，中途确实有一帧翻到一半', () => {
    const pose = createPose();
    for (let index = 0; index < 10; index += 1) {
      const shot = TEN_LOW.shots[index];
      if (!shot) {
        continue;
      }
      let previous = 1;
      let sawMidway = false;
      for (let step = 0; step <= 200; step += 1) {
        const elapsed = (TEN_LOW.total * step) / 200;
        samplePose(TEN_LOW, index, elapsed, pose);
        expect(pose.flip).toBeLessThanOrEqual(previous + 1e-9);
        if (pose.flip > 0.05 && pose.flip < 0.95) {
          sawMidway = true;
        }
        previous = pose.flip;
      }
      expect(sawMidway, `第 ${index} 张没有翻到中途，像是直接换了贴图`).toBe(true);
    }
  });

  it('高稀有的翻面更慢', () => {
    const high = TEN_WITH_SSS.shots.find((shot) => shot.high);
    const low = TEN_WITH_SSS.shots.find((shot) => !shot.high);
    expect(high?.flipDuration).toBe(FLIP_HIGH);
    expect(high?.flipDuration ?? 0).toBeGreaterThan(low?.flipDuration ?? 0);
  });
});

describe('错峰', () => {
  it('起飞与翻面都严格按顺序，间隔不小于 STAGGER 的九成', () => {
    for (let index = 1; index < TEN_LOW.shots.length; index += 1) {
      const previous = TEN_LOW.shots[index - 1];
      const current = TEN_LOW.shots[index];
      expect((current?.delay ?? 0) - (previous?.delay ?? 0)).toBeGreaterThanOrEqual(
        STAGGER * 0.9,
      );
      // 翻面顺序不许往回跳（列错峰会造出这种「逆序揭晓」）
      expect((current?.flipAt ?? 0) - (previous?.flipAt ?? 0)).toBeGreaterThan(0);
      expect((current?.burstAt ?? 0) - (previous?.burstAt ?? 0)).toBeGreaterThan(0);
    }
  });
});

describe('高亮卡', () => {
  it('全是低稀有就没有高亮', () => {
    expect(TEN_LOW.highlightIndex).toBeNull();
  });

  it('取稀有度最高的那一张', () => {
    expect(TEN_WITH_SSS.highlightIndex).toBe(3);
  });

  it('并列时取下标最小的——否则十张限定池会有十张要聚焦', () => {
    const allHigh = build(['SSS', 'SSS', 'SSS']);
    expect(allHigh.highlightIndex).toBe(0);
  });

  it('有高亮时整段更长（多出来的就是聚焦停留）', () => {
    expect(TEN_WITH_SSS.total).toBeGreaterThan(TEN_LOW.total);
  });

  it('有高亮时相机会推近再收回', () => {
    const focus = TEN_WITH_SSS.camera;
    expect(focus.length).toBeGreaterThan(2);
    const nearest = Math.min(...focus.map((key) => key.pose.position[2]));
    expect(nearest).toBeLessThan(TEN_WITH_SSS.cameraDistance * 0.9);
    const last = focus[focus.length - 1];
    expect(last?.pose.position[2]).toBeCloseTo(TEN_WITH_SSS.cameraDistance, 6);
  });
});

describe('纯函数', () => {
  it('同样的输入连着算两次，结果逐字段相同，且不依赖调用顺序', () => {
    const a = createPose();
    const b = createPose();
    samplePose(TEN_WITH_SSS, 3, 0.8, a);
    samplePose(TEN_WITH_SSS, 7, 0.2, b); // 中间插一次别的调用
    samplePose(TEN_WITH_SSS, 3, 0.8, b);
    expect(b).toEqual(a);
  });

  it('相机采样同样无状态', () => {
    const a = createCameraPose();
    const b = createCameraPose();
    sampleCamera(TEN_WITH_SSS, 1.3, a);
    sampleCamera(TEN_WITH_SSS, 0, b);
    sampleCamera(TEN_WITH_SSS, 1.3, b);
    expect(b).toEqual(a);
  });
});

describe('爆点', () => {
  it('整段跑完时每一张都恰好触发一次', () => {
    const all = dueBursts(TEN_LOW, 0, TEN_LOW.total);
    expect([...all].sort((x, y) => x - y)).toEqual(
      TEN_LOW.shots.map((shot) => shot.index),
    );
    expect(new Set(all).size).toBe(all.length);
  });

  it('跨帧不漏也不重发', () => {
    // 按 60fps 走一遍，收集到的应该和「一次给完」一样
    const seen: number[] = [];
    let previous = 0;
    for (let step = 1; step <= 120; step += 1) {
      const now = (TEN_LOW.total * step) / 120;
      seen.push(...dueBursts(TEN_LOW, previous, now));
      previous = now;
    }
    expect(seen.sort((x, y) => x - y)).toEqual(dueBursts(TEN_LOW, 0, TEN_LOW.total).slice().sort((x, y) => x - y));
  });

  it('很窄的区间只返回跨过它的那一个', () => {
    const burstAt = TEN_LOW.shots[0]?.burstAt ?? 0;
    expect(dueBursts(TEN_LOW, burstAt - 0.01, burstAt)).toEqual([0]);
    expect(dueBursts(TEN_LOW, burstAt, burstAt + 0.001)).toEqual([]);
  });
});

describe('取景', () => {
  it('内容越大、画面越窄，相机就得越远', () => {
    const base = frameDistance(6, 3, 42, 16 / 9);
    expect(frameDistance(9, 3, 42, 16 / 9)).toBeGreaterThan(base);
    expect(frameDistance(6, 5, 42, 16 / 9)).toBeGreaterThan(base);
    expect(frameDistance(6, 3, 42, 4 / 3)).toBeGreaterThan(base);
  });

  it('背景板足够盖住这个距离上的可视范围', () => {
    const distance = frameDistance(6, 3, 42, 16 / 9);
    const [width, height] = backdropSize(distance, 42, 16 / 9);
    expect(width).toBeGreaterThan(6);
    expect(height).toBeGreaterThan(3);
    expect(width / height).toBeCloseTo(16 / 9, 5);
  });
});

describe('卡面尺寸的约定', () => {
  it('单抽按卡的真实比例算（卡宽 : 卡高 = 1 : 1.5）', () => {
    const single = build(['D']);
    expect(single.content[1]).toBeCloseTo(SINGLE_CARD_SCALE * CARD_ASPECT, 6);
    expect(single.cardScale).toBe(SINGLE_CARD_SCALE);
  });

  it('十连的外接盒按「五列两行」算', () => {
    // 宽：4 个列距（1.16 倍卡宽）+ 一张卡宽
    expect(TEN_LOW.content[0]).toBeCloseTo(TEN_CARD_SCALE * (1 + 4 * 1.16), 6);
    // 高：一个行距（1.25 倍卡高）+ 一张卡高
    expect(TEN_LOW.content[1]).toBeCloseTo(TEN_CARD_SCALE * CARD_ASPECT * 2.25, 6);
    // 比单抽宽得多——相机因此要退得更远，这是取景拉远的主因
    expect(TEN_LOW.content[0]).toBeGreaterThan(build(['D']).content[0] * 2);
  });
});
