import { describe, expect, it } from 'vitest';
import { rarityList } from '../../src/data';
import { deckStrength, LADDER_TIERS, ladderProgress, ladderScorePreview, ladderTier } from '../../src/domain/progression/ladder';

const strength = (ids: readonly string[]) => deckStrength(ids, id => id === 'unknown' ? undefined : id, rarityList);

describe('天梯段位与积分预览', () => {
  it('每300分晋级，世界从2400开始，超出部分保留实际积分语义', () => {
    expect(LADDER_TIERS.map(t => t.floor)).toEqual([0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400]);
    for (let i = 0; i < LADDER_TIERS.length; i++) {
      const tier = LADDER_TIERS[i]!;
      expect(ladderTier(tier.floor)).toBe(tier);
      if (i > 0) expect(ladderTier(tier.floor - 1)).toBe(LADDER_TIERS[i - 1]);
    }
    expect(ladderTier(600).title).toBe('精英卡牌师');
    expect(ladderProgress(299).remaining).toBe(1);
    expect(ladderProgress(2700)).toMatchObject({ value: 2400, next: null, remaining: 0 });
    expect(ladderTier(2700).title).toBe('世界卡牌师');
    expect(new Set(LADDER_TIERS.map(t => t.color)).size).toBe(9);
  });

  it('低段加多扣少，高段相反，2v2两倍，实际扣分不低于0', () => {
    expect(ladderScorePreview(0, 'solo')).toEqual({ win: 30, loss: 0, ruleLoss: 5 });
    expect(ladderScorePreview(3, 'duo')).toEqual({ win: 60, loss: 3, ruleLoss: 10 });
    expect(ladderScorePreview(2400, 'solo')).toEqual({ win: 10, loss: 25, ruleLoss: 25 });
    expect(ladderScorePreview(2400, 'duo')).toEqual({ win: 20, loss: 50, ruleLoss: 50 });
    for (const tier of LADDER_TIERS) {
      const points = tier.floor + 100;
      const solo = ladderScorePreview(points, 'solo');
      const duo = ladderScorePreview(points, 'duo');
      expect(duo.win).toBe(solo.win * 2);
      expect(duo.loss).toBe(solo.loss * 2);
    }
  });
});

describe('天梯平均稀有度', () => {
  it('重复卡逐张计算，空槽不稀释，显示前不舍入', () => {
    expect(strength(['D']).average).toBe(1);
    expect(strength(['D', 'SSS', 'SSS']).average).toBe(5);
    expect(strength(['D', 'C', 'C']).average).toBe(5 / 3);
    expect(strength(['SS+']).average).toBe(6.5);
    expect(strength(['A+']).average).toBe(4.5);
  });

  it('活动卡使用level，不用在图鉴中的排序', () => {
    expect(strength(['#elna']).average).toBe(7);
    expect(strength(['#yoroi']).average).toBe(4);
    expect(strength(['#elna', '#yoroi']).average).toBe(5.5);
  });

  it('颜色在普通稀有度锚点之间插值', () => {
    expect(strength(['D']).color).toBe('#808080');
    expect(strength(['SSS']).color).toBe('#ff0000');
    const middle = strength(['D', 'C']);
    expect(middle.average).toBe(1.5);
    expect(middle.color).toBe('#40c040');
    expect(middle.label).toBe('D — C');
    expect(middle.gradient).toContain('#808080, #00ff00');
  });

  it('空组和异常卡不产出虚假强度', () => {
    expect(strength([])).toMatchObject({ average: null, label: '未配置' });
    expect(strength(['SSS', 'unknown'])).toMatchObject({ average: null, label: '无法评估', invalidCardIds: ['unknown'] });
    expect(strength(['not-a-rarity']).average).toBeNull();
  });
});
