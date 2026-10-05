/**
 * 35 个已注册技能族的静态表。
 *
 * 来源：旧项目 `game/skills/skill_registry.py:3-39` 导入的 35 个工厂，
 * 以及 `game/skills/skill_effects.py` 中各族的实现。
 * 逐族的行为说明与行号见 `docs/SKILL_COVERAGE.md`。
 *
 * 这里只描述**族本身**（有没有参数、在哪个触发点、规则能否脱离渲染执行），
 * 不描述单张卡的参数值——那在 `CardDefinition.skills` 里。
 */

/** 族的分类，与核查记录的分组一致。 */
export type SkillCategory =
  | 'element'
  | 'deckPrep'
  | 'buff'
  | 'defenseHeal'
  | 'afterAttack'
  | 'copy'
  | 'blast'
  | 'special';

/**
 * 规则实现能否脱离渲染层。
 *
 * - `pure`：只改纯数据状态，P2 可以直接单测
 * - `scene`：旧版依赖场景对象（槽位、手牌、动画），新版需要引擎提供对应原语
 * - `declarative`：技能对象本身没有逻辑（`execute()` 返回 False），
 *   真实规则由引擎的位置/伤害管线实现
 */
export type SkillPurity = 'pure' | 'scene' | 'declarative';

export interface SkillFamily {
  /** 代码内使用的稳定 slug。 */
  readonly id: string;
  /** 旧源码里的中文族名，`n` 表示数值参数。 */
  readonly sourceName: string;
  readonly category: SkillCategory;
  /** 旧注册表用 `re.match(r"字(\d+)")` 解析参数；false 表示精确匹配无参数。 */
  readonly hasParam: boolean;
  readonly purity: SkillPurity;
  /** 单行机制说明。详细说明见 docs/SKILL_COVERAGE.md。 */
  readonly summary: string;
}

export const SKILL_FAMILIES = [
  // 元素（6）
  { id: 'fireball', sourceName: '火球n', category: 'element', hasParam: true, purity: 'pure',
    summary: '对随机一个敌方槽位造成 n 伤害' },
  { id: 'iceSeal', sourceName: '冰封n', category: 'element', hasParam: true, purity: 'pure',
    summary: '与火球n 规则相同，只造成伤害；不幸有冻结或跳过回合机制' },
  { id: 'lightning', sourceName: '闪电n', category: 'element', hasParam: true, purity: 'pure',
    summary: '与火球n 规则相同' },
  { id: 'groupFireball', sourceName: '群体火球n', category: 'element', hasParam: true, purity: 'pure',
    summary: '对全部敌人造成 n' },
  { id: 'groupIceSeal', sourceName: '群体冰封n', category: 'element', hasParam: true, purity: 'pure',
    summary: '对全部敌人造成 n；目标在施法阶段预先收集' },
  { id: 'groupLightning', sourceName: '群体闪电n', category: 'element', hasParam: true, purity: 'pure',
    summary: '对全部敌人造成 n' },

  // 牌堆与准备区（5）
  { id: 'drawCard', sourceName: '抽卡n', category: 'deckPrep', hasParam: true, purity: 'scene',
    summary: '攻击前从自己牌堆抽 n 张；牌堆不足 n 时整条效果失败' },
  { id: 'soulReturn', sourceName: '还魂n', category: 'deckPrep', hasParam: true, purity: 'scene',
    summary: '从自己弃牌堆回收 n 张；不足 n 时失败' },
  { id: 'haste', sourceName: '加速n', category: 'deckPrep', hasParam: true, purity: 'scene',
    summary: '自己最左的占用中准备槽 CD −n' },
  { id: 'delay', sourceName: '延迟n', category: 'deckPrep', hasParam: true, purity: 'scene',
    summary: '敌方最左的占用中准备槽 CD +n' },
  { id: 'selfDestruct', sourceName: '自毁', category: 'deckPrep', hasParam: false, purity: 'scene',
    summary: '自己 HP=0 并移除；不取消同回合待执行的攻击' },

  // 增益与弱化（6）
  { id: 'blessing', sourceName: '祝福n', category: 'buff', hasParam: true, purity: 'pure',
    summary: '随机友方（优先非自身）ATK+n 且 HP+n，当前 HP 一起提高' },
  { id: 'groupBlessing', sourceName: '群体祝福n', category: 'buff', hasParam: true, purity: 'pure',
    summary: '全部友方 ATK+n、HP+n' },
  { id: 'inspire', sourceName: '振奋n', category: 'buff', hasParam: true, purity: 'pure',
    summary: '上场时随机友方（含自身）只加 ATK +n' },
  { id: 'groupInspire', sourceName: '群体振奋n', category: 'buff', hasParam: true, purity: 'pure',
    summary: '上场时全部友方 ATK+n' },
  { id: 'curse', sourceName: '诅咒n', category: 'buff', hasParam: true, purity: 'pure',
    summary: '对位敌方 ATK−n，下限 0' },
  { id: 'armorBreak', sourceName: '破甲n', category: 'buff', hasParam: true, purity: 'pure',
    summary: '若对位防御者总防御 > 0，设置破甲量 n，由防御n 消耗' },

  // 防御与治疗（5）
  { id: 'defense', sourceName: '防御n', category: 'defenseHeal', hasParam: true, purity: 'pure',
    summary: '受普通攻击时把伤害减少 n，再减去已生效的破甲量' },
  { id: 'healAlly', sourceName: '治愈n', category: 'defenseHeal', hasParam: true, purity: 'pure',
    summary: '治疗随机一个受伤友方 n，无受伤友方时治疗自己；上限 max_hp' },
  { id: 'groupHeal', sourceName: '群体治愈n', category: 'defenseHeal', hasParam: true, purity: 'pure',
    summary: '治疗全部受伤友方 n' },
  { id: 'selfHeal', sourceName: '恢复n', category: 'defenseHeal', hasParam: true, purity: 'pure',
    summary: '治疗自己 n；满血则失败' },
  { id: 'vampire', sourceName: '吸血n', category: 'defenseHeal', hasParam: true, purity: 'pure',
    summary: '普通攻击造成伤害 > 0 后治疗自己固定 n（不按伤害量）' },

  // 攻击后与受击后（5）
  { id: 'injury', sourceName: '受伤n', category: 'afterAttack', hasParam: true, purity: 'pure',
    summary: '攻击后自己损失 n HP，可能自杀' },
  { id: 'counter', sourceName: '反击n', category: 'afterAttack', hasParam: true, purity: 'pure',
    summary: '受普通攻击伤害 > 0 后对攻击者造成 n' },
  { id: 'dodge', sourceName: '闪避n', category: 'afterAttack', hasParam: true, purity: 'pure',
    summary: '闪避概率 0.9 − 0.6·0.5^(n−1)，成功则伤害置 0' },
  { id: 'berserk', sourceName: '狂暴', category: 'afterAttack', hasParam: false, purity: 'pure',
    summary: '攻击后损失等于自身 ATK 的 HP，并把实际损失永久加到 ATK' },
  { id: 'explodeOnDeath', sourceName: '爆裂', category: 'blast', hasParam: false, purity: 'scene',
    summary: '死亡时对对位槽位造成固定 2 点伤害（数值写死在旧工厂里）' },

  // 单位复制（2）
  { id: 'clone', sourceName: '分身', category: 'copy', hasParam: false, purity: 'scene',
    summary: '上场时把同一张卡的数据对象放进空战斗槽，多个槽位共享 HP' },
  { id: 'copy', sourceName: '复制', category: 'copy', hasParam: false, purity: 'scene',
    summary: '攻击前深拷贝一份到空槽，拥有独立 HP；每方每回合一次' },

  // 爆破（2）
  { id: 'bombard', sourceName: '炮击n', category: 'blast', hasParam: true, purity: 'pure',
    summary: '对随机一个敌方造成 n' },
  { id: 'groupBombard', sourceName: '群体爆破n', category: 'blast', hasParam: true, purity: 'pure',
    summary: '对全部敌方造成 n' },

  // 特殊（4）——技能对象本身没有逻辑
  { id: 'silence', sourceName: '沉默', category: 'special', hasParam: false, purity: 'declarative',
    summary: '被动位置光环：对位槽位的占用者技能不触发' },
  { id: 'immunity', sourceName: '免疫', category: 'special', hasParam: false, purity: 'declarative',
    summary: '拦截技能伤害；普通攻击伤害绕过它' },
  { id: 'undying', sourceName: '不死', category: 'special', hasParam: false, purity: 'declarative',
    summary: '死亡后回到手牌，没有一次性标记' },
  { id: 'rebirth', sourceName: '复活', category: 'special', hasParam: false, purity: 'declarative',
    summary: '死亡后回到准备区，带一次性标记，需要空准备槽' },
] as const satisfies readonly SkillFamily[];

export type SkillFamilyId = (typeof SKILL_FAMILIES)[number]['id'];

/** 旧项目里在战斗场景实现、不属于注册表的规则。 */
export const SCENE_RULE_TRAITS = ['飞行'] as const;
export type SceneRuleTrait = (typeof SCENE_RULE_TRAITS)[number];

export const SKILL_FAMILY_BY_ID: ReadonlyMap<string, SkillFamily> = new Map(
  SKILL_FAMILIES.map((family) => [family.id, family]),
);

/** 旧注册表的工厂数量，用于断言 35 这个数字没有漂移。 */
export const EXPECTED_FAMILY_COUNT = 35;
