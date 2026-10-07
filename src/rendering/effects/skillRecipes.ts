import { Color, Vector3 } from 'three';
import { Timeline } from '../anim/Timeline';
import { ATTACK_OUT_SECONDS, ATTACK_RETURN_SECONDS } from '../anim/combatMotion';
import type { EffectContext } from './templates';
import type { EffectTemplateId } from './familyMap';
import { usesLinearAbility } from './NamedSkillVisuals';
import type { SkillVisualHandle, VisualPhase } from './SkillVisualPool';

const UP = new Vector3(0, 1, 0);
const PALETTE = {
  fire: new Color('#ff7c35'), ice: new Color('#84eaff'), bolt: new Color('#b3dfff'),
  heal: new Color('#65ffba'), gold: new Color('#ffe2a3'), blood: new Color('#ff4571'),
  curse: new Color('#a366ed'), flow: new Color('#9ecfff'),
};

/** These durations are shared with the event adapter; no damage is calculated here. */
export function skillImpactSeconds(template: EffectTemplateId): number {
  if (template === 'normalAttack') return ATTACK_OUT_SECONDS;
  if (template === 'lightning' || template === 'groupLightning') return 0.26;
  if (template === 'deathBurst') return 0.14;
  if (['heal', 'groupHeal', 'buff', 'shield', 'armorBreak', 'dodge', 'rebirth', 'clone', 'cooldown', 'silence', 'status'].includes(template)) return 0.3;
  return 0.42;
}

export function buildSkillTimeline(template: EffectTemplateId, context: EffectContext): Timeline {
  const { pool, from, to } = context;
  const motionScale = Math.max(0.01, context.durationScale);
  if (template === 'normalAttack') {
    // The actual card moves in CardMesh. No particles, sphere, impact ring or target shake.
    return new Timeline().add({ duration: ATTACK_OUT_SECONDS * motionScale, onComplete: () => context.onHit?.() })
      .wait(ATTACK_RETURN_SECONDS * motionScale);
  }
  if (template === 'flyingDeploy') {
    const handle = context.visuals?.create({ template, from, to, intensity: 1, tint: new Color('white') });
    return new Timeline(() => handle?.dispose())
      .add({ duration: 0.35 * motionScale, onUpdate: (t) => handle?.update('impact', t) })
      .add({ duration: 0.22 * motionScale, onUpdate: (t) => handle?.update('fade', t), onComplete: () => context.onHit?.() });
  }
  const grouped = template.startsWith('group') || context.family?.startsWith('group');
  const points = grouped ? [to, ...context.extraTargets].slice(0, 8) : [to];
  const fire = ['fireball', 'groupFireball', 'bombard', 'deathBurst'].includes(template);
  const ice = template === 'iceSeal' || template === 'groupIceSeal';
  const bolt = template === 'lightning' || template === 'groupLightning';
  const healing = template === 'heal' || template === 'groupHeal';
  const blood = template === 'lifeDrain';
  const snare = template === 'curse' || template === 'injury';
  const injury = template === 'injury';
  const color = context.tint ?? (fire ? PALETTE.fire : ice ? PALETTE.ice : bolt ? PALETTE.bolt : healing ? PALETTE.heal :
    blood || injury ? PALETTE.blood : template === 'buff' ? PALETTE.gold :
    template === 'debuff' || template === 'curse' || template === 'silence' ? PALETTE.curse : PALETTE.flow);
  const scale = Math.max(0.05, context.durationScale);
  const countScale = Math.max(0, Math.min(4, context.countScale));
  const strength = Math.min(3, Math.max(0.6, 1 + context.intensity * 0.12));
  const count = (base: number): number => Math.ceil(base * countScale * Math.min(2, strength));
  const point = new Vector3();
  const handles: SkillVisualHandle[] = points.map((target) => context.visuals?.create({
    template, family: context.family, tint: context.tint, from, to: target, intensity: context.intensity,
  })).filter((handle): handle is SkillVisualHandle => handle !== undefined);
  const animate = (phase: VisualPhase, t: number): void => { for (const handle of handles) handle.update(phase, t); };
  const emit = (origin: Vector3, n: number, continuous: boolean, upward = false): void => {
    if (n <= 0) return;
    pool.emit({ origin, count: n, perFrame: continuous, color,
      speed: injury ? [0.05, 0.3] : upward ? [0.3, 0.8] : [0.1, continuous ? 0.4 : 2.5],
      ...(upward ? { direction: UP, spread: 0.3 } : {}),
      size: [0.045, injury ? 0.065 : fire ? 0.18 : 0.11], life: injury ? [0.14, 0.32] : [0.18, continuous ? 0.4 : 0.75],
      gravity: upward ? 0.4 : -0.65, drag: 2, spawnRadius: continuous ? 0.06 : 0.18,
    });
  };
  // There is one shared Timeline; geometry is driven by its normalized steps, not by another RAF.
  const timeline = new Timeline(() => { for (const handle of handles) handle.dispose(); });
  const impact = skillImpactSeconds(template);
  const named = usesLinearAbility(template);
  const charge = Math.min(0.1, impact * 0.35);
  timeline.add({ duration: charge * scale, onUpdate: (t) => {
    animate('charge', t); emit(from, count(2), true);
  } });
  timeline.add({ duration: (impact - charge) * scale, onUpdate: (t) => {
    animate('travel', t);
    for (const target of points) {
      point.lerpVectors(blood ? target : from, blood ? from : target, t);
      if (!bolt && !snare && !(named && ice)) point.y += Math.sin(t * Math.PI) * (fire ? 0.8 : 0.35);
      emit(point, count(bolt || (named && ice) ? 1 : 2), true);
    }
  } });
  timeline.add({ duration: (named ? (snare ? 0.38 : ice ? 0.35 : bolt ? 0.22 : 0.28) : 0.16) * scale,
    onStart: () => {
      for (const target of points) emit(target, count(fire ? 28 : ice ? (named ? 6 : 20) : injury ? 6 : healing ? 10 : 14), false, healing);
      // A group cast has one presentation callback, not one per target.
      context.onHit?.();
    },
    onUpdate: (t) => {
      animate('impact', t);
      if (healing || template === 'buff' || template === 'rebirth') for (const target of points) emit(target, count(2), true, true);
    },
  });
  timeline.add({ duration: (named ? (snare ? 0.60 : ice ? 0.68 : bolt ? 0.35 : 0.48) : ice ? 0.55 : healing ? 0.5 : 0.3) * scale,
    onUpdate: (t) => animate('fade', t),
  });
  return timeline;
}

