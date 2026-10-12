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

import type { AiDifficulty, AiStyle, AiPolicy } from '../battle/ai/types';
import type { CardRarity } from '../cards/types';
import type { LadderState, NormalDeckIds } from './deckSlots';
import type { AbyssState } from './abyssTypes';

/** 存档格式版本。字段增删或语义变化时递增，并写迁移。 */
export const SAVE_SCHEMA_VERSION = 6;

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

/** 主界面奖励账本；与货币及库存一起持久化到当前玩家存档。 */
export interface RewardsState {
  readonly claimedStoryIds: readonly string[];
  /** 累计签到日序与实际本地日期，每个日期至多出现一次，累计最多 30 日。 */
  readonly checkIn: readonly { readonly day: number; readonly dayKey: string }[];
}

export type RewardClaim =
  | { readonly kind: 'story'; readonly nodeId: string }
  | { readonly kind: 'checkIn'; readonly day: number; readonly dayKey: string };

/** 缺少版本字段的已生成货架沿用旧规则，主动刷新后才升级。 */
export interface MazeShopState extends ShopDailyState {
  readonly catalogVersion?: 2;
  readonly refreshCount?: number;
}

/** 跨轮保留的探索保底与每周清空账本。 */
export interface MazeProgressState {
  /** 尚未兑换的探索次数；空活动池时可以超过 100。 */
  readonly explorationCount: number;
  readonly awardedCount: number;
  readonly lastRewardCardId: string | null;
  readonly lastResetWeek: string | null;
}

/** 迷宫 run 状态。旧版写 `data/activity/floor1.json`，新版只保留必要字段。 */
export interface MazeRunState {
  readonly floorKey: string;
  readonly version: number;
  readonly playerNodeId: number;
  readonly exploredNodeIds: readonly number[];
  /** 每个补给节点已生成的商店状态，按 nodeId 索引。 */
  readonly shopByNode: Record<string, MazeShopState>;
}

/**
 * 展示与操作设置。画质和演出不参与规则计算；AI 偏好只改变提交的命令，不改变引擎规则。
 *
 * **运行期以 `useSettingsStore`（zustand）为准，这里是它的持久化镜像。**
 * 启动时 `settingsPersistence.hydrateSettings` 把这一份灌进 zustand，
 * 之后 zustand 的每次改动经 `attachSettingsPersistence` 防抖写回这里。
 *
 * 前六项（quality / dprCap / particleBudget / bloom / shadows）是画质档的
 * **可单独覆盖参数**：`quality` 只是「上次选的预设」，其余四项是真实生效值——
 * 玩家调过某一项之后两者就不再相等，界面显示「自定义」。详见 `state/settingsStore.ts`。
 */
export interface SettingsState {
  readonly aiDifficulty?: AiDifficulty;
  readonly aiStyle?: AiStyle;
  readonly aiPolicy?: AiPolicy;
  readonly quality: 'low' | 'medium' | 'high';
  readonly dprCap: number;
  readonly particleBudget: 'low' | 'medium' | 'high';
  readonly bloom: boolean;
  readonly shadows: boolean;
  readonly cameraShake: boolean;
  /** 演出速度，只影响播放时长。 */
  readonly presentationSpeed: 'normal' | 'fast' | 'skip';
  readonly masterVolume: number;
  /**
   * 台面主题 id 与相机视角预设 id。
   *
   * 存 `string` 而不是渲染层的联合类型：领域层不该 import 渲染层。
   * **空串代表「用引擎默认」**，由水合时解析（未知 id 也回落到默认）。
   */
  readonly tableThemeId: string;
  readonly cameraModeId: string;
  /** 冻结天气/视差等动态，不移除。 */
  readonly reduceMotion: boolean;
  /** 性能读数条（开发用）。 */
  readonly showPerf: boolean;
  /** Automatically finish an actionless human deployment window after one second. */
  readonly skipTurnEnd?: boolean;
}

export const DEFAULT_SETTINGS: SettingsState = {
  aiDifficulty: 'normal', aiStyle: 'balanced', aiPolicy: 'heuristic',
  quality: 'medium',
  // 与 `QUALITY_PROFILES.medium.dprCap` 对齐（该字段长期没人消费，曾与预设不一致）
  dprCap: 1.5,
  particleBudget: 'medium',
  bloom: true,
  shadows: true,
  cameraShake: true,
  presentationSpeed: 'normal',
  masterVolume: 0.7,
  tableThemeId: '',
  cameraModeId: '',
  reduceMotion: false,
  showPerf: false,
  skipTurnEnd: false,
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
  readonly normalDeckIds: NormalDeckIds;
  readonly ladder: LadderState;
  readonly activeDeckId: string | null;
  readonly gacha: GachaState;
  readonly shop: ShopDailyState;
  readonly campaign: CampaignState;
  readonly rewards: RewardsState;
  readonly mazeRun: MazeRunState | null;
  readonly mazeProgress: MazeProgressState;
  readonly abyss: AbyssState;
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
  /** 深渊独立事务，不能夹带任何主模式资源/奖励变化。 */
  readonly abyssReward?: { readonly kind: 'completion'; readonly runId: string }
    | { readonly kind: 'pack'; readonly claimId: string; readonly indices: readonly number[] }
    | { readonly kind: 'weekly'; readonly weekKey: string; readonly milestone: number };
  readonly abyssUpdate?: { readonly expectedToken: string; readonly state: AbyssState };
  readonly currencyDelta: Partial<Currencies>;
  /** cardId → 数量变化，正数为获得。 */
  readonly inventoryDelta: Record<string, number>;
  /** 需要标记为售罄的商店条目标识。 */
  readonly soldOutAdditions?: readonly string[];
  /** 登记为已结算的战斗 ID。 */
  readonly settleBattleId?: string;
  /** 剧情/签到领取记录与资源发放必须在同一次事务生效。 */
  readonly rewardClaim?: RewardClaim;
  /** 天梯固定槽和门槛限定奖励归属，持久去重独立于剧情/签到账本。 */
  readonly ladderRewardClaim?: { readonly floor: number; readonly deckId: string };
  /**
   * 经验变化量。
   *
   * 加这两个字段是为了让「通关 1-1 = 金币 + 经验 + 可能的卡 + 通关记录」
   * 真的能是**一次事务**——少了经验与通关，这条硬约束就做不到。
   *
   * 事务本身不落盘（落盘的只有 `ProfileState`）；新增事务字段不单独改变存档版本。
   */
  readonly xpDelta?: number;
  /** 标记为已通关的关卡 ID。 */
  readonly clearStageId?: string;
  /**
   * 迷宫的**楼层商店**售罄标记，落到 `mazeRun.shopByNode[nodeId].soldOut`。
   *
   * 与 `soldOutAdditions`（每日货架）分开：那一个是全局的每日货架，
   * 而迷宫商店属于「某一次 run 的某个节点」——写进全局会让每一轮 run 的
   * 售罄标识永久累积、作废之后也清不掉。
   */
  readonly mazeUpdate?: {
    readonly expectedToken: string;
    readonly run: MazeRunState;
    readonly progress: MazeProgressState;
  };
  readonly mazeSoldOut?: {
    readonly nodeId: string;
    readonly entryIds: readonly string[];
  };
  /** 购买/刷新都以当前节点的这一批为前置条件，过期事务不能落到别轮。 */
  readonly mazeShopExpected?: {
    readonly nodeId: number;
    readonly batchKey: string;
  };
  /** 零费用刷新与货架替换在同一次持久化中提交。 */
  readonly mazeShopRefresh?: {
    readonly nodeId: string;
    readonly state: MazeShopState;
  };
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
