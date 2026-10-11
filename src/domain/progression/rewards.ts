import { seedFrom } from '../battle/rng';
import type { CardDefinition, CardRarity } from '../cards/types';
import { reject, type Planned } from './plan';
import { canCheckIn, CHECK_IN_LIMIT } from './rewardState';
import type { ProfileState } from './types';

export type RewardMode = 'story' | 'checkIn';
export type RewardKind = 'gold' | 'crystal' | 'card';
export interface RewardNode {
  readonly id: string;
  readonly label: string;
  readonly kind: RewardKind;
  readonly amount: number;
  readonly card: CardDefinition | null;
  readonly chapter: number | null;
  readonly day: number | null;
}
export interface RewardClaimView {
  readonly nodeId: string;
  readonly description: string;
}

const KINDS: readonly RewardKind[] = ['gold', 'crystal', 'card'];
const STORY_CARD_RARITIES: readonly CardRarity[] = ['B', 'A', 'S', 'SS', 'SSS'];
const DAILY_CARD_RARITIES: readonly CardRarity[] = ['C', 'C', 'C+', 'C+', 'B', 'B', 'B+', 'B+', 'A', 'A'];

/** Stable advertised cards, drawn only from complete standard cards; reopening never rerolls. */
function rewardCard(definitions: readonly CardDefinition[], rarity: CardRarity, key: string): CardDefinition | null {
  const candidates = definitions.filter(card => card.status === 'complete' && card.rarity === rarity)
    .sort((a, b) => a.cardId.localeCompare(b.cardId));
  return candidates.length ? candidates[seedFrom(key) % candidates.length] ?? null : null;
}

export function rewardNodes(mode: RewardMode, definitions: readonly CardDefinition[]): readonly RewardNode[] {
  const count = mode === 'story' ? 16 : CHECK_IN_LIMIT;
  return Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    const chapter = Math.floor(index / 4) + 1;
    const id = mode === 'story' ? `${chapter}-${index % 4 + 1}` : String(day);
    const kind = KINDS[index % 3] ?? 'gold';
    const cardOrdinal = Math.floor(index / 3);
    const rarity = mode === 'story' ? STORY_CARD_RARITIES[cardOrdinal] ?? 'SSS'
      : DAILY_CARD_RARITIES[cardOrdinal] ?? 'A';
    const amount = kind === 'card' ? 1 : mode === 'story'
      ? kind === 'gold' ? 300 + index * 100 : 30 + (index - 1) * 5
      : kind === 'gold' ? 100 + index * 10 : 10 + index - 1;
    return {
      id, label: mode === 'story' ? id : `第 ${day} 日`, kind, amount,
      card: kind === 'card' ? rewardCard(definitions, rarity, `hub-reward:${mode}:${id}`) : null,
      chapter: mode === 'story' ? chapter : null, day: mode === 'checkIn' ? day : null,
    };
  });
}

export function rewardDescription(node: RewardNode): string {
  if (node.kind === 'card') return node.card ? `${node.card.rarity} 卡牌 ×1 · ${node.card.name}` : '卡牌暂不可用';
  return `${node.kind === 'gold' ? '金币' : '水晶'} ×${node.amount}`;
}

export function rewardClaimed(profile: ProfileState, mode: RewardMode, node: RewardNode): boolean {
  return mode === 'story' ? profile.rewards.claimedStoryIds.includes(node.id)
    : profile.rewards.checkIn.some(record => record.day === node.day);
}

export function rewardAvailable(profile: ProfileState, mode: RewardMode, node: RewardNode, dayKey: string): boolean {
  if (rewardClaimed(profile, mode, node) || (node.kind === 'card' && !node.card)) return false;
  return mode === 'story' ? profile.campaign.clearedStages.includes(node.id)
    : node.day !== null && canCheckIn(profile.rewards, node.day, dayKey);
}

export function planRewardClaim(args: {
  readonly profile: ProfileState; readonly mode: RewardMode; readonly nodeId: string;
  readonly definitions: readonly CardDefinition[]; readonly dayKey: string; readonly operationId: string;
}): Planned<RewardClaimView> {
  // Resolve rewards from the schedule, never trust displayed amounts or a stale profile snapshot.
  const node = rewardNodes(args.mode, args.definitions).find(item => item.id === args.nodeId);
  if (!node) return reject('找不到这项奖励');
  if (rewardClaimed(args.profile, args.mode, node)) return reject('这项奖励已经领取');
  if (!rewardAvailable(args.profile, args.mode, node, args.dayKey)) {
    return reject(args.mode === 'story' ? '通关对应剧情关卡后才能领取' : '今天已签到，或尚未到达这个签到节点');
  }
  return {
    transaction: {
      operationId: args.operationId,
      currencyDelta: node.kind === 'card' ? {} : { [node.kind]: node.amount },
      inventoryDelta: node.card ? { [node.card.cardId]: node.amount } : {},
      rewardClaim: args.mode === 'story' ? { kind: 'story', nodeId: node.id }
        : { kind: 'checkIn', day: node.day!, dayKey: args.dayKey },
    },
    view: { nodeId: node.id, description: rewardDescription(node) },
  };
}
