import { describe, expect, it, vi } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { cardDatabase } from '../../src/data';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import type { AbyssRun } from '../../src/domain/progression/abyssTypes';
import { pilePosition } from '../../src/rendering/battle/layout';
import { ABYSS_COLLECT_MS, ABYSS_COLLECT_STAGGER_MS, ABYSS_COLLECT_TOTAL_MS, isAbyssPreparation, projectAbyssPile } from '../../src/scenes/abyssPreparation';

function draft(): AbyssRun {
  const now = new Date('2026-10-12T10:00:00Z');
  const profile = createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261012', starterCardIds: [], now });
  const plan = planAbyssAction(profile, { kind: 'start', expectedToken: abyssStateToken(profile) }, now);
  if ('rejected' in plan) throw new Error(plan.rejected);
  return applyEconomyTransaction(profile, plan.transaction).profile.abyss.run!;
}

describe('深渊准备盘面参数与投影', () => {
  it('收六张牌单张600ms，错峰70ms，总950ms', () => {
    expect(ABYSS_COLLECT_MS).toBe(600);
    expect(ABYSS_COLLECT_STAGGER_MS).toBe(70);
    expect(ABYSS_COLLECT_TOTAL_MS).toBe(950);
  });

  it('所有挑战阶段都留在盘面，空进度才不进入', () => {
    const run = draft();
    expect(isAbyssPreparation(null)).toBe(false);
    expect(isAbyssPreparation(undefined)).toBe(false);
    for (const kind of ['starterDraft', 'boonChoice', 'battleReady', 'inBattle', 'camp', 'bossDecision'] as const) {
      expect(isAbyssPreparation({ ...run, stage: { ...run.stage, kind } } as AbyssRun)).toBe(true);
    }
  });

  it('用正式己方牌堆世界坐标与Canvas矩形投影，不使用DPR或固定百分比', () => {
    const camera = new OrthographicCamera(-10, 10, 10, -10, .1, 100);
    camera.position.set(0, 15, 12);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    const rect = { left: 37, top: 51, width: 960, height: 540 };
    const point = new Vector3(...pilePosition('player', 'deck')).project(camera);
    expect(projectAbyssPile(camera, rect)).toEqual({
      x: rect.left + (point.x + 1) * rect.width / 2,
      y: rect.top + (1 - point.y) * rect.height / 2,
    });
    const before = projectAbyssPile(camera, rect);
    vi.stubGlobal('devicePixelRatio', 3);
    try {
      expect(projectAbyssPile(camera, rect)).toEqual(before);
      const resized = projectAbyssPile(camera, { ...rect, width: 480, height: 270 });
      expect(resized.x - rect.left).toBeCloseTo((before.x - rect.left) / 2);
      expect(resized.y - rect.top).toBeCloseTo((before.y - rect.top) / 2);
    } finally { vi.unstubAllGlobals(); }
  });

  it('营地无候选时仍留在盘面整备', () => {
    const run = draft();
    const stage = { ...run.stage, kind: 'camp', offer: { id: 'pending', options: [] } };
    expect(isAbyssPreparation({ ...run, stage } as unknown as AbyssRun)).toBe(true);
    expect(isAbyssPreparation({ ...run, stage: { ...stage, offer: null } } as unknown as AbyssRun)).toBe(true);
  });
});
