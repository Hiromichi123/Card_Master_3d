import { describe, expect, it } from 'vitest';
import { ABYSS_WEEK_MS, formatAbyssCountdown, nextAbyssSettlement } from '../../src/domain/progression/abyss';

const ms = (value: string) => new Date(value).getTime();

describe('深渊UTC+8周一04:00倒计时', () => {
  it('UTC周日20:00是结算线，截止前1ms仍是本周，到点及之后立刻是下一周', () => {
    const deadline = ms('2026-10-11T20:00:00Z');
    expect(nextAbyssSettlement(deadline - 1)).toBe(deadline);
    expect(nextAbyssSettlement(deadline)).toBe(deadline + ABYSS_WEEK_MS);
    expect(nextAbyssSettlement(deadline + 1)).toBe(deadline + ABYSS_WEEK_MS);
    expect(formatAbyssCountdown(nextAbyssSettlement(deadline) - deadline)).toBe('7天 00:00:00');
  });
  it('同一绝对时刻无论UTC/UTC+8/其他偏移写法都得到同一目标，不用本机时区', () => {
    const inputs = ['2026-10-11T19:59:59Z', '2026-10-12T03:59:59+08:00', '2026-10-11T15:59:59-04:00'];
    expect(new Set(inputs.map(value => nextAbyssSettlement(ms(value))))).toEqual(new Set([ms('2026-10-11T20:00:00Z')]));
  });
  it('跨月、跨年和夏令时地区仍为固定UTC+8', () => {
    expect(nextAbyssSettlement(ms('2026-12-31T23:59:59Z'))).toBe(ms('2027-01-03T20:00:00Z'));
    expect(nextAbyssSettlement(ms('2026-10-31T23:00:00Z'))).toBe(ms('2026-11-01T20:00:00Z'));
    expect(nextAbyssSettlement(ms('2026-03-08T19:00:00Z'))).toBe(ms('2026-03-08T20:00:00Z'));
  });
  it('秒数向上取整，不提前显示零；负值与坏持续时间不会出现负数或NaN', () => {
    expect(formatAbyssCountdown(1)).toBe('0天 00:00:01');
    expect(formatAbyssCountdown(3_661_000)).toBe('0天 01:01:01');
    expect(formatAbyssCountdown(-1)).toBe('0天 00:00:00');
    expect(formatAbyssCountdown(NaN)).toBe('0天 00:00:00');
    expect(() => nextAbyssSettlement(NaN)).toThrow(RangeError);
  });
});
