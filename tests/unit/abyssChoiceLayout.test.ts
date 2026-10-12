import { describe, expect, it } from 'vitest';
import type { AbyssCard, AbyssGrowthOption } from '../../src/domain/progression/abyssTypes';
import { choiceNeedsTarget, choicePartyHit, choicePartyLayout, starterChoicePositions } from '../../src/scenes/abyssChoiceLayout';

describe('深渊盘面编组与拖放命中', () => {
  it('上组3列2行，下方两组各2列3行，各自六卡互不重叠', () => {
    const groups = [0, 1, 2].map(starterChoicePositions);
    expect(new Set(groups[0]!.map(point => point[0])).size).toBe(3);
    expect(new Set(groups[0]!.map(point => point[2])).size).toBe(2);
    for (const group of groups.slice(1)) {
      expect(new Set(group.map(point => point[0])).size).toBe(2);
      expect(new Set(group.map(point => point[2])).size).toBe(3);
    }
    const points = groups.flat();
    expect(points).toHaveLength(18);
    expect(new Set(points.map(point => `${point[0]}:${point[2]}`)).size).toBe(18);
    expect(Math.max(...groups[0]!.map(point => point[2]))).toBeLessThan(Math.min(...groups[1]!.map(point => point[2])));
  });
  it('十二张目标牌分为两行，命中独立卡位，行列间隙和盘外不选目标', () => {
    const cards = Array.from({ length: 12 }, (_, i) => ({ instanceId: `card-${i}` })) as AbyssCard[];
    const layout = choicePartyLayout(cards);
    expect(new Set(layout.map(pose => pose.position[2])).size).toBe(2);
    for (const pose of layout) expect(choicePartyHit(pose.position, layout)).toBe(pose.id);
    const first = layout[0]!, next = layout[1]!;
    expect(choicePartyHit([(first.position[0] + next.position[0]) / 2, .65, first.position[2]], layout)).toBeNull();
    expect(choicePartyHit([99, .65, 99], layout)).toBeNull();
  });
  it('空目标列表、奇数尾行居中，结晶与未满编招募无需目标', () => {
    expect(choicePartyHit([0, .65, 0], [])).toBeNull();
    const layout = choicePartyLayout(Array.from({ length: 7 }, (_, i) => ({ instanceId: `${i}` })) as AbyssCard[]);
    expect(layout[6]!.position[0]).toBe(0);
    expect(choiceNeedsTarget({ kind: 'crystal', label: '结晶' }, 12)).toBe(false);
    const recruit = { kind: 'recruit' } as AbyssGrowthOption;
    expect(choiceNeedsTarget(recruit, 11)).toBe(false);
    expect(choiceNeedsTarget(recruit, 12)).toBe(true);
    expect(choiceNeedsTarget({ kind: 'atk', label: '攻击', amount: 1 }, 6)).toBe(true);
  });
});
