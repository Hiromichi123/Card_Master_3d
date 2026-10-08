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
    summary: '上场立即执行一次技能与有效攻击，随后 HP 归零并离场；自毁最后结算' },

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
  { id: 'berserk', sourceName: '狂暴', category: 'special', hasParam: false, purity: 'declarative',
    summary: '当前缺失 HP 等量转换为动态 ATK，受伤增加、回血回落，不主动自伤' },
  { id: 'explodeOnDeath', sourceName: '群体爆裂n', category: 'blast', hasParam: true, purity: 'scene',
    summary: '离场时原地爆裂并向敌方全体发炮；默认 2 伤害，带数字时使用该值' },

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

  // ---- 本项目新增（1）------------------------------------------------------
  /*
    旧注册表里**没有**这一族（旧项目只到卡面数据为止，没有实现），
    但 `S+_001` 的卡面写着「圣盾1」，所以由本项目补上，见 docs/rules.md。
    与唯一那张带它的卡的来源地 `assets/outputs/S+/cards.json:3` 对齐。
  */
  { id: 'holyShield', sourceName: '圣盾n', category: 'defenseHeal', hasParam: true, purity: 'pure',
    summary: '受到的伤害各减 n 点；普通攻击与技能伤害都触发（防御只挡普通攻击）' },
  // 3D 用户明确指定的新机制（旧版未实现）。
  { id: 'ranged', sourceName: '远射', category: 'special', hasParam: false, purity: 'declarative',
    summary: '普通攻击越过对位卡直击对方本体，留下直线烟雾拖尾' },
  { id: 'piercing', sourceName: '贯穿n', category: 'special', hasParam: true, purity: 'declarative',
    summary: '攻击前独立对本体造成 n 点伤害，金色光线拖尾，无爆炸；不改变普通攻击目标' },
  { id: 'directDamage', sourceName: '伤害n', category: 'special', hasParam: true, purity: 'pure',
    summary: '攻击前对随机敌方单位单独造成 n 点普通攻击，与贯穿n独立结算' },
  { id: 'instantDeath', sourceName: '即死n', category: 'special', hasParam: true, purity: 'scene',
    summary: '黑色诅咒命中随机敌方单位，立刻清空 HP 并离场' },
  { id: 'spellReflect', sourceName: '法术反弹', category: 'special', hasParam: false, purity: 'declarative',
    summary: '在场时立即将敌方进攻法术整个反射回施法方，一次法术只反射一次' },
  { id: 'grantDodge', sourceName: '闪避赋予n', category: 'buff', hasParam: true, purity: 'pure',
    summary: '给随机友方闪避n，持续至离场，重复赋予保留最高等级' },
  { id: 'groupPhysicalDamage', sourceName: '群体伤害n', category: 'afterAttack', hasParam: true, purity: 'scene',
    summary: '敌方全体分别受到 n 点普通攻击，正常触发防御、闪避与反击' },
  { id: 'slash', sourceName: '斩击n', category: 'element', hasParam: true, purity: 'pure',
    summary: '攻击前对当前对位单位造成 n 点技能伤害，交叉两道弧形刀光' },
  { id: 'groupSlash', sourceName: '群体斩击n', category: 'element', hasParam: true, purity: 'pure',
    summary: '攻击前对敌方全部战斗单位各造成 n 点技能伤害' },
  { id: 'swordDance', sourceName: '剑舞n', category: 'special', hasParam: true, purity: 'pure',
    summary: '对位直接扣除 n HP，多方向连续弧斩，无视飞行、防御、闪避、免疫、圣盾和法术反弹' },
  { id: 'groupSwordDance', sourceName: '群体剑舞n', category: 'special', hasParam: true, purity: 'pure',
    summary: '敌方全部战斗单位各直接扣除 n HP，多段刀光不重复乘算伤害' },
  { id: 'sacrifice', sourceName: '献祭n', category: 'defenseHeal', hasParam: true, purity: 'scene',
    summary: '每个自身回合从其它在场友方总共吸取至多 n HP，按实际吸取量恢复自身，满血或无友方时跳过' },
  { id: 'execute', sourceName: '斩杀', category: 'special', hasParam: false, purity: 'scene',
    summary: '己方攻击前，若对位当前 HP 严格低于自身当前 HP，立即击杀并离场，深红剑舞' },
  { id: 'teleport', sourceName: '传送', category: 'special', hasParam: false, purity: 'pure',
    summary: '每个自身回合随机重排敌方战斗卡顺序，保持空槽并同步真实对位关系' },
  { id: 'groupPiercing', sourceName: '群体贯穿n', category: 'special', hasParam: true, purity: 'pure',
    summary: '五条平行金色贯穿光线，每条独立对敌方本体造成 n 点伤害，不伤害战斗卡' },
  { id: 'criticalCollapse', sourceName: '临点坍缩', category: 'afterAttack', hasParam: false, purity: 'scene',
    summary: '普攻实际命中对位时，减伤后超过对位剩余 HP 的伤害返还自身，红色斩击' },
  { id: 'unyielding', sourceName: '不屈', category: 'special', hasParam: false, purity: 'declarative',
    summary: '首次 HP 归零后继续在场行动，到下一个自身回合结束离场，鲜红边缘暗中心遮罩' },
  { id: 'splash', sourceName: '溅射', category: 'afterAttack', hasParam: false, purity: 'scene',
    summary: '普攻命中对位，两侧各受到 floor(原始 ATK/2) 普攻伤害' },
  { id: 'groupDelay', sourceName: '群体延迟n', category: 'deckPrep', hasParam: true, purity: 'pure',
    summary: '敌方全部等待区卡牌 CD+n' },
  { id: 'severeFrost', sourceName: '严霜n', category: 'afterAttack', hasParam: true, purity: 'scene', summary: '受敌方普攻后给攻击者严霜，下次主动普攻后碎冰并受 n 技能伤害，一回合' },
  { id: 'burning', sourceName: '燃烧n', category: 'afterAttack', hasParam: true, purity: 'scene', summary: '受敌方普攻后给攻击者燃烧，下次主动普攻后火球爆发并受 n 技能伤害，一回合' },
  { id: 'venom', sourceName: '剧毒n', category: 'afterAttack', hasParam: true, purity: 'scene', summary: '受敌方普攻后给攻击者剧毒，下次主动普攻后毒雾爆发并受 n 技能伤害，一回合' },
  { id: 'bleeding', sourceName: '流血n', category: 'afterAttack', hasParam: true, purity: 'scene', summary: '受敌方普攻后给攻击者流血，下次主动普攻后大量流血并受 n 技能伤害，一回合' },
  { id: 'grievousWound', sourceName: '重伤n', category: 'afterAttack', hasParam: true, purity: 'scene', summary: '受敵方普攻后给攻击者重伤，下次主动普攻后 ATK-n，一回合到期恢复实际扣除量' },
  { id: 'poisonCloud', sourceName: '毒雾n', category: 'element', hasParam: true, purity: 'pure', summary: '随机敌方受随机 1-n 技能伤害，并获得剧毒n；绿色无实体气团抛射爆发' },
  { id: 'antiAir', sourceName: '对空', category: 'special', hasParam: false, purity: 'declarative', summary: '普通攻击能够命中在场飞行单位，仍遵循普通减伤与闪避，无额外动画' },
  { id: 'groupGround', sourceName: '群体禁飞', category: 'special', hasParam: false, purity: 'declarative', summary: '在场光环压制敌方全部飞行，包含后续入场单位；光环消失恢复飞行，无施法动画' },
  { id: 'siege', sourceName: '攻城', category: 'special', hasParam: false, purity: 'declarative', summary: '普攻直接命中敌方本体，保留普通卡牌前冲，无炮弹或额外特效' },
  { id: 'concealment', sourceName: '隐匿', category: 'special', hasParam: false, purity: 'declarative', summary: '规避本次入场后真正作用于自身的第一次普通攻击；不消耗于技能或打本体' },
  { id: 'firstStrike', sourceName: '先攻', category: 'special', hasParam: false, purity: 'declarative', summary: '己方攻击顺序优先于普通单位，多个先攻仍按原槽位顺序；不改变位置和对位' },
  { id: 'devour', sourceName: '吞噬', category: 'deckPrep', hasParam: false, purity: 'pure', summary: '攻击前清空敌方全部弃牌，吞噬的牌不能再被还魂取回' },
  { id: 'alignedDeathBlast', sourceName: '爆裂n', category: 'blast', hasParam: true, purity: 'scene', summary: '死亡离场时，对死亡槽的敌方对位造成 n 点炮击；对位为空跳过' },
  { id: 'foxSpiritSummon', sourceName: '召唤狐灵', category: 'copy', hasParam: false, purity: 'scene', summary: '上场在己方空位召唤独立的 #yoroi_009 火焰狐灵，满场跳过，兼容狐灵召唤' },
  { id: 'masterpiece', sourceName: '至高之作', category: 'copy', hasParam: false, purity: 'scene', summary: '上场时在己方第一个空战斗槽召唤独立的 A+_006 蒸汽艺术，满场跳过' },
  { id: 'vanguard', sourceName: '先锋', category: 'special', hasParam: false, purity: 'declarative', summary: '在场且 HP>0 时优先替友方承受可命中的普通攻击，多先锋按槽位择一，不递归转移' },
  { id: 'lethalStrike', sourceName: '必杀n', category: 'special', hasParam: true, purity: 'scene', summary: '攻击前以 20%−10%×0.5^(n−1) 概率直接击杀对位，成功时播放即死动画' },
] as const satisfies readonly SkillFamily[];

export type SkillFamilyId = (typeof SKILL_FAMILIES)[number]['id'];

/** 旧项目里在战斗场景实现、不属于注册表的规则。 */
export const SCENE_RULE_TRAITS = ['飞行'] as const;
export type SceneRuleTrait = (typeof SCENE_RULE_TRAITS)[number];

export const SKILL_FAMILY_BY_ID: ReadonlyMap<string, SkillFamily> = new Map(
  SKILL_FAMILIES.map((family) => [family.id, family]),
);

/** 旧版 35 族 + 用户指定的 3 个新版族。 */
export const LEGACY_FAMILY_COUNT = 35;

/**
 * 本项目新增的族（旧注册表里没有这几个）。
 *
 * 数据自检里「技能族」这个数 = 旧注册表的 35 **加上**这里列出的几个，
 * 所以它不再是 35——两个数不一样是**预期**，不是漂移。
 * 新加族时把它加进这个数组，`EXPECTED_FAMILY_COUNT` 会跟着走。
 */
export const EXTRA_FAMILY_IDS = ['holyShield', 'ranged', 'piercing', 'directDamage', 'instantDeath', 'spellReflect', 'grantDodge', 'groupPhysicalDamage', 'slash', 'groupSlash', 'swordDance', 'groupSwordDance', 'sacrifice', 'execute', 'teleport', 'groupPiercing', 'criticalCollapse', 'unyielding', 'splash', 'groupDelay', 'severeFrost', 'burning', 'venom', 'bleeding', 'grievousWound', 'poisonCloud', 'antiAir', 'groupGround', 'siege', 'concealment', 'firstStrike', 'devour', 'masterpiece', 'vanguard', 'lethalStrike', 'alignedDeathBlast', 'foxSpiritSummon'] as const;

/** 表里应有的族数。 */
export const EXPECTED_FAMILY_COUNT = LEGACY_FAMILY_COUNT + EXTRA_FAMILY_IDS.length;
