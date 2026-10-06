/**
 * 存档与外围玩法的数据模型（施工清单 P0-4，PLAN 第 6 节）。
 *
 * 持久状态由一处 `ProfileState` 管理，通过 `SaveRepository` 落到 IndexedDB。
 * 关键设计：
 * - 库存按 `cardId → 数量` 存储，统计从计数派生，不再像旧版同时保存 cards 列表与多项统计
 *   （旧版 `utils/inventory.py` 两者都存，容易漂移）；
 * - 一次经济操作（扣费 + 售罄 + 加卡 + 奖励）必须是**一次事务**；
 * - 胜负奖励通过 `battleId` 去重，刷新或从结算页返回都不能重复领取。
 */

import type { CardRarity } from '../cards/types';

/** 存档格式版本。字段增删或语义变化时递增，并写迁移。 */
export const SAVE_SCHEMA_VERSION = 1;

/** 三种货币。旧版在 `ui/system_ui.py` 里以 golds/crystals/badges 保存。 */
export interface Currencies {
  readonly gold: number;
  readonly crystal: number;
  readonly badge: number;
}

/** 等级与经验。旧版公式：下一级所需 = ceil(baseXp * multiplier^(level-1))。 */
export interface LevelState {
  readonly level: number;
  readonly xp: number;
  readonly baseXp: number;
  readonly xpMultiplier: number;
}

/** 一套牌组。 */
export interface Deck {
  readonly id: string;
  readonly name: string;
  /** cardId 列表，允许重复；长度不超过 `DECK_LIMIT`。 */
  readonly cardIds: readonly string[];
  readonly updatedAt: string;
}

/** 组卡上限，来自旧版 `utils/deck_manager.py:7`。 */
export const DECK_LIMIT = 12;

/** 抽卡池状态；概率表本身来自 `src/data/gacha-pools.json`。 */
export interface GachaState {
  /** 每个卡池各自抽取的记录，仅用于展示与统计。 */
  readonly pullsByPool: Record<string, number>;
}

/** 商店每日状态。旧版把这三项写进 `data/shop_state.json`。 */
export interface ShopDailyState {
  /** 本地日历键，格式 `YYYYMMDD`。 */
  readonly dayKey: string;
  /** 货架随机种子；同一天必须可复现。 */
  readonly seed: number;
  /** 已售罄条目的稳定标识。 */
  readonly soldOut: readonly string[];
}

/** 战役进度。 */
export interface CampaignState {
  /** 已通关的 stageId。 */
  readonly clearedStages: readonly string[];
  readonly currentChapterId: string | null;
}

/** 迷宫 run 状态。旧版写 `data/activity/floor1.json`，新版只保留必要字段。 */
export interface MazeRunState {
  readonly floorKey: string;
  readonly version: number;
  readonly playerNodeId: number;
  readonly exploredNodeIds: readonly number[];
  /** 每个补给节点已生成的商店状态，按 nodeId 索引。 */
  readonly shopByNode: Record<string, ShopDailyState>;
}

/** 展示与操作设置。这些**不参与规则计算**，改变它们不得改变战斗结果。 */
export interface SettingsState {
  readonly quality: 'low' | 'medium' | 'high';
  readonly dprCap: number;
  readonly particleBudget: 'low' | 'medium' | 'high';
  readonly bloom: boolean;
  readonly shadows: boolean;
  readonly cameraShake: boolean;
  /** 演出速度，只影响播放时长。 */
  readonly presentationSpeed: 'normal' | 'fast' | 'skip';
  readonly masterVolume: number;
}

export const DEFAULT_SETTINGS: SettingsState = {
  quality: 'medium',
  dprCap: 2,
  particleBudget: 'medium',
  bloom: true,
  shadows: true,
  cameraShake: true,
  presentationSpeed: 'normal',
  masterVolume: 0.7,
};

/**
 * 完整存档。是整个持久化层的根对象。
 */
export interface ProfileState {
  readonly schemaVersion: number;
  /** 生成该存档时的 `src/data/cards.json` 内容版本，用于检测内容不一致。 */
  readonly contentVersion: string;
  /** 每次成功写入递增，便于发现并发写与回滚问题。 */
  readonly revision: number;
  readonly currencies: Currencies;
  readonly level: LevelState;
  /** cardId → 拥有数量。统计（不同卡数、总张数）由此派生，不额外存储。 */
  readonly inventory: Record<string, number>;
  readonly decks: readonly Deck[];
  readonly activeDeckId: string | null;
  readonly gacha: GachaState;
  readonly shop: ShopDailyState;
  readonly campaign: CampaignState;
  readonly mazeRun: MazeRunState | null;
  readonly settings: SettingsState;
  /**
   * 已经结算过的战斗 ID。用于胜负奖励去重，
   * 保证刷新、返回结算页、重复点击都只领一次。
   */
  readonly settledBattleIds: readonly string[];
}

/**
 * 一次经济事务。要么全部生效，要么全部不生效——
 * 旧版把扣费、售罄、加卡分成 2–4 次保存，中途失败会留下半完成状态。
 */
export interface EconomyTransaction {
  /** 幂等键；同一个 operationId 重复提交不得重复生效。 */
  readonly operationId: string;
  readonly currencyDelta: Partial<Currencies>;
  /** cardId → 数量变化，正数为获得。 */
  readonly inventoryDelta: Record<string, number>;
  /** 需要标记为售罄的商店条目标识。 */
  readonly soldOutAdditions?: readonly string[];
  /** 登记为已结算的战斗 ID。 */
  readonly settleBattleId?: string;
  /**
   * 经验变化量。
   *
   * 加这两个字段是为了让「通关 1-1 = 金币 + 经验 + 可能的卡 + 通关记录」
   * 真的能是**一次事务**——少了经验与通关，这条硬约束就做不到。
   *
   * 事务**从不落盘**（落盘的只有 `ProfileState`），所以这是纯追加的改动，
   * `SAVE_SCHEMA_VERSION` 保持 1、不需要迁移。
   */
  readonly xpDelta?: number;
  /** 标记为已通关的关卡 ID。 */
  readonly clearStageId?: string;
}

/** 一次抽卡的结果。**先确定并持久化，再演出**（PLAN 第 6 节）。 */
export interface GachaResult {
  readonly operationId: string;
  readonly poolId: string;
  readonly cardIds: readonly string[];
  readonly rarities: readonly CardRarity[];
  /** 本次抽卡后的随机源状态，便于复现。 */
  readonly rngState: number;
}

/** 旧存档导入的预览结果。导入是用户主动操作，必须能看见未知项。 */
export interface LegacyImportPreview {
  readonly sourceKind: 'inventory' | 'profile' | 'deck';
  readonly sourcePath: string;
  /** 成功映射到 cardId 的条目。 */
  readonly mapped: readonly { readonly rawPath: string; readonly cardId: string }[];
  /** 无法映射的原始条目；提交前必须让用户看到。 */
  readonly unknown: readonly { readonly rawPath: string; readonly reason: string }[];
  readonly currencyDelta?: Partial<Currencies>;
}
