/** Presentation-only movement and number pacing; combat values are never calculated here. */
export const FLYING_CARD_LIFT = 0.475;
export const ATTACK_OUT_SECONDS = 0.12;
export const ATTACK_RETURN_SECONDS = 0.18;
export const HP_FLASH_SECONDS = 0.18;

export function attackAdvance(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  const peak = ATTACK_OUT_SECONDS / (ATTACK_OUT_SECONDS + ATTACK_RETURN_SECONDS);
  return t <= peak ? (t / peak) ** 2 : ((1 - t) / (1 - peak)) ** 2;
}

export function attackDistance(span: number, cardDepth: number): number {
  // Account for both card edges and the cast point's offset; never close the full gap.
  return Math.min(0.5, Math.max(0, span - cardDepth - 0.5) * 0.35);
}

export function hpLossValues(before: number, after: number): number[] {
  if (!Number.isInteger(before) || !Number.isInteger(after) || after >= before) return [];
  return Array.from({ length: before - after }, (_, index) => before - index - 1);
}

export function hpStepSeconds(points: number): number {
  return Math.min(0.045, 0.35 / Math.max(1, points));
}

export function hpFlashBrightness(progress: number): number {
  if (progress <= 0 || progress >= 1) return 1;
  return 1 + 1.8 * Math.sin(Math.PI * progress) ** 2;
}
