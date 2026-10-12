import type { BattleOutcome } from '../battle/types';
import type { CardDefinition } from '../cards/types';
import type { SkillSpec } from '../skills/types';

export interface AbyssCard {
  readonly instanceId: string;
  readonly baseCardId: string;
  readonly baseDefinition: CardDefinition;
  /** 不含单场增益的本轮培养快照；相同模板的多张卡也不共享此身份。 */
  readonly definition: CardDefinition;
  readonly upgrades: { readonly atk: number; readonly hp: number; readonly cd: number };
  readonly addedTraits: readonly SkillSpec[];
  /** Historical maximum cultivated level reduction, in 0.5 steps; trait replacement never lowers earned rarity. */
  readonly rarityReduction?: number;
}

export interface AbyssModifier {
  readonly atk: number;
  readonly hp: number;
  readonly cd: number;
  readonly traits: readonly SkillSpec[];
}

export interface AbyssEffect {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly polarity: 'positive' | 'negative';
  readonly strength: number;
  readonly modifier: AbyssModifier;
}

export interface AbyssBoonPair {
  readonly id: string;
  readonly positive: AbyssEffect;
  readonly negative: AbyssEffect;
}

export type AbyssDifficulty = 'normal' | 'hard' | 'nightmare';
export interface AbyssEncounter {
  readonly battleId: string;
  readonly seed: number;
  readonly floor: number;
  readonly encounter: number;
  readonly difficulty: AbyssDifficulty;
  readonly enemyCards: readonly AbyssCard[];
  readonly enemyEffect: AbyssEffect;
  readonly boonChoices: readonly AbyssBoonPair[];
  readonly selectedBoon: number | null;
}

export interface AbyssStarterChoice {
  readonly id: string;
  readonly name: string;
  readonly cards: readonly AbyssCard[];
}

export type AbyssGrowthOption =
  | { readonly kind: 'atk' | 'hp' | 'cd'; readonly label: string; readonly amount?: number }
  | { readonly kind: 'remove'; readonly label: string }
  | { readonly kind: 'crystal'; readonly label: string }
  | { readonly kind: 'trait'; readonly label: string; readonly trait: SkillSpec }
  | { readonly kind: 'recruit'; readonly label: string; readonly card: AbyssCard };

export interface AbyssGrowthOffer {
  readonly id: string;
  readonly source: 'free' | 'training' | 'recruit' | 'trait';
  readonly options: readonly AbyssGrowthOption[];
  readonly paidPrice?: number;
}

export type AbyssStage =
  | { readonly kind: 'starterDraft'; readonly choices: readonly AbyssStarterChoice[] }
  | { readonly kind: 'boonChoice' | 'battleReady' | 'inBattle'; readonly battle: AbyssEncounter }
  | { readonly kind: 'camp'; readonly battle: AbyssEncounter; readonly result: 'win' | 'loss' | 'draw'; readonly freeRemaining: number; readonly offer: AbyssGrowthOffer | null; readonly offerSerial: number }
  | { readonly kind: 'bossDecision'; readonly battle: AbyssEncounter };

export interface AbyssRun {
  readonly id: string;
  readonly revision: number;
  readonly seed: number;
  readonly rulesVersion: 1;
  readonly contentVersion: string;
  readonly startedAt: string;
  readonly floor: number;
  readonly encounter: number;
  readonly lives: number;
  readonly coins: number;
  readonly earnedCoins: number;
  readonly crystals?: number;
  readonly recruitPurchases?: number;
  readonly traitPurchases?: number;
  readonly highestCleared?: number;
  readonly wins: number;
  readonly losses: number;
  readonly cards: readonly AbyssCard[];
  readonly lastSettledBattleId: string | null;
  readonly stage: AbyssStage;
}

export interface AbyssHistory {
  readonly runId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly reason: 'settled' | 'defeated' | 'abandoned';
  readonly floor: number;
  readonly encounter: number;
  readonly wins: number;
  readonly losses: number;
  readonly coins: number;
  readonly earnedCoins: number;
  readonly crystals?: number;
  readonly recruitPurchases?: number;
  readonly traitPurchases?: number;
  readonly highestCleared?: number;
  readonly cards: readonly AbyssCard[];
}

export interface AbyssBest {
  readonly cleared: number;
  readonly wins: number;
  readonly runId: string;
  readonly achievedAt: string;
}

export interface AbyssCompletionClaim {
  readonly id: string;
  readonly runId: string;
  readonly tier: number;
  readonly weekKey: string;
  readonly claimedAt: string;
  readonly gold: number;
  readonly crystal: number;
  readonly candidates: readonly string[];
  readonly selected?: readonly number[];
}
export interface AbyssWeekRecord {
  readonly weekKey: string;
  readonly highestReached: number;
  readonly designatedCardIds: readonly string[];
  readonly claimedMilestones: readonly number[];
}

export interface AbyssState {
  readonly completionClaims?: readonly AbyssCompletionClaim[];
  readonly weeks?: readonly AbyssWeekRecord[];
  readonly best?: AbyssBest | null;
  /** 独立持久版本，run清空后旧按钮仍不能覆盖新一轮。 */
  readonly revision: number;
  readonly run: AbyssRun | null;
  readonly history: readonly AbyssHistory[];
  readonly knownEffectIds: readonly string[];
}

type AbyssActionBody =
  | { readonly kind: 'prepareWeek' | 'resumeBattle' }
  | { readonly kind: 'claimWeekly'; readonly weekKey: string; readonly milestone: number }
  | { readonly kind: 'chooseRewardPack'; readonly claimId: string; readonly indices: readonly number[] }
  | { readonly kind: 'start'; readonly confirmAbandon?: boolean }
  | { readonly kind: 'chooseStarter' | 'chooseBoon'; readonly index: number }
  | { readonly kind: 'beginBattle' | 'skipFree' | 'next' | 'finish' | 'abandon' | 'save' | 'cancelOffer' }
  | { readonly kind: 'settle'; readonly battleId: string; readonly outcome: BattleOutcome }
  | { readonly kind: 'buy'; readonly purchase: 'training' | 'recruit' | 'trait' }
  | { readonly kind: 'train'; readonly targetId: string; readonly stat: 'atk' | 'hp' | 'cd' }
  | { readonly kind: 'eraseTrait'; readonly targetId: string; readonly family: string }
  | { readonly kind: 'chooseGrowth'; readonly offerId: string; readonly index: number; readonly targetId?: string; readonly discardNew?: boolean; readonly confirmReplace?: boolean };

export type AbyssAction = AbyssActionBody & {
  readonly expectedToken: string;
  readonly operationId?: string;
};
