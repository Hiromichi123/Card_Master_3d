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
  | 'normalAttack'
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
  | 'flow'
  | 'status';

/**
 * 技能族 → 特效模板。
 *
 * 这是 `VISUAL_SPEC.md` 第 4 节那张对照表的代码形式。
 * P4 覆盖全部 35 族时，只需在这里补齐映射，不需要新写效果。
 */
export const FAMILY_TO_EFFECT: Record<string, EffectTemplateId> = {
  fireball: 'fireball',
  bombard: 'fireball',
  explodeOnDeath: 'fireball',
  groupFireball: 'groupFireball',
  groupBombard: 'groupFireball',
  iceSeal: 'iceSeal',
  groupIceSeal: 'groupIceSeal',
  lightning: 'lightning',
  groupLightning: 'groupLightning',
  defense: 'shield',
  armorBreak: 'shield',
  dodge: 'shield',
  immunity: 'shield',
  healAlly: 'heal',
  groupHeal: 'heal',
  selfHeal: 'heal',
  blessing: 'buff',
  groupBlessing: 'buff',
  inspire: 'buff',
  groupInspire: 'buff',
  curse: 'debuff',
  injury: 'debuff',
  vampire: 'debuff',
  berserk: 'debuff',
  selfDestruct: 'debuff',
  drawCard: 'flow',
  soulReturn: 'flow',
  haste: 'flow',
  delay: 'flow',
  clone: 'flow',
  copy: 'flow',
  undying: 'flow',
  rebirth: 'flow',
  silence: 'status',
  counter: 'normalAttack',
};
