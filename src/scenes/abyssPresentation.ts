export const ABYSS_DEPART_MS = 600;
export const ABYSS_DARKEN_MS = 1800;
export const ABYSS_BLACK_MS = 600;
export const ABYSS_REVEAL_MS = 1600;
export const ABYSS_REVEAL_FLASH_DELAY_MS = 650;
export const ABYSS_STILL_DARKEN_MS = 120;
export const ABYSS_STILL_REVEAL_MS = 180;
export const ABYSS_HUD_DELAY_MS = 1000;
export const ABYSS_BUTTON_ENTER_MS = 900;
export const ABYSS_BUTTON_STAGGER_MS = 160;
export const ABYSS_UI_FADE_MS = 180;
export const ABYSS_HOME_SETTLE_WAIT_MS = 1000;
export const ABYSS_HOME_SHIFT_MS = 1000;
export const ABYSS_LOAD_TIMEOUT_MS = 12000;
export const ABYSS_LIGHTNING_INTERVAL_MS = 15000;
export const ABYSS_FLASH_MS = 700;

/** 一次主闪后连续衰减，不使用反复开关的爆闪序列。 */
export function abyssFlashIntensity(elapsed: number): number {
  if (elapsed < 0 || elapsed >= ABYSS_FLASH_MS) return 0;
  if (elapsed < 45) return elapsed / 45;
  return Math.exp(-(elapsed - 45) / 135) * (1 - elapsed / ABYSS_FLASH_MS);
}
