import { Color, type Vector3 } from 'three';
import type { Timeline } from '../anim/Timeline';
import type { ParticlePool } from './ParticlePool';
import type { SkillVisualFactory } from './SkillVisualPool';
import type { EffectTemplateId } from './familyMap';
import { buildSkillTimeline } from './skillRecipes';

export { FAMILY_TO_EFFECT, type EffectTemplateId } from './familyMap';

/**
 * One recipe/Timeline drives both pooled particles and bounded 3D geometry.
 * Targets are frozen when the request starts. Neither layer executes combat rules.
 */
export interface EffectContext {
  readonly pool: ParticlePool;
  readonly family?: string | undefined;
  readonly visuals?: SkillVisualFactory | undefined;
  readonly from: Vector3;
  readonly to: Vector3;
  readonly extraTargets: readonly Vector3[];
  readonly color: Color;
  readonly tint?: Color | undefined;
  readonly intensity: number;
  readonly countScale: number;
  readonly durationScale: number;
  readonly onHit?: (() => void) | undefined;
}
export interface EffectRecipe {
  readonly id: EffectTemplateId;
  readonly cameraShake: number;
  build(context: EffectContext): Timeline;
}

export const EFFECT_TEMPLATE_IDS = [
  'frostRetaliation', 'burnMark', 'poisonLance', 'bleedMark', 'grievousMark', 'poisonCloud', 'frostShatter', 'burnBurst', 'poisonBurst', 'bloodBurst', 'grievousPulse',
  'normalAttack', 'slash', 'groupSlash', 'swordDance', 'groupSwordDance', 'fireball', 'iceSeal', 'lightning', 'groupFireball',
  'groupIceSeal', 'groupLightning', 'shield', 'heal', 'buff', 'debuff', 'curse', 'instantDeath', 'dodgeGrant', 'injury',
  'flow', 'status', 'bombard', 'groupBombard', 'deathBombard', 'ranged', 'piercing', 'groupPiercing', 'deathBurst', 'groupHeal', 'armorBreak',
  'dodge', 'lifeDrain', 'rebirth', 'clone', 'cooldown', 'silence', 'flyingDeploy',
] as const satisfies readonly EffectTemplateId[];

const SHAKE: Partial<Record<EffectTemplateId, number>> = {
  normalAttack: 0, fireball: 0.5, groupFireball: 0.7, lightning: 0.55,
  groupLightning: 0.75, iceSeal: 0.2, groupIceSeal: 0.35, bombard: 0.6, deathBurst: 0.6,
};
export const EFFECT_RECIPES = Object.fromEntries(EFFECT_TEMPLATE_IDS.map((id) => [
  id, { id, cameraShake: SHAKE[id] ?? 0, build: (context: EffectContext) => buildSkillTimeline(id, context) },
])) as Record<EffectTemplateId, EffectRecipe>;

export const DEFAULT_EFFECT_COLOR = new Color(0.7, 0.8, 1);
