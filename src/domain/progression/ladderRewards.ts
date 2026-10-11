import { createRng, seedFrom } from '../battle/rng';
import type { CardDefinition, CardRarity } from '../cards/types';
import { reject, type Planned } from './plan';
import type { ProfileState } from './types';

export interface LadderReward {
  readonly floor: number;
  readonly crystals: number;
  readonly rarity: CardRarity;
  readonly count: number;
}

export const LADDER_REWARDS: readonly LadderReward[] = [
  { floor: 0, crystals: 100, rarity: 'B', count: 3 },
  { floor: 300, crystals: 200, rarity: 'B+', count: 3 },
  { floor: 600, crystals: 350, rarity: 'A', count: 3 },
  { floor: 900, crystals: 500, rarity: 'A+', count: 3 },
  { floor: 1200, crystals: 800, rarity: 'S', count: 3 },
  { floor: 1500, crystals: 1200, rarity: 'S+', count: 3 },
  { floor: 1800, crystals: 1800, rarity: 'SS', count: 3 },
  { floor: 2100, crystals: 2400, rarity: 'SS+', count: 3 },
  { floor: 2400, crystals: 3000, rarity: 'SSS', count: 5 },
];

export interface LadderRewardView {
  readonly floor: number;
  readonly crystals: number;
  readonly cards: readonly { readonly cardId: string; readonly count: number }[];
}

/** 每档一次，资源和领取账本由同一经济事务持久化。 */
export function planLadderRewardClaim(args: {
  readonly profile: ProfileState;
  readonly floor: number;
  readonly definitions: readonly CardDefinition[];
  readonly operationId: string;
}): Planned<LadderRewardView> {
  const { profile, floor } = args;
  const reward = LADDER_REWARDS.find(item => item.floor === floor);
  if (!reward) return reject('找不到这个段位的奖励');
  if (profile.ladder.claimedTierFloors.includes(floor)) return reject('这个段位的奖励已经领取');
  if (profile.ladder.points < floor) return reject(`达到 ${floor} 积分后才能领取`);
  const pool = [...new Set(args.definitions
    .filter(card => card.status === 'complete' && card.rarity === reward.rarity)
    .map(card => card.cardId))].sort();
  if (!pool.length) return reject(`${reward.rarity} 卡牌奖励暂不可用，领取资格已保留`);

  // 固定槽ID不会随切组、改牌或失败重试改变；operationId只作提交去重，不参与抽取。
  const rng = createRng(seedFrom(`ladder-reward:v1:${profile.ladder.deckId}:${floor}`));
  const inventoryDelta: Record<string, number> = {};
  for (let draw = 0; draw < reward.count; draw += 1) {
    const cardId = rng.pick(pool);
    inventoryDelta[cardId] = (inventoryDelta[cardId] ?? 0) + 1;
  }
  return {
    transaction: {
      operationId: args.operationId,
      currencyDelta: { crystal: reward.crystals },
      inventoryDelta,
      ladderRewardClaim: { floor, deckId: profile.ladder.deckId },
    },
    view: {
      floor, crystals: reward.crystals,
      cards: Object.entries(inventoryDelta).map(([cardId, count]) => ({ cardId, count })),
    },
  };
}
