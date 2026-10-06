import { easeInOutCubic } from '../anim/easings';

export const FUSION_SECONDS = 2.4;
export const FUSION_CONVERGE_SECONDS = 0.9;
export const FUSION_REVEAL_SECONDS = 1.1;
export const FUSION_RADIUS = 2.05;

export function fusionSlotPosition(index: number): readonly [number, number, number] {
  const angle = (-90 + index * 72) * Math.PI / 180;
  return [Math.cos(angle) * FUSION_RADIUS, -Math.sin(angle) * FUSION_RADIUS, 0.04];
}

export function fusionMaterialPose(index: number, elapsed: number): {
  readonly position: readonly [number, number, number]; readonly scale: number; readonly visible: boolean;
} {
  const slot = fusionSlotPosition(index);
  const t = easeInOutCubic(Math.min(1, Math.max(0, elapsed) / FUSION_CONVERGE_SECONDS));
  return { position: [slot[0] * (1 - t), slot[1] * (1 - t), 0.04 + t * 0.35], scale: 0.82 * (1 - t * 0.95), visible: t < 1 };
}

export function fusionResultPose(elapsed: number): { readonly visible: boolean; readonly scale: number; readonly rotationY: number } {
  const t = Math.min(1, Math.max(0, (elapsed - FUSION_REVEAL_SECONDS) / 0.7));
  return { visible: elapsed >= FUSION_REVEAL_SECONDS, scale: 1.28 * (0.35 + 0.65 * easeInOutCubic(t)), rotationY: (1 - t) * Math.PI };
}
