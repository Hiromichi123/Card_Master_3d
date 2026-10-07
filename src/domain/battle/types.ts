/**
 * 战斗状态、命令、事件与结算的数据模型（施工清单 P0-4）。
 *
 * 三层结构的规则层部分（PLAN 第 4.1 节）：
 *
 *   Command → BattleEngine → Resolution(events + patches + finalState) → 演出层
 *
 * 两条硬约束：
 * 1. 规则层**不依赖** React、Three.js、DOM 或文件 IO，可以在无渲染环境跑完一局。
 * 2. 事件里带已经确定的目标与数值；演出层不得再次随机选择目标或自行扣血。
 */

import type {
  CardDefinition,
  CardInstance,
  CombatStateGroup,
  SideId,
  ZoneId,
} from '../cards/types';

/**
 * 规则常量。
 *
 * 默认值来自旧项目 `scenes/battle/battle_base_scene.py:44-45,64-67` 与
 * `simple_battle.py:134-141` 的静态核查，见 `docs/rules.md` 第 1 节。
 */
export interface BattleRules {
  /** 每方战斗槽数。 */
  readonly battleSlots: number;
  /** 每方准备区槽数。 */
  readonly prepSlots: number;
  /** 双方基础生命。 */
  readonly baseHp: number;
  /** 开局每方抽牌数。 */
  readonly openingDraw: number;
  /** 当前方新回合抽牌数。 */
  readonly drawPerTurn: number;
  /** 每回合可出牌数。 */
  readonly cardsPerTurn: number;
  /** 组卡上限，超出视为配置错误。 */
  readonly deckLimit: number;
  /**
   * 回合上限。到达后按 PLAN 第 4.2 节判平局，
   * 避免原版可能出现的无限循环。0 表示不限制。
   */
  readonly turnLimit: number;
}

export const DEFAULT_BATTLE_RULES: BattleRules = {
  battleSlots: 5,
  prepSlots: 8,
  baseHp: 20,
  openingDraw: 3,
  drawPerTurn: 1,
  cardsPerTurn: 1,
  deckLimit: 12,
  turnLimit: 200,
};

/** 一局的输入。牌组用 cardId 表达，不使用图片路径。 */
export interface BattleConfig {
  readonly seed: number;
  /** 玩家牌组（CardDefinition.cardId 列表，允许重复）。 */
  readonly playerDeck: readonly string[];
  /** 敌方牌组。 */
  readonly enemyDeck: readonly string[];
  readonly rules?: Partial<BattleRules>;
  /** 关卡标识，仅用于奖励与日志，不参与规则。 */
  readonly stageId?: string;
  /** 人类可读的标签，例如「演示战斗」或「3-2」。 */
  readonly label?: string;
}

/** 战斗阶段。对应旧版的 turn_phase 与 battle_phase 合并后的状态机。 */
export type BattlePhase =
  /** 等待当前方出牌或结束回合。 */
  | 'awaitingPlay'
  /** 正在按顺序结算一次行动。 */
  | 'resolving'
  /** 已经结束。 */
  | 'ended';

/**
 * 一方的区域状态。
 *
 * 数组本身可以改内容（抽牌、换区、整理槽位都在改它），
 * 但**长度固定**：准备区与战斗区的长度由 `BattleRules` 决定，
 * 战斗中不增删槽位。`prep` / `battle` 用 `null` 表示空槽，
 * 而不是用变长数组——位置是对位规则的一部分，不能被压缩掉。
 */
export interface SideZones {
  /** 抽牌堆，索引 0 为下一张要抽的牌。 */
  deck: string[];
  hand: string[];
  /** 准备区，固定长度，`null` 表示空槽。 */
  prep: (string | null)[];
  /** 战斗区，固定长度，`null` 表示空槽。 */
  battle: (string | null)[];
  discard: string[];
}

/**
 * 完整战斗状态。纯数据，可结构化克隆，便于同 seed 重放与状态比对。
 */
export interface BattleState {
  readonly rules: BattleRules;
  /**
   * 本局用到的卡牌定义，按 cardId 索引。
   *
   * 规则层要读 trait（沉默看对位、飞行看双方、不死/复活看死亡卡），
   * 而实例上只存 `definitionId`。把定义表放进状态里，
   * 引擎就是自包含的：不需要外部再传一份数据库，也能完整重放一局。
   */
  readonly definitions: Readonly<Record<string, CardDefinition>>;
  readonly seed: number;
  /** RNG 的内部状态；规则随机与粒子随机完全分开（PLAN 第 4.2 节）。 */
  rng: RngState;
  /** 从 1 开始；仅在控制权回到 player 时 +1，与旧版语义一致。 */
  turnNumber: number;
  currentSide: SideId;
  phase: BattlePhase;
  /** 双方本体生命。 */
  hp: Record<SideId, number>;
  zones: Record<SideId, SideZones>;
  /** instanceId → 实例。 */
  instances: Record<string, CardInstance>;
  /** groupId → 分身共享状态组。 */
  groups: Record<string, CombatStateGroup>;
  /** 当前方本回合已出牌数。 */
  cardsPlayedThisTurn: number;
  /** 每方每回合的「复制」使用标记（旧版 `copy_usage_state`）。 */
  copyUsedThisTurn: Record<SideId, boolean>;
  /**
   * 已发生的事件序号计数。事件序号一旦分配不再变化，
   * 便于演出层与规则层对齐和断点续播。
   */
  nextEventSeq: number;
  /** 结算结果；未结束时为 null。 */
  outcome: BattleOutcome | null;
  /** 用于平局判定的状态重复检测（PLAN 第 4.2 节）。 */
  stateHistory: string[];
}

export interface RngState {
  /** 当前内部种子；每次取数后更新。 */
  state: number;
  /** 已取数次数，用于复现与调试。 */
  draws: number;
}

export type BattleOutcome =
  | { readonly kind: 'win'; readonly winner: SideId; readonly reason: BattleEndReason }
  | { readonly kind: 'draw'; readonly reason: BattleEndReason };

export type BattleEndReason =
  /** 一方本体生命降到 0。 */
  | 'hpDepleted'
  /** 一方没有任何可以进入战斗的牌（手牌/准备区/战斗区/牌堆全空）。 */
  | 'noCardsRemaining'
  /** 达到回合上限。 */
  | 'turnLimit'
  /** 状态重复，判定无法推进。 */
  | 'stateRepeated'
  /** 双方同时满足失败条件。 */
  | 'simultaneous';

/** 玩家或 AI 提交的行动。 */
export type Command =
  | {
      readonly kind: 'playCard';
      readonly side: SideId;
      readonly instanceId: string;
      /** 目标准备槽下标；省略时使用从左到右第一个空槽。 */
      readonly prepSlot?: number;
    }
  | { readonly kind: 'endTurn'; readonly side: SideId }
  /** 测试与调试用：直接推进到下一方的回合开始。 */
  | { readonly kind: 'concede'; readonly side: SideId };

/** 行动被拒绝的原因。合法性与演出时长无关。 */
export type CommandRejection =
  | 'notYourTurn'
  | 'wrongPhase'
  | 'alreadyPlayedThisTurn'
  | 'cardNotInHand'
  | 'noEmptyPrepSlot'
  | 'rowsFull'
  | 'battleEnded';

/** 命令校验结果。 */
export type CommandValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: CommandRejection; readonly detail?: string };

/**
 * 战斗事件。每个事件都带已确定的数值与目标，
 * 演出层只负责按顺序播放，不重新计算。
 */
/**
 * 对联合类型做 Omit。
 *
 * 直接用 `Omit<BattleEvent, K>` 是错的：`Omit` 不分配到联合的每个成员上，
 * 它只会保留**所有成员共有的**键，判别字段与各分支的字段全部丢失，
 * 于是写事件时每个字段都报「不支持该属性」。必须显式分配。
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** 事件的载荷：不含序号与回合，由引擎补。 */
export type BattleEventPayload = DistributiveOmit<BattleEvent, 'seq' | 'turn'>;

export type BattleEvent = { readonly seq: number; readonly turn: number } & (
  | { readonly type: 'BattleStarted'; readonly config: BattleConfig }
  | { readonly type: 'CardDrawn'; readonly side: SideId; readonly instanceId: string; readonly fromDeckIndex: number }
  | { readonly type: 'CardPlayed'; readonly side: SideId; readonly instanceId: string; readonly prepSlot: number }
  | { readonly type: 'CooldownChanged'; readonly side: SideId; readonly instanceId: string; readonly from: number; readonly to: number; readonly cause: CooldownCause }
  | { readonly type: 'CardDeployed'; readonly side: SideId; readonly instanceId: string; readonly battleSlot: number }
  | { readonly type: 'SkillTriggered'; readonly side: SideId; readonly instanceId: string; readonly trigger: string; readonly family: string | null; readonly raw: string; readonly param: number | null }
  | { readonly type: 'AttackDeclared'; readonly side: SideId; readonly attackerId: string; readonly targetInstanceId: string | null; readonly targetSlot: number; readonly attackKind?: 'ranged' | 'piercing' }
  | { readonly type: 'DamageApplied'; readonly side: SideId; readonly instanceId: string; readonly amount: number; readonly hpBefore: number; readonly hpAfter: number; readonly source: DamageSource }
  | { readonly type: 'SpellReflected'; readonly side: SideId; readonly casterId: string; readonly reflectorId: string; readonly family: string; readonly raw: string; readonly param: number | null }
  | { readonly type: 'UnyieldingChanged'; readonly side: SideId; readonly instanceId: string; readonly groupId: string; readonly active: boolean; readonly expiresAfterTurn: number }
  | { readonly type: 'LifeTransferred'; readonly side: SideId; readonly recipientId: string; readonly donorId: string; readonly amount: number }
  | { readonly type: 'FormationShuffled'; readonly side: SideId; readonly casterId: string; readonly order: readonly (string | null)[] }
  | { readonly type: 'DodgeGranted'; readonly side: SideId; readonly instanceId: string; readonly sourceInstanceId: string; readonly level: number }
  | { readonly type: 'Healed'; readonly side: SideId; readonly instanceId: string; readonly amount: number; readonly hpBefore: number; readonly hpAfter: number }
  | { readonly type: 'StatChanged'; readonly side: SideId; readonly instanceId: string; readonly stat: 'atk'; readonly from: number; readonly to: number; readonly cause: string }
  | { readonly type: 'PlayerHpChanged'; readonly side: SideId; readonly amount: number; readonly hpBefore: number; readonly hpAfter: number; readonly source: DamageSource }
  | { readonly type: 'CardDied'; readonly side: SideId; readonly instanceId: string; readonly groupId: string; readonly collapsedInstanceIds: readonly string[] }
  | { readonly type: 'CardMoved'; readonly side: SideId; readonly instanceId: string; readonly from: ZoneId; readonly to: ZoneId; readonly slotIndex: number }
  | { readonly type: 'CloneCreated'; readonly side: SideId; readonly instanceId: string; readonly groupId: string; readonly battleSlot: number; readonly mode: 'shared' | 'independent' }
  | { readonly type: 'SlotCompacted'; readonly side: SideId; readonly moves: readonly { readonly instanceId: string; readonly from: number; readonly to: number }[] }
  | { readonly type: 'TurnEnded'; readonly side: SideId; readonly nextSide: SideId }
  | { readonly type: 'BattleEnded'; readonly outcome: BattleOutcome }
);

export type CooldownCause = 'turnTick' | 'skill' | 'deploy' | 'reset';

export type DamageSource =
  /** 从左到右的普通攻击。 */
  | 'normalAttack'
  /** 技能伤害（受免疫约束）。 */
  | 'skill'
  /** 反击伤害（走技能伤害管线）。 */
  | 'counter'
  /** 地对空时转移到本体。 */
  | 'flyingRedirect'
  /** 打到空槽对应的本体。 */
  | 'emptySlot'
  /** 自伤，例如受伤n / 狂暴 / 自毁。 */
  | 'selfInflicted'
  | 'ranged'
  | 'piercing'
  | 'deathBlast'
  | 'instantDeath'
  /** Direct HP loss, bypassing flying, mitigation, dodge, immunity and spell reflection. */
  | 'trueDamage'
  | 'sacrifice'
  | 'groupPiercing'
  | 'collapse'
  | 'unyielding';

/**
 * 演出用的显示补丁。规则层已经把最终状态算完，
 * 但界面必须按命中节点逐步应用，不能提前显示最终 HP。
 */
export interface DisplayPatch {
  /** 引用触发它的规则事件序号，演出层据此对齐。 */
  readonly atEventSeq: number;
  readonly kind: 'setHp' | 'setAtk' | 'hideCard' | 'showCard' | 'playEffect';
  readonly side: SideId;
  readonly instanceId: string;
  readonly value?: number;
  /** 表现用的效果标识，例如 `fireball`；规则不依赖它。 */
  readonly effectId?: string;
}

/** 一次行动的完整结算结果。 */
export interface Resolution {
  /** 按固定顺序排列、序号连续的事件。 */
  readonly events: readonly BattleEvent[];
  /** 与事件对应的显示补丁，供演出层逐点应用。 */
  readonly patches: readonly DisplayPatch[];
  /** 该行动结束后的权威状态；演出结束后界面最终必须与之一致。 */
  readonly finalState: BattleState;
  /** 命令是否被接受。被拒绝时不产生事件。 */
  readonly accepted: boolean;
  readonly rejection?: CommandRejection;
}
