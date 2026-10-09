import type { MutableRefObject } from 'react';

/** All login motion uses its own seconds, independent of combat presentation speed. */
export interface LoginMotionState {
  elapsed: number;
  cruise: number;
  travel: number;
  /** Floating world origin. Camera really advances; all recycled scenery shares this origin. */
  origin: number;
  brightness: number;
  exit: number;
  still: boolean;
  authenticated: boolean;
}

export type LoginMotion = MutableRefObject<LoginMotionState>;

const FALL_SPEED = 1.5;
const PORTAL_DROP_SECONDS = 3.1 / FALL_SPEED;

export const LOGIN_TIMING = {
  title: 2,
  descent: 3.2 / FALL_SPEED,
  fallSpeed: FALL_SPEED,
  minimumCruise: 5,
  travelSpeed: 6.2,
  portalDelay: .2,
  portalDistance: 44,
  portalScale: 6,
  portalDrop: PORTAL_DROP_SECONDS,
  portalDropHeight: 38,
  portalFlipStart: PORTAL_DROP_SECONDS + .1,
  portalFlipEnd: PORTAL_DROP_SECONDS + 1.3,
  /** Speed multiplier grows as 1 + a*t^2 after the central back appears. */
  portalAcceleration: .13,
} as const;

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
export const smoothstep = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/** A deterministic visual seed; never advances the game's battle/progression RNG. */
export const noise = (seed: number): number => {
  const value = Math.sin(seed * 127.1 + 31.7) * 43758.5453123;
  return value - Math.floor(value);
};
