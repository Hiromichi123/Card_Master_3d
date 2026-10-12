import type { CardDefinition } from '../cards/types';
import { abyssBestOf } from './abyssRanking';
import { collectionCompletion } from './collection';
import type { ProfileState } from './types';

export type LeaderboardKind = 'ladder' | 'collection' | 'abyss';
export interface LeaderboardEntry {
  readonly id: string;
  readonly name: string;
  readonly points: number;
  readonly owned: number;
  readonly total: number;
  readonly ratio: number;
  readonly isSelf: boolean;
  readonly abyssCleared?: number;
  readonly abyssWins?: number;
}
export const LEADERBOARD_PAGE_SIZE = 100;

/** 展示样本，不注册账号、不参与存档或真实匹配。比例用万分数固定，不随本人变化。 */
export const LEADERBOARD_DEMOS = [
  { id: 'demo-01', name: '星河拾梦', points: 2870, collectionBasisPoints: 9725 },
  { id: 'demo-02', name: '白昼旅人', points: 2560, collectionBasisPoints: 8140 },
  { id: 'demo-03', name: '暮光咏者', points: 2385, collectionBasisPoints: 9390 },
  { id: 'demo-04', name: '月下藏书家', points: 2170, collectionBasisPoints: 9950 },
  { id: 'demo-05', name: '赤砂之刃', points: 2030, collectionBasisPoints: 7280 },
  { id: 'demo-06', name: '雾海听潮', points: 1855, collectionBasisPoints: 8670 },
  { id: 'demo-07', name: '流萤织梦', points: 1740, collectionBasisPoints: 6560 },
  { id: 'demo-08', name: '霜叶守望', points: 1595, collectionBasisPoints: 7830 },
  { id: 'demo-09', name: '金枝小鹿', points: 1480, collectionBasisPoints: 5940 },
  { id: 'demo-10', name: '远山来客', points: 1320, collectionBasisPoints: 6960 },
  { id: 'demo-11', name: '墨羽行舟', points: 1210, collectionBasisPoints: 5480 },
  { id: 'demo-12', name: '风铃草', points: 1150, collectionBasisPoints: 6250 },
  { id: 'demo-13', name: '夜航灯塔', points: 965, collectionBasisPoints: 4820 },
  { id: 'demo-14', name: '琥珀猫', points: 840, collectionBasisPoints: 4310 },
  { id: 'demo-15', name: '青苔石阶', points: 715, collectionBasisPoints: 3790 },
  { id: 'demo-16', name: '云端邮差', points: 630, collectionBasisPoints: 3250 },
  { id: 'demo-17', name: '松果骑士', points: 490, collectionBasisPoints: 2780 },
  { id: 'demo-18', name: '雨后晴空', points: 335, collectionBasisPoints: 2160 },
  { id: 'demo-19', name: '初雪纸鸢', points: 185, collectionBasisPoints: 1540 },
  { id: 'demo-20', name: '小小启明星', points: 40, collectionBasisPoints: 860 },
] as const;

export function leaderboardEntries(
  profile: ProfileState,
  definitions: readonly Pick<CardDefinition, 'cardId' | 'status'>[],
  playerName = '当前玩家',
): readonly LeaderboardEntry[] {
  const completion = collectionCompletion(profile.inventory, definitions);
  const demos = LEADERBOARD_DEMOS.map((demo, index) => {
    const owned = Math.floor(completion.total * demo.collectionBasisPoints / 10_000);
    return { id: demo.id, name: demo.name, points: demo.points, owned, total: completion.total,
      ratio: completion.total ? owned / completion.total : 0, isSelf: false,
      abyssCleared: 65 - index * 3, abyssWins: 65 - index * 3 - index % 3 };
  });
  const best = abyssBestOf(profile.abyss);
  return [...demos, { id: 'self', name: playerName, points: profile.ladder.points, ...completion, isSelf: true,
    abyssCleared: best?.cleared ?? 0, abyssWins: best?.wins ?? 0 }];
}

export function sortLeaderboard(entries: readonly LeaderboardEntry[], kind: LeaderboardKind): readonly LeaderboardEntry[] {
  return [...entries].sort((a, b) => (kind === 'ladder' ? b.points - a.points : kind === 'collection' ? b.ratio - a.ratio
    : (b.abyssCleared ?? 0) - (a.abyssCleared ?? 0) || (b.abyssWins ?? 0) - (a.abyssWins ?? 0))
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function leaderboardPage(entries: readonly LeaderboardEntry[], kind: LeaderboardKind, requestedPage: number) {
  const sorted = sortLeaderboard(entries, kind);
  const pages = Math.max(1, Math.ceil(sorted.length / LEADERBOARD_PAGE_SIZE));
  const page = Math.max(1, Math.min(pages, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1));
  const offset = (page - 1) * LEADERBOARD_PAGE_SIZE;
  const selfIndex = sorted.findIndex(entry => entry.isSelf);
  return { page, pages, total: sorted.length, selfRank: selfIndex < 0 ? null : selfIndex + 1,
    rows: sorted.slice(offset, offset + LEADERBOARD_PAGE_SIZE).map((entry, index) => ({ ...entry, rank: offset + index + 1 })) };
}
