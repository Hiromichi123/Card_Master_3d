/**
 * 卡牌定义与实例的数据模型（施工清单 P0-4）。
 *
 * 核心约束来自 PLAN.md 第 4.2 节：
 * - `CardDefinition` 是不可变模板，`cardId` 稳定且与图片路径解耦；
 * - 图片路径**不是**卡牌主键，规则数据与资源 ID 分开；
 * - 重复 trait 必须保留原始顺序，不能去重；
 * - `CardInstance` 是战斗中的唯一对象，位置不同则 `instanceId` 不同；
 * - `CombatStateGroup` 表达“分身共享战斗属性”，与“复制拥有独立状态”区分开。
 */

import type { SkillSpec } from '../skills/types';

/** 稀有度目录名。与旧项目 `assets/outputs/<rarity>/` 一一对应。 */
export type CardRarity =
  | 'SSS'
  | 'SS+'
  | 'SS'
  | 'S+'
  | 'S'
  | 'A+'
  | 'A'
  | 'B+'
  | 'B'
  | 'C+'
  | 'C'
  | 'D'
  | '#elna';

/**
 * 旧项目的 RARITY_TO_LEVEL（`utils/card_database.py:11`）。
 * 用于界面配色与排序，不参与战斗数值计算。
 */
export const RARITY_TO_LEVEL: Record<CardRarity, number> = {
  SSS: 0,
  'SS+': 0.5,
  SS: 1,
  'S+': 1.5,
  S: 2,
  'A+': 2.5,
  A: 3,
  'B+': 3.5,
  B: 4,
  'C+': 4.5,
  C: 5,
  D: 6,
  '#elna': 0,
};

/** 普通卡池参与的稀有度；`#yoroi` 未完成，不在其中。 */
export const STANDARD_RARITIES: readonly CardRarity[] = [
  'SSS',
  'SS+',
  'SS',
  'S+',
  'S',
  'A+',
  'A',
  'B+',
  'B',
  'C+',
  'C',
  'D',
];

/** 事件卡稀有度（目录名以 `#` 开头）。 */
export const EVENT_RARITIES: readonly CardRarity[] = ['#elna'];

/**
 * 卡牌数据的完整程度。
 *
 * 旧项目按“目录里有没有 PNG”决定能否抽到（`game/card_system.py:446`
 * 的 `get_card_pool` 直接 `os.listdir`），而战斗数据来自 `cards.json`。
 * 两者不一致时旧版会构造一张 ATK/HP/CD 全 0 的占位卡。
 * 新版把这件事显式化：只有 `complete` 才允许进入战斗与抽卡池。
 */
export type CardStatus =
  /** ATK/HP/CD/traits 齐全，可进入战斗与卡池。 */
  | 'complete'
  /** 元数据不完整（如 #yoroi 的 9 张），仅留档与图鉴展示。 */
  | 'incomplete';

/**
 * 卡牌模板。不可变；同一张卡的所有战斗实例共享同一个 `CardDefinition`。
 */
export interface CardDefinition {
  /**
   * 稳定旧 ID，格式 `<rarity>_<编号>`，例如 `A_001`、`#elna_013`。
   * 与 `utils/card_database.py:61` 的 `f"{rarity}_{data['id']}"` 一致。
   */
  readonly cardId: string;
  readonly rarity: CardRarity;
  /** 显示名。旧数据中带空格（如 `红 皇 后`），保留原样。 */
  readonly name: string;
  /** 展示用等级，来自 rarity 映射或旧 JSON 的 `level` 覆盖值。 */
  readonly level: number;

  /** 基础攻击力。`incomplete` 卡为 0 且不代表有效数值。 */
  readonly atk: number;
  /** 基础生命值上限。 */
  readonly hp: number;
  /** 部署冷却回合数。 */
  readonly cd: number;

  /**
   * 原始 trait 字符串，**保持旧 JSON 的原始顺序与重复项**。
   * 图鉴与详情页直接展示这个数组；PLAN 第 4.3 节要求未完成项在此可见。
   */
  readonly rawTraits: readonly string[];

  /**
   * 解析后的技能规格，与 `rawTraits` 等长、按位对应。
   * 无法解析的项产出 `unimplemented`/`ambiguous` 记录，而不是被丢弃。
   */
  readonly skills: readonly SkillSpec[];

  readonly description: string;
  readonly status: CardStatus;

  /** 资源 ID。与规则数据解耦，URL 由资源 manifest 提供。 */
  readonly art: CardArtRef;
}

/** 卡面资源引用。只存 ID，不存路径。 */
export interface CardArtRef {
  /** 资源 manifest 中的键，例如 `card/A_001`。 */
  readonly artId: string;
  /** 是否已确认源 PNG 存在（导入期核对，不做运行时探测）。 */
  readonly sourcePresent: boolean;
}

/** 战斗中的区域。 */
export type ZoneId = 'deck' | 'hand' | 'prep' | 'battle' | 'discard';

/** 阵营。旧版的 player/enemy 与 player1/player2 混用已统一到这里。 */
export type SideId = 'player' | 'enemy';

/**
 * 战斗中的卡牌实例。
 *
 * 与 `CardDefinition` 的关键区别：实例持有可变战斗状态。
 * 同一个 `instanceId` 在整场战斗中不变；卡牌换区只改 `zone` 与 `slotIndex`。
 */
export interface CardInstance {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly owner: SideId;
  zone: ZoneId;
  /** 区域内的槽位下标；`deck`/`discard` 为 -1。 */
  slotIndex: number;
  /**
   * 所属状态组。战斗中的可变数值（HP/ATK）一律存在组上，不在实例上。
   *
   * 这样建模是因为旧版的分身**共享同一个 `CardData` 对象**
   * （`game/skills/skill_effects.py:817`），共享的是 HP 与 ATK 两者，
   * 不只是生命。把数值放在组上，「分身受伤处处可见」就是自动成立的，
   * 而不是靠两处同步去维持。
   *
   * 复制（`skill_effects.py:858` 的 deepcopy）另起一个组，因此天然独立。
   */
  stateGroupId: string;
  /** 部署后剩余冷却回合。CD 是槽位级的，不共享。 */
  cd: number;
  /** 是否处于飞行状态（场景规则，非技能族）。 */
  flying: boolean;
  /** 本轮已经攻击过，防止重复行动。 */
  hasAttackedThisTurn: boolean;
  /** 不死/复活等一次性的消耗标记。 */
  readonly marks: CardMarks;
}

/** 需要跨回合保留的一次性标记。 */
export interface CardMarks {
  /** Granted dodge level; removed when this instance leaves battle. */
  grantedDodge?: number;
  /** Only while a one-use card resolves its deployment cast (including zero-HP spell cards). */
  deploymentCast?: boolean;
  /** 不死：致命伤害时保留 1 点生命，之后清除。 */
  undyingUsed: boolean;
  /** 复活：已经触发过复活。 */
  revivedUsed: boolean;
  /** 免疫：技能伤害免疫生效中。 */
  skillImmune: boolean;
  /** 沉默：技能不触发。 */
  silenced: boolean;
}

/**
 * 分身共享的战斗状态组。
 *
 * 旧版分身的多个槽位引用**同一个 `CardData` 对象**，因此共享 HP 与其它可变属性。
 * 新版保留这一语义，但把共享范围显式建模，避免“模板被实例修改”的污染。
 * 复制（copy）不加入任何共享组，各自持有独立状态。
 */
export interface UnyieldingState {
  active: boolean;
  used: boolean;
  /** The next full friendly turn after the lethal hit. */
  expiresAfterTurn: number;
}

export interface CombatStateGroup {
  /** Shared by clones; activation is consumed once per deployment lifecycle. */
  unyielding?: UnyieldingState;
  readonly groupId: string;
  readonly owner: SideId;
  /** 当前生命值。组内任一成员受击都会改动这里——分身共享的就是它。 */
  hp: number;
  /**
   * 生命上限。
   *
   * 旧版的祝福是「ATK+n 且 HP+n（当前 HP 一起提高）」，
   * 因此上限也必须能被提高。若让它固定，后面任何一次治疗按上限截断，
   * 都会把祝福加的血**压回去**——旧版就有这个毛病（`min(max_hp, hp + n)`），
   * 这里按「祝福同时提高上限」处理，并在差异记录里写明。
   */
  maxHp: number;
  /** 当前攻击力，含战斗中的增减益。 */
  atk: number;
  /** 组内成员的 instanceId，按创建顺序。分身会有多个，复制只有一个。 */
  readonly memberIds: string[];
  /**
   * 死亡是否已经处理过。
   *
   * 分身共享一份状态，因此整组只处理**一次**死亡：一次弃牌、一次死亡技能。
   * 旧版靠 `id(card_data)` 分组做到这一点，这里靠这个标记。
   */
  deathHandled: boolean;
}
