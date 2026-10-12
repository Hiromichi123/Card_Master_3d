/**
 * 经济事务的折叠。
 *
 * 一次经济行为（结算一局、抽一次、买一次）就是**一个** `EconomyTransaction`，
 * `applyEconomyTransaction` 把它折进存档——扣费、加卡、售罄、奖励、经验、
 * 通关记录全在一处，要么全生效要么全不生效。
 *
 * 旧版把这几件事拆成 2–4 次 `json.dump`，中途失败就留下「扣了钱没发货」
 * 或者「货没了钱还在」的半完成状态（`shops.json` 的 `knownIssues` 记了 6 条）。
 *
 * **纯函数**：不写盘、不看时间、不抛异常。不满足条件就原样返回并给出原因，
 * 由上层决定怎么呈现。真正的落盘由 `ProfileStore` 在拿到这个结果之后做。
 */

import type { Currencies } from './types';
import { grantXp } from './levels';
import { mazeShopBatchKey } from './maze';
import { mazeProgressToken } from './mazeProgress';
import { canCheckIn, STORY_NODE_PATTERN } from './rewardState';
import { LADDER_REWARDS } from './ladderRewards';
import { abyssStateToken } from './abyssRun';
import { validAbyssRewardTransaction } from './abyssRewards';
import { validateAbyssState } from './abyssValidation';
import type { EconomyTransaction, ProfileState } from './types';

export type RejectReason = 'insufficientFunds' | 'insufficientCards' | 'alreadySettled' | 'alreadyClaimed' | 'rewardUnavailable' | 'mazeShopChanged' | 'mazeStateChanged' | 'abyssStateChanged';

export interface ApplyOutcome {
  /** 折叠后的存档。被拒时**就是传入的那一份**（同一个引用）。 */
  readonly profile: ProfileState;
  readonly applied: boolean;
  readonly reason?: RejectReason;
  /** 这次事务实际升了几级，供结算页显示。 */
  readonly levelsGained: number;
}

const CURRENCY_KEYS = ['gold', 'crystal', 'badge'] as const;

/** 三个货币是否都够扣。 */
export function canAfford(currencies: Currencies, delta: Partial<Currencies>): boolean {
  return CURRENCY_KEYS.every((key) => currencies[key] + (delta[key] ?? 0) >= 0);
}

/** 库存是否都够扣（负向的 inventoryDelta 不得把任何一张扣成负数）。 */
export function hasCardsFor(
  inventory: Readonly<Record<string, number>>,
  delta: Readonly<Record<string, number>>,
): boolean {
  return Object.entries(delta).every(
    ([cardId, amount]) => (inventory[cardId] ?? 0) + amount >= 0,
  );
}

/** 加上一批库存变化，结果 ≤0 的键直接删掉——存档里不留 `0`。 */
export function addToInventory(
  inventory: Readonly<Record<string, number>>,
  delta: Readonly<Record<string, number>>,
): Record<string, number> {
  const next: Record<string, number> = { ...inventory };
  for (const [cardId, amount] of Object.entries(delta)) {
    const value = (next[cardId] ?? 0) + amount;
    if (value > 0) {
      next[cardId] = value;
    } else {
      delete next[cardId];
    }
  }
  return next;
}

/**
 * 把一次事务折进存档。
 *
 * 校验顺序是有讲究的：**先看去重，再看余额**。
 * 已经被结算过的 `battleId` 应当无视当前余额直接判为「已结算」——
 * 否则玩家花光了钱再回到结算页，会看到「余额不足」这种莫名其妙的提示。
 */
export function applyEconomyTransaction(
  profile: ProfileState,
  tx: EconomyTransaction,
): ApplyOutcome {
  const unchanged = (reason: RejectReason): ApplyOutcome => ({
    profile,
    applied: false,
    reason,
    levelsGained: 0,
  });

  if (tx.abyssUpdate) {
    const update = tx.abyssUpdate;
    if (update.expectedToken !== abyssStateToken(profile) || update.state.revision !== profile.abyss.revision + 1
      || !validateAbyssState(update.state) || !validAbyssRewardTransaction(profile.abyss, update.state, tx)
      || tx.rewardClaim || tx.ladderRewardClaim || tx.settleBattleId || tx.clearStageId || tx.xpDelta !== undefined
      || tx.soldOutAdditions || tx.mazeUpdate || tx.mazeSoldOut || tx.mazeShopExpected || tx.mazeShopRefresh
      ) return unchanged('abyssStateChanged');
    const currencies = Object.keys(tx.currencyDelta).length === 0 ? profile.currencies : { ...profile.currencies, gold: profile.currencies.gold + (tx.currencyDelta.gold ?? 0), crystal: profile.currencies.crystal + (tx.currencyDelta.crystal ?? 0) };
    const inventory = Object.keys(tx.inventoryDelta).length === 0 ? profile.inventory : addToInventory(profile.inventory, tx.inventoryDelta);
    if (!Object.values(currencies).every(n => Number.isSafeInteger(n) && n >= 0)
      || !Object.values(inventory).every(n => Number.isSafeInteger(n) && n > 0)) return unchanged('abyssStateChanged');
    return { profile: { ...profile, revision: profile.revision + 1, abyss: update.state, currencies, inventory }, applied: true, levelsGained: 0 };
  }

  if (tx.abyssReward) return unchanged('abyssStateChanged');

  // 1. 持久去重：同一局只能结算一次。刷新、重渲染、来回切路由都走这一条
  if (tx.settleBattleId && profile.settledBattleIds.includes(tx.settleBattleId)) {
    return unchanged('alreadySettled');
  }

  // 奖励持久去重：领取记录与资源在一次整档写入中提交。
  const claim = tx.rewardClaim;
  if (claim?.kind === 'story') {
    if (profile.rewards.claimedStoryIds.includes(claim.nodeId)) return unchanged('alreadyClaimed');
    if (!STORY_NODE_PATTERN.test(claim.nodeId) || !profile.campaign.clearedStages.includes(claim.nodeId)) {
      return unchanged('rewardUnavailable');
    }
  } else if (claim?.kind === 'checkIn') {
    if (profile.rewards.checkIn.some(record => record.day === claim.day || record.dayKey === claim.dayKey)) {
      return unchanged('alreadyClaimed');
    }
    if (!canCheckIn(profile.rewards, claim.day, claim.dayKey)) return unchanged('rewardUnavailable');
  }
  const rewards = claim?.kind === 'story'
    ? { ...profile.rewards, claimedStoryIds: [...profile.rewards.claimedStoryIds, claim.nodeId] }
    : claim?.kind === 'checkIn'
      ? { ...profile.rewards, checkIn: [...profile.rewards.checkIn, { day: claim.day, dayKey: claim.dayKey }] }
      : profile.rewards;

  const ladderClaim = tx.ladderRewardClaim;
  if (ladderClaim) {
    if (profile.ladder.claimedTierFloors.includes(ladderClaim.floor)) return unchanged('alreadyClaimed');
    const reward = LADDER_REWARDS.find(item => item.floor === ladderClaim.floor);
    const amounts = Object.values(tx.inventoryDelta);
    if (!reward || profile.ladder.points < reward.floor || ladderClaim.deckId !== profile.ladder.deckId
      || tx.currencyDelta.crystal !== reward.crystals || (tx.currencyDelta.gold ?? 0) !== 0
      || (tx.currencyDelta.badge ?? 0) !== 0
      || amounts.some(count => !Number.isSafeInteger(count) || count <= 0)
      || amounts.reduce((sum, count) => sum + count, 0) !== reward.count
      || tx.rewardClaim || tx.settleBattleId || tx.clearStageId || tx.xpDelta
      || tx.soldOutAdditions || tx.mazeUpdate || tx.mazeSoldOut || tx.mazeShopRefresh || tx.mazeShopExpected) {
      return unchanged('rewardUnavailable');
    }
  }
  const ladder = ladderClaim ? {
    ...profile.ladder,
    claimedTierFloors: [...profile.ladder.claimedTierFloors, ladderClaim.floor].sort((a, b) => a - b),
  } : profile.ladder;

  if (tx.mazeUpdate && (tx.mazeUpdate.expectedToken !== mazeProgressToken(profile)
    || tx.mazeSoldOut || tx.mazeShopRefresh || tx.mazeShopExpected)) {
    return unchanged('mazeStateChanged');
  }

  // 迷宫事务必须仍指向原批次，且不能对售罄条目再次扣钱发卡。
  if (tx.mazeSoldOut || tx.mazeShopRefresh || tx.mazeShopExpected) {
    const expected = tx.mazeShopExpected;
    const run = profile.mazeRun;
    const state = expected && run?.shopByNode[String(expected.nodeId)];
    if (!expected || !run || !state || run.playerNodeId !== expected.nodeId
      || mazeShopBatchKey(run, expected.nodeId) !== expected.batchKey
      || (tx.mazeSoldOut && tx.mazeShopRefresh)
      || (tx.mazeSoldOut && (tx.mazeSoldOut.nodeId !== String(expected.nodeId)
        || tx.mazeSoldOut.entryIds.some(id => state.soldOut.includes(id))))
      || (tx.mazeShopRefresh && tx.mazeShopRefresh.nodeId !== String(expected.nodeId))) {
      return unchanged('mazeShopChanged');
    }
  }

  // 2. 余额与库存
  if (!canAfford(profile.currencies, tx.currencyDelta)) {
    return unchanged('insufficientFunds');
  }
  if (!hasCardsFor(profile.inventory, tx.inventoryDelta)) {
    return unchanged('insufficientCards');
  }

  // 3. 三个货币一起算，缺省沿用原值
  const currencies: Currencies = {
    gold: profile.currencies.gold + (tx.currencyDelta.gold ?? 0),
    crystal: profile.currencies.crystal + (tx.currencyDelta.crystal ?? 0),
    badge: profile.currencies.badge + (tx.currencyDelta.badge ?? 0),
  };

  // 4. 经验与升级
  const trained = tx.xpDelta ? grantXp(profile.level, tx.xpDelta) : null;

  // 5. 通关记录与售罄标记都去重
  const clearedStages = tx.clearStageId
    ? [...new Set([...profile.campaign.clearedStages, tx.clearStageId])]
    : profile.campaign.clearedStages;
  const soldOut = tx.soldOutAdditions?.length
    ? [...new Set([...profile.shop.soldOut, ...tx.soldOutAdditions])]
    : profile.shop.soldOut;

  // 已通过批次前置校验，不补造seed=0的货架，也不碰每日货架。
  let mazeRun = tx.mazeUpdate?.run ?? profile.mazeRun;
  if (mazeRun && tx.mazeSoldOut) {
    const { nodeId, entryIds } = tx.mazeSoldOut;
    const state = mazeRun.shopByNode[nodeId]!;
    mazeRun = { ...mazeRun, shopByNode: { ...mazeRun.shopByNode, [nodeId]: { ...state, soldOut: [...new Set([...state.soldOut, ...entryIds])] } } };
  } else if (mazeRun && tx.mazeShopRefresh) {
    const { nodeId, state } = tx.mazeShopRefresh;
    mazeRun = { ...mazeRun, shopByNode: { ...mazeRun.shopByNode, [nodeId]: state } };
  }

  return {
    profile: {
      ...profile,
      revision: profile.revision + 1,
      currencies,
      rewards,
      ladder,
      inventory: addToInventory(profile.inventory, tx.inventoryDelta),
      level: trained ? trained.level : profile.level,
      campaign: {
        ...profile.campaign,
        clearedStages,
        // 通了关就顺手把当前章节记上，战役页据此定位
        currentChapterId:
          tx.clearStageId !== undefined && profile.campaign.currentChapterId === null
            ? tx.clearStageId.split('-')[0] ?? null
            : profile.campaign.currentChapterId,
      },
      shop: { ...profile.shop, soldOut },
      mazeRun,
      mazeProgress: tx.mazeUpdate?.progress ?? profile.mazeProgress,
      settledBattleIds: tx.settleBattleId
        ? [...profile.settledBattleIds, tx.settleBattleId]
        : profile.settledBattleIds,
    },
    applied: true,
    levelsGained: trained?.levelsGained ?? 0,
  };
}
