import { Vector3, type Camera } from 'three';
import type { AbyssRun } from '../domain/progression/abyssTypes';
import { pilePosition } from '../rendering/battle/layout';

export const ABYSS_COLLECT_MS = 600;
export const ABYSS_COLLECT_STAGGER_MS = 70;
export const ABYSS_COLLECT_TOTAL_MS = ABYSS_COLLECT_MS + 5 * ABYSS_COLLECT_STAGGER_MS;

export function isAbyssPreparation(run: AbyssRun | null | undefined): boolean {
  return !!run && ['starterDraft', 'boonChoice', 'battleReady', 'inBattle'].includes(run.stage.kind);
}

/** 返回CSS像素坐标，不乘DPR；使用正式战斗同一牌堆位置。 */
export function projectAbyssPile(camera: Camera, rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>) {
  const position = new Vector3(...pilePosition('player', 'deck')).project(camera);
  return { x: rect.left + (position.x + 1) * rect.width / 2,
    y: rect.top + (1 - position.y) * rect.height / 2 };
}
