import type { EffectTemplateId } from './familyMap';

/** Shared by the authored shader, its Timeline, and the battle presentation beat. */
export const SLASH_RADIUS = 1.7;
export const SLASH_WIDTH = 0.5;
export const SLASH_LIFETIME = 0.65;
export const SLASH_SWEEP_SECONDS = 0.18;
export const SLASH_CROSS_DELAY = 0.055;
export const SWORD_DANCE_STEP_SECONDS = 0.11;
export const SWORD_DANCE_ARCS = 6;

export function usesSlash(template: EffectTemplateId): boolean {
  return ['slash', 'groupSlash', 'swordDance', 'groupSwordDance'].includes(template);
}

export function slashTiming(template: EffectTemplateId): { charge: number; sweep: number; fade: number; hit: number } {
  const dance = template === 'swordDance' || template === 'groupSwordDance';
  const charge = dance ? 0.08 : 0.06;
  const lastDelay = dance ? (SWORD_DANCE_ARCS - 1) * SWORD_DANCE_STEP_SECONDS : SLASH_CROSS_DELAY;
  const sweep = lastDelay + SLASH_SWEEP_SECONDS;
  return { charge, sweep, fade: SLASH_LIFETIME - SLASH_SWEEP_SECONDS, hit: charge + sweep };
}
