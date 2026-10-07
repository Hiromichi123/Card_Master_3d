/**
 * 技能解析结果的类型（施工清单 P0-4 / P0-7）。
 *
 * `SkillSpec` 是**卡面 trait 字符串的解析产物**，与 `CardDefinition.rawTraits`
 * 等长、按位对应。无法解析的项不会被丢弃，而是产出 `flavor` / `unimplemented`
 * / `ambiguous` 记录，供图鉴展示与范围记录使用（PLAN 第 4.3 节）。
 */

import type { SkillFamilyId } from './families';

/**
 * 一个 trait 字符串的解析结论。
 *
 * - `implemented`   被技能注册表命中，旧版有规则实现
 * - `scene-rule`    在战斗场景里实现，不在注册表（当前只有「飞行」）
 * - `alias`         某个已注册族的命名变体；本轮**不**自动当作同一规则
 * - `flavor`        说明性文字，没有机制
 * - `unimplemented` 确认没有实现
 * - `ambiguous`     证据不足，需人工复核
 */
export type TraitResolution =
  | 'implemented'
  | 'scene-rule'
  | 'alias'
  | 'flavor'
  | 'unimplemented'
  | 'ambiguous';

/** 旧注册表用 `re.match` 而非完整匹配，这里保留这一区别以便如实复现旧行为。 */
export type TraitMatchKind = 'exact' | 'full' | 'prefix';

export interface SkillSpec {
  /** 卡面上的原始 trait 字符串，未做任何规范化。 */
  readonly raw: string;
  readonly resolution: TraitResolution;
  /** 命中的族；未命中时为 null。 */
  readonly family: SkillFamilyId | string | null;
  /** 参数 n；无参数或未命中时为 null。 */
  readonly param: number | null;
  /** 仅对 `implemented` 有意义：旧版是按哪种方式命中的。 */
  readonly matchKind?: TraitMatchKind;
  /** 人工判定的依据（`file:line` 或 grep 结论）。 */
  readonly evidence?: string;
  /** 需要额外说明时的备注。 */
  readonly note?: string;
}

/**
 * 技能触发点。
 *
 * 旧项目声明了 9 个，但**只有这 6 个有派发点**；`ON_ATTACK`、`TURN_START`、
 * `TURN_END` 在 `skill_base.py` 里有枚举但全项目没有任何调用点。
 * 按 PLAN 第 4.3 节，新版不把「枚举存在」当成新增机制的依据。
 * 详见 `docs/rules.md` 第 5 节。
 */
export type SkillTrigger =
  | 'ON_DEPLOY'
  /** 3D: once per friendly turn, after deployments and before the attack row. */
  | 'OWN_TURN'
  | 'BEFORE_ATTACK'
  | 'ON_DAMAGED'
  | 'AFTER_DAMAGED'
  | 'AFTER_ATTACK'
  | 'ON_DEATH';

/** 旧枚举里声明但从未派发的触发点，仅用于文档与测试断言。 */
export const UNDISPATCHED_TRIGGERS = ['ON_ATTACK', 'TURN_START', 'TURN_END'] as const;

/** 一个族在某个触发点上要做的纯数据改动。 */
export type SkillEffectKind =
  | 'damage'
  | 'heal'
  | 'modifyAtk'
  | 'modifyHp'
  | 'modifyCooldown'
  | 'draw'
  | 'returnFromDiscard'
  | 'createUnit'
  | 'removeSelf'
  | 'applyFlag';
