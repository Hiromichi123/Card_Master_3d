/**
 * 战役：关卡启动与胜负结算。
 *
 * 旧版这块有两处要修的地方：
 *
 * 1. **敌方牌组可能超过 12 张**。`decks.json` 里 2-3 与 2-4 都是 13 张
 *    （`notes` 里自己也写着「超过 12 张上限」），而引擎在超限时**直接抛错**。
 *    所以启动时确定性地裁到 12 张，并把「已裁剪」显示出来。
 * 2. **没有通关记录、也没有领奖去重**，同一关重打一次就全额再发一次。
 *    新版按 `battleId` 去重，账本写在 `ProfileState.settledBattleIds` 里。
 */

import { createRng, seedFrom, type Rng } from '../battle/rng';
import type { BattleOutcome } from '../battle/types';
import type { CardRarity } from '../cards/types';
import type { StageRewardSpec } from '../../data';
import { pullOne, raritySlots, type CardPoolIndex } from './gacha';
import { reject, type Planned } from './plan';
import type { EconomyTransaction, ProfileState } from './types';

/** 引擎的卡组上限；超了 `createBattle` 会抛。 */
const DECK_LIMIT = 12;

/** 胜/负的默认奖励，旧版 `battle_base_scene.py:201`。 */
const DEFAULT_GOLD = 500;
const DEFAULT_XP = 100;
const DEFEAT_XP = 60;

/** 关卡奖励里的**魔法旗标**。 */
export const FLAG_RARE_CARD_DROP = '稀有卡牌概率掉落';
export const FLAG_CRYSTAL_DROP = '水晶掉落';

const RARE_CARD_DROP_CHANCE = 0.1;
const CRYSTAL_DROP_RANGE: readonly [number, number] = [3, 10];

/**
 * 掉落奖励卡时用的权重表。
 *
 * 旧版用的是 `game/card_system.py` 里的 `CARD_PROBABILITIES`——**它不在导出的
 * JSON 里**（那份数据只导了卡池表），所以这里按原值抄一份并说明来历。
 * 抄而不是复用 `tables['simple']`：后者的稀有度配比是给**付费抽卡**标的，
 * 拿它当战斗掉落会让一次免费掉落跟一次抽卡等价。
 */
export const BONUS_DROP_WEIGHTS: Readonly<Partial<Record<CardRarity, number>>> = {
  SSS: 0.5,
  'SS+': 0.8,
  SS: 0.7,
  'S+': 1.2,
  S: 1.3,
  'A+': 3.0,
  A: 5.5,
  'B+': 7.0,
  B: 10.0,
  'C+': 12.0,
  C: 18.0,
  D: 40.0,
};

export interface StageLaunch {
  readonly battleId: string;
  readonly stageId: string;
  readonly chapterId: string;
  readonly stageName: string;
  readonly seed: number;
  readonly playerDeck: readonly string[];
  readonly enemyDeck: readonly string[];
  readonly rewardSpec: StageRewardSpec | null;
  /** 敌方牌组是否因为超限被裁过（数据缺陷，要显示出来）。 */
  readonly clipped: boolean;
}

export interface LaunchArgs {
  readonly profile: ProfileState;
  readonly stageId: string;
  readonly chapterId: string;
  readonly stageName: string;
  readonly playerDeck: readonly string[];
  readonly enemyDeck: readonly string[];
  readonly rewardSpec: StageRewardSpec | null;
  /** 同一进程内的第几次启动，用来让两次挑战的 `battleId` 不同。 */
  readonly launchSeq: number;
}

export function stageBattleId(stageId: string, revision: number, launchSeq: number): string {
  return `${stageId}#${revision}@${launchSeq}`;
}

export function planStageLaunch(args: LaunchArgs): StageLaunch | { readonly rejected: string } {
  if (args.playerDeck.length === 0) {
    return reject('还没有可用的出战卡组');
  }
  if (args.enemyDeck.length === 0) {
    return reject('这一关没有配置敌方牌组');
  }

  const battleId = stageBattleId(args.stageId, args.profile.revision, args.launchSeq);
  // 确定性裁剪：超限时从**尾部**切，顺序不变
  const enemyDeck = args.enemyDeck.slice(0, DECK_LIMIT);

  return {
    battleId,
    stageId: args.stageId,
    chapterId: args.chapterId,
    stageName: args.stageName,
    // 种子取自 battleId：同一次挑战可复现，不同次挑战的洗牌不同
    seed: seedFrom(battleId),
    playerDeck: args.playerDeck.slice(0, DECK_LIMIT),
    enemyDeck,
    rewardSpec: args.rewardSpec,
    clipped: enemyDeck.length < args.enemyDeck.length,
  };
}

export interface Settlement {
  readonly victory: boolean;
  readonly gold: number;
  readonly xp: number;
  readonly crystals: number;
  readonly badges: number;
  /** 掉落或礼包给出的卡；没有就是 `null`。 */
  readonly cardId: string | null;
  readonly cardRarity: CardRarity | null;
  /** 逐条给玩家看的说明。 */
  readonly lines: readonly string[];
}

export interface SettleArgs {
  readonly rewardSpec: StageRewardSpec | null;
  readonly outcome: BattleOutcome;
  readonly rng: Rng;
  readonly pool: CardPoolIndex;
  readonly rarityOrder: readonly string[];
  /** 掉落卡的基准种子。传 `battleId` 就能让重渲染得到同一结果。 */
  readonly dropSeed: number;
}

/**
 * 算结算。
 *
 * **平局按失败结算**——旧版只有胜/负两态，平分时既非胜也非负；
 * 这里明确按非胜处理并在界面上写出来，免得看起来像漏发奖励。
 */
export function settleStage(args: SettleArgs): Settlement {
  const victory = args.outcome.kind === 'win' && args.outcome.winner === 'player';
  const spec = args.rewardSpec;

  if (!victory) {
    return {
      victory: false,
      gold: 0,
      xp: DEFEAT_XP,
      crystals: 0,
      badges: 0,
      cardId: null,
      cardRarity: null,
      lines: [`败北经验 +${DEFEAT_XP}`],
    };
  }

  const gold = spec?.gold ?? DEFAULT_GOLD;
  const xp = spec?.xp ?? DEFAULT_XP;
  let crystals = spec?.crystals ?? 0;
  const badges = spec?.badges ?? 0;
  let cardId: string | null = null;
  let cardRarity: CardRarity | null = null;

  const lines: string[] = [`金币 +${gold}`, `经验 +${xp}`];

  for (const flag of spec?.items ?? []) {
    if (flag === FLAG_RARE_CARD_DROP) {
      if (args.rng.chance(RARE_CARD_DROP_CHANCE)) {
        const slots = raritySlots(BONUS_DROP_WEIGHTS, args.rarityOrder);
        const drawn = pullOne(args.rng, slots, args.pool);
        cardId = drawn.cardId;
        cardRarity = drawn.rarity;
        lines.push(`掉落卡牌（${drawn.rarity}）`);
      } else {
        lines.push('本次没有掉落卡牌');
      }
    } else if (flag === FLAG_CRYSTAL_DROP) {
      const found = args.rng.int(CRYSTAL_DROP_RANGE[0], CRYSTAL_DROP_RANGE[1]);
      crystals += found;
      lines.push(`水晶 +${found}`);
    } else {
      // 没见过的旗标要说出来，不要静默吞掉——数据里加一个新旗标时得看得见
      lines.push(`未识别奖励：${flag}`);
    }
  }

  if (crystals > 0 && !lines.some((line) => line.startsWith('水晶'))) {
    lines.push(`水晶 +${crystals}`);
  }
  if (badges > 0) {
    lines.push(`徽章 +${badges}`);
  }

  return { victory: true, gold, xp, crystals, badges, cardId, cardRarity, lines };
}

/** 结算的视图：给界面看的奖励明细，外加这次实际升了几级（由折叠返回）。 */
export interface SettlementView extends Settlement {
  readonly battleId: string;
  readonly stageId: string;
}

/** 把结算包成一次事务——金币、经验、水晶、掉落的卡、通关记录一起提交。 */
export function planSettlement(
  launch: StageLaunch,
  settlement: Settlement,
  operationId: string,
): Planned<SettlementView> {
  const inventoryDelta: Record<string, number> = {};
  if (settlement.cardId) {
    inventoryDelta[settlement.cardId] = 1;
  }

  const transaction: EconomyTransaction = {
    operationId,
    currencyDelta: {
      ...(settlement.gold ? { gold: settlement.gold } : {}),
      ...(settlement.crystals ? { crystal: settlement.crystals } : {}),
      ...(settlement.badges ? { badge: settlement.badges } : {}),
    },
    inventoryDelta,
    xpDelta: settlement.xp,
    settleBattleId: launch.battleId,
    ...(settlement.victory ? { clearStageId: launch.stageId } : {}),
  };

  return {
    transaction,
    view: { ...settlement, battleId: launch.battleId, stageId: launch.stageId },
  };
}

/** 结算用的随机流。种子取自 `battleId`，所以重渲染得到同一结果、什么都不用存。 */
export function settlementRng(battleId: string): Rng {
  return createRng(seedFrom(`${battleId}:reward`));
}
