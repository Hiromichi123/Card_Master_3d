import { describe, expect, it } from 'vitest';
import { collectionCompletion } from '../../src/domain/progression/collection';
import { LEADERBOARD_DEMOS, leaderboardEntries, leaderboardPage, sortLeaderboard, type LeaderboardEntry } from '../../src/domain/progression/leaderboard';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { cardDatabase } from '../../src/data';

const profile = () => createInitialProfile({ contentVersion: 'test', dayKey: '20261011', starterCardIds: [], now: new Date('2026-10-11T12:00:00Z') });
const definitions = [
  { cardId: 'one', status: 'complete' as const }, { cardId: 'one', status: 'complete' as const },
  { cardId: 'two', status: 'complete' as const },
];
const entry = (id: string, points: number, ratio: number, isSelf = false): LeaderboardEntry =>
  ({ id, name: id, points, ratio, owned: ratio * 100, total: 100, isSelf });

describe('共享收藏拥有率', () => {
  it('定义ID去重，重复库存只算一种，未知/零库存不参与', () => {
    expect(collectionCompletion({ one: 99, two: 0, unknown: 88 }, definitions)).toEqual({ owned: 1, total: 2, ratio: .5 });
    expect(collectionCompletion({ one: 1, two: 1 }, definitions)).toEqual({ owned: 2, total: 2, ratio: 1 });
    expect(collectionCompletion({ one: 1 }, [])).toEqual({ owned: 0, total: 0, ratio: 0 });
  });
  it('排除不完整定义，活动完整卡照算', () => {
    const complete = cardDatabase.definitions.find(card => card.status === 'complete')!;
    const incomplete = { ...complete, cardId: 'incomplete', status: 'incomplete' as const };
    const event = { ...complete, cardId: '#event_001' };
    expect(collectionCompletion({ [complete.cardId]: 3, incomplete: 8, '#event_001': 2 }, [complete, incomplete, event]))
      .toEqual({ owned: 2, total: 2, ratio: 1 });
  });
});

describe('本地演示排行榜', () => {
  it('20个固定虚拟账号与本人组成21条，重开稳定，同名不合并', () => {
    const rows = leaderboardEntries(profile(), cardDatabase.definitions, LEADERBOARD_DEMOS[0].name);
    expect(LEADERBOARD_DEMOS).toHaveLength(20);
    expect(rows).toHaveLength(21);
    expect(new Set(rows.map(row => row.id)).size).toBe(21);
    expect(new Set(LEADERBOARD_DEMOS.map(row => row.name)).size).toBe(20);
    expect(rows.filter(row => row.isSelf)).toHaveLength(1);
    expect(rows).toEqual(leaderboardEntries(profile(), cardDatabase.definitions, LEADERBOARD_DEMOS[0].name));
    expect(rows.every(row => row.owned >= 0 && row.owned <= row.total && row.ratio >= 0 && row.ratio <= 1)).toBe(true);
  });
  it('本人使用当前积分和库存，更新库存后同步收藏；不固定排最后', () => {
    const base = profile();
    const current = { ...base, inventory: { one: 9 }, ladder: { ...base.ladder, points: 9999 } };
    const rows = leaderboardEntries(current, definitions, '本人');
    expect(rows.find(row => row.isSelf)).toMatchObject({ name: '本人', points: 9999, owned: 1, total: 2, ratio: .5 });
    expect(leaderboardPage(rows, 'ladder', 1).selfRank).toBe(1);
    expect(leaderboardEntries({ ...current, inventory: { one: 9, two: 1 } }, definitions).find(row => row.isSelf)!.ratio).toBe(1);
  });
  it('按原始比例排序，同值使用固定ID且不改源数组', () => {
    const rows = [entry('c', 100, .500001), entry('b', 100, .500002), entry('a', 100, .500002)];
    expect(sortLeaderboard(rows, 'collection').map(row => row.id)).toEqual(['a', 'b', 'c']);
    expect(sortLeaderboard(rows, 'ladder').map(row => row.id)).toEqual(['a', 'b', 'c']);
    expect(rows.map(row => row.id)).toEqual(['c', 'b', 'a']);
  });
  it.each([100, 101, 201])('%i条按100分页，名次为全局排序后索引', count => {
    const rows = Array.from({ length: count }, (_, index) => entry(`id-${index}`, count - index, index / count, index === count - 1));
    const first = leaderboardPage(rows, 'ladder', 1);
    expect(first.rows).toHaveLength(100);
    expect(first.pages).toBe(Math.ceil(count / 100));
    expect(first.selfRank).toBe(count);
    const last = leaderboardPage(rows, 'ladder', 999);
    expect(last.page).toBe(last.pages);
    expect(last.rows.at(-1)!.rank).toBe(count);
    expect(last.rows.filter(row => row.isSelf)).toHaveLength(1);
    expect(last.rows.length).toBeLessThanOrEqual(100);
    expect(leaderboardPage(rows, 'ladder', -1).page).toBe(1);
    expect(leaderboardPage(rows, 'ladder', Number.NaN).page).toBe(1);
  });
  it('空榜与卡库安全返回0，不生成虚构页面', () => {
    expect(leaderboardPage([], 'collection', 2)).toEqual({ page: 1, pages: 1, total: 0, selfRank: null, rows: [] });
    expect(leaderboardEntries(profile(), []).every(row => row.ratio === 0 && row.total === 0)).toBe(true);
  });
});
