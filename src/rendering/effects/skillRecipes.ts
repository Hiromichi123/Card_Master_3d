import { Color, Vector3 } from 'three';
import { Timeline } from '../anim/Timeline';
import { ATTACK_OUT_SECONDS, ATTACK_RETURN_SECONDS } from '../anim/combatMotion';
import type { EffectContext } from './templates';
import type { EffectTemplateId } from './familyMap';
import { attackStatusTiming } from './attackStatusTiming';
import { usesAttackStatusVisual } from './AttackStatusSkillVisuals';
import { usesLinearAbility } from './NamedSkillVisuals';
import { usesQuarks } from './QuarksSkillVisuals';
import { quarksTiming } from './artilleryTiming';
import { LAYOUT } from '../battle/layout';
import { slashTiming, usesSlash } from './slashTiming';
import type { SkillVisualHandle, VisualPhase } from './SkillVisualPool';

const UP = new Vector3(0, 1, 0);
const PALETTE = {
  fire: new Color('#ff7c35'), ice: new Color('#84eaff'), bolt: new Color('#b3dfff'),
  heal: new Color('#65ffba'), gold: new Color('#ffe2a3'), blood: new Color('#ff4571'),
  curse: new Color('#a366ed'), flow: new Color('#9ecfff'),
};

/** These durations are shared with the event adapter; no damage is calculated here. */
export function skillImpactSeconds(template: EffectTemplateId): number {
  if (template === 'bloodBurst') return slashTiming('slash').hit;
  if (usesAttackStatusVisual(template) || ['bleedMark', 'grievousMark'].includes(template)) return attackStatusTiming(template).hit;
  if (template === 'dodgeGrant') return skillImpactSeconds('armorBreak');
  if (template === 'normalAttack') return ATTACK_OUT_SECONDS;
  if (usesSlash(template)) return slashTiming(template).hit;
  if (usesQuarks(template)) { const timing = quarksTiming(template); return timing.charge + timing.travel; }
  if (template === 'lightning' || template === 'groupLightning') return 0.26;
  if (['heal', 'groupHeal', 'buff', 'shield', 'armorBreak', 'dodge', 'rebirth', 'clone', 'cooldown', 'silence', 'status'].includes(template)) return 0.3;
  return 0.42;
}

export function buildSkillTimeline(template: EffectTemplateId, context: EffectContext): Timeline {
  // Bleeding's attack-after effect is the same authored two-arc slash, in deep red.
  if (template === 'bloodBurst') return buildSkillTimeline('slash', { ...context, tint: context.tint ?? new Color('#a71935') });
  // Keep the legacy entry point identical to armor break, including every phase.
  if (template === 'dodgeGrant') return buildSkillTimeline('armorBreak', { ...context, tint: context.tint ?? new Color('#ffd77a') });
  if (context.family === 'grantDodge' && !context.tint) {
    return buildSkillTimeline(template, { ...context, tint: new Color('#ffd77a') });
  }
  const { pool, from, to } = context;
  const motionScale = Math.max(0.01, context.durationScale);
  if (template === 'burnMark') {
    // Applying the status starts ONE reveal on the actual card. Never overlay a second transient crack actor.
    return new Timeline().add({ duration: attackStatusTiming(template).hit * motionScale,
      onComplete: () => context.onHit?.() });
  }
  if (usesAttackStatusVisual(template) || ['bleedMark', 'grievousMark'].includes(template)) {
    const handle = context.visuals?.create({ template, family: context.family, from, to, intensity: context.intensity,
      tint: context.tint, countScale: context.countScale, durationScale: context.durationScale });
    const timing = attackStatusTiming(template);
    const hit = timing.hit;
    return new Timeline(() => handle?.dispose())
      .add({ duration: hit * motionScale, onUpdate: (t) => handle?.update('travel', t) })
      .add({ duration: timing.impact * motionScale, onStart: () => {
        if (template === 'burnBurst') {
          const count = Math.ceil(42 * Math.max(0, Math.min(2, context.countScale)));
          for (const color of ['#ff3610', '#ffd057']) pool.emit({ origin: to, count, direction: UP, spread: .95,
            color: new Color(color), colorJitter: .10, speed: [.65, 2.15], size: [.012, .030],
            life: [.28, .80], gravity: -1.2, drag: 1.1, spawnRadius: .10 });
        }
        context.onHit?.();
      }, onUpdate: (t) => handle?.update('impact', t) })
      .add({ duration: timing.fade * motionScale, onUpdate: (t) => handle?.update('fade', t) });
  }
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
  if (usesSlash(template)) {
    const points = template.startsWith('group') ? [to, ...context.extraTargets].slice(0, 8) : [to];
    const handles = points.map((target) => context.visuals?.create({ template, family: context.family,
      from, to: target, intensity: context.intensity, tint: context.tint,
      countScale: context.countScale, durationScale: context.durationScale,
    })).filter((handle): handle is SkillVisualHandle => handle !== undefined);
    const timing = slashTiming(template);
    return new Timeline(() => { for (const handle of handles) handle.dispose(); })
      .wait(timing.charge * motionScale)
      .add({ duration: timing.sweep * motionScale, onUpdate: (t) => {
        for (const handle of handles) handle.update('impact', t);
      } })
      .add({ duration: timing.fade * motionScale, onStart: () => context.onHit?.(), onUpdate: (t) => {
        for (const handle of handles) handle.update('fade', t);
      } });
  }
  if (usesQuarks(template)) {
    const grouped = template === 'groupBombard' || template === 'deathBombard' || context.family === 'groupBombard';
    const targets = template === 'groupPiercing' ? Array.from({ length: 5 }, (_, index) =>
      new Vector3((index - 2) * LAYOUT.battleSpacing, to.y, to.z))
      : grouped ? [to, ...context.extraTargets].slice(0, 8) : [to];
    const handles = targets.map((target, index) => context.visuals?.create({
      template: template === 'groupPiercing' ? 'piercing' : template, family: context.family,
      // Each lane starts over its own friendly slot and stays aligned with the opposing slot.
      from: template === 'groupPiercing' ? new Vector3(target.x, from.y, from.z) : from,
      to: target, intensity: context.intensity, tint: context.tint,
      countScale: context.countScale, durationScale: context.durationScale,
      sourceBurst: template !== 'deathBombard' || index === 0,
    })).filter((handle): handle is SkillVisualHandle => handle !== undefined);
    const timing = quarksTiming(template);
    const update = (phase: VisualPhase, t: number): void => { for (const handle of handles) handle.update(phase, t); };
    return new Timeline(() => { for (const handle of handles) handle.dispose(); })
      .add({ duration: timing.charge * motionScale, onUpdate: (t) => update('charge', t) })
      .add({ duration: timing.travel * motionScale, onUpdate: (t) => update('travel', t) })
      .add({ duration: timing.impact * motionScale, onStart: () => context.onHit?.(), onUpdate: (t) => update('impact', t) })
      .add({ duration: timing.fade * motionScale, onUpdate: (t) => update('fade', t) });
  }
  const grouped = template.startsWith('group') || context.family?.startsWith('group') || context.family === 'teleport';
  const points = grouped ? [to, ...context.extraTargets].slice(0, 8) : [to];
  const fire = ['fireball', 'groupFireball', 'bombard', 'deathBurst'].includes(template);
  const ice = template === 'iceSeal' || template === 'groupIceSeal';
  const bolt = template === 'lightning' || template === 'groupLightning';
  const healing = template === 'heal' || template === 'groupHeal';
  const blood = template === 'lifeDrain';
  const snare = template === 'curse' || template === 'injury' || template === 'instantDeath';
  const injury = template === 'injury';
  const color = context.tint ?? (fire ? PALETTE.fire : ice ? PALETTE.ice : bolt ? PALETTE.bolt : healing ? PALETTE.heal :
    template === 'instantDeath' ? new Color('#120e18') : blood || injury ? PALETTE.blood : template === 'buff' ? PALETTE.gold :
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

