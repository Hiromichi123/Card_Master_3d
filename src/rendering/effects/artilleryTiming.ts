/** Unscaled hit times; both numeric events and Quarks timelines use this table. */
export const RANGED_HIT_SECONDS = 0.065;
/** Visual distance beyond the base impact point, scaled with card size. */
export const PIERCING_END_EXTENSION = 2.4;
export const BOMBARD_HIT_SECONDS = 0.36;
export const DEATH_BOMBARD_HIT_SECONDS = 0.32;

export function quarksTiming(template: string): { charge: number; travel: number; impact: number; fade: number } {
  if (template === 'ranged') return { charge: 0, travel: RANGED_HIT_SECONDS, impact: 0.11, fade: 3.05 };
  if (template === 'piercing' || template === 'groupPiercing') return { charge: 0, travel: RANGED_HIT_SECONDS, impact: 0.08, fade: 2.20 };
  if (template === 'deathBurst') return { charge: 0, travel: 0, impact: 0.18, fade: 1.9 };
  if (template === 'deathBombard') return { charge: 0, travel: DEATH_BOMBARD_HIT_SECONDS, impact: 0.35, fade: 2.1 };
  return { charge: 0.04, travel: BOMBARD_HIT_SECONDS - 0.04, impact: 0.35, fade: 2.1 };
}
