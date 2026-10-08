/**
 * 技能族 → 特效模板的对照表。
 *
 * **单独一个文件，是为了不 import three。**
 * 演出层（`rendering/presentation/`）需要这张表把 `SkillTriggered` 事件翻成特效请求，
 * 而它整层是不依赖 three 的纯逻辑，能在 node 环境里直接跑单测。
 * 表留在 `templates.ts` 里的话，演出层为了查一次映射就要把整个粒子模板模块拖进来。
 *
 * `templates.ts` 会原样再导出这两个符号，所以既有调用方不用改。
 */

export type EffectTemplateId =
  | 'frostRetaliation'
  | 'burnMark'
  | 'poisonLance'
  | 'bleedMark'
  | 'grievousMark'
  | 'poisonCloud'
  | 'frostShatter'
  | 'burnBurst'
  | 'poisonBurst'
  | 'bloodBurst'
  | 'grievousPulse'
  | 'normalAttack'
  | 'slash'
  | 'groupSlash'
  | 'swordDance'
  | 'groupSwordDance'
  | 'fireball'
  | 'iceSeal'
  | 'lightning'
  | 'groupFireball'
  | 'groupIceSeal'
  | 'groupLightning'
  | 'shield'
  | 'heal'
  | 'buff'
  | 'debuff'
  | 'curse'
  | 'instantDeath'
  | 'dodgeGrant'
  | 'injury'
  | 'flow'
  | 'status'
  | 'bombard'
  | 'groupBombard'
  | 'deathBombard'
  | 'ranged'
  | 'piercing'
  | 'groupPiercing'
  | 'deathBurst'
  | 'groupHeal'
  | 'armorBreak'
  | 'dodge'
  | 'lifeDrain'
  | 'rebirth'
  | 'clone'
  | 'cooldown'
  | 'silence'
  | 'flyingDeploy';

/**
 * 技能族 → 特效模板。
 *
 * 这是 `VISUAL_SPEC.md` 第 4 节那张对照表的代码形式。
 * P4 覆盖全部 35 族时，只需在这里补齐映射，不需要新写效果。
 */
export const FAMILY_TO_EFFECT: Record<string, EffectTemplateId> = {
  lethalStrike: 'instantDeath', masterpiece: 'flow',
  splash: 'normalAttack', groupDelay: 'cooldown', severeFrost: 'frostRetaliation',
  burning: 'burnMark', venom: 'poisonLance', bleeding: 'bleedMark', grievousWound: 'grievousMark', poisonCloud: 'poisonCloud',
  sacrifice: 'lifeDrain',
  execute: 'swordDance',
  teleport: 'flow',
  slash: 'slash',
  groupSlash: 'groupSlash',
  swordDance: 'swordDance',
  groupSwordDance: 'groupSwordDance',
  fireball: 'fireball',
  bombard: 'bombard',
  explodeOnDeath: 'deathBombard',
  ranged: 'ranged',
  piercing: 'piercing',
  groupPiercing: 'groupPiercing',
  criticalCollapse: 'slash',
  unyielding: 'status',
  groupFireball: 'groupFireball',
  groupBombard: 'groupBombard',
  iceSeal: 'iceSeal',
  groupIceSeal: 'groupIceSeal',
  lightning: 'lightning',
  groupLightning: 'groupLightning',
  defense: 'shield',
  armorBreak: 'armorBreak',
  dodge: 'dodge',
  immunity: 'shield',
  healAlly: 'heal',
  groupHeal: 'groupHeal',
  selfHeal: 'heal',
  blessing: 'buff',
  groupBlessing: 'buff',
  inspire: 'buff',
  groupInspire: 'buff',
  curse: 'curse',
  instantDeath: 'instantDeath',
  grantDodge: 'armorBreak',
  spellReflect: 'shield',
  directDamage: 'normalAttack',
  groupPhysicalDamage: 'normalAttack',
  injury: 'injury',
  vampire: 'lifeDrain',
  selfDestruct: 'deathBurst',
  drawCard: 'flow',
  soulReturn: 'rebirth',
  haste: 'cooldown',
  delay: 'cooldown',
  clone: 'clone',
  copy: 'clone',
  undying: 'rebirth',
  rebirth: 'rebirth',
  silence: 'silence',
  counter: 'normalAttack',
  /** 圣盾：演出与护盾/防御**同一段**，只把颜色换成金色（见 `FAMILY_TINT`）。 */
  holyShield: 'shield',
};

/**
 * 个别族换颜色用的覆盖表。
 *
 * 模板自带的颜色是按**效果**定的（护盾是蓝的、火球是橙的），可一个模板会被几个族共用，
 * 它们未必该同色——圣盾正是这种情况：动画照旧，颜色换金。
 * 值直接进 `EffectRequest.color`（十六进制字符串）。
 *
 * 放在这个文件里而不是各调用点：演出层（战斗）与实验台都要用同一份，
 * 两处各写一遍迟早会漂。这里不 import three，所以纯逻辑的演出层可以照常引用。
 */
export const FAMILY_TINT: Record<string, string> = {
  venom: '#49a82b', poisonCloud: '#49a82b', bleeding: '#a51b34', grievousWound: '#480919',
  holyShield: '#ffd77a',
  grantDodge: '#ffd77a',
  spellReflect: '#c5ecff',
  instantDeath: '#120e18',
  lethalStrike: '#120e18',
  execute: '#9e1235',
  criticalCollapse: '#ff1646',
};
