import { readFileSync } from 'node:fs';
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

  it('准备态映射包含恢复入口，不把营地和Boss决定当作新选组', () => {
    const run = draft();
    expect(isAbyssPreparation(run)).toBe(true);
    expect(isAbyssPreparation(null)).toBe(false);
    expect(isAbyssPreparation(undefined)).toBe(false);
    // 此函数只按阶段标签分流，领域数据仍由存档校验器验证。
    for (const kind of ['boonChoice', 'battleReady', 'inBattle'] as const) {
      expect(isAbyssPreparation({ ...run, stage: { ...run.stage, kind } } as AbyssRun)).toBe(true);
    }
    for (const kind of ['camp', 'bossDecision'] as const) {
      expect(isAbyssPreparation({ ...run, stage: { ...run.stage, kind } } as AbyssRun)).toBe(false);
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

  it('准备场景不构造会话、不编译假战斗；网格固定三套横排及每套2×3', () => {
    const scene = readFileSync(new URL('../../src/scenes/AbyssPreparationScene.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../src/ui/abyssPreparation.css', import.meta.url), 'utf8');
    expect(scene).not.toMatch(/(?:new\s+BattleSession|session\.start\(|compileAbyssBattle|<BattleScene\b)/);
    expect(scene).toContain('<BattleBoard');
    expect(scene).toContain('<BattleCanvas');
    expect(css).toMatch(/\.abyss-draft__choices\s*\{[^}]*grid-template-columns:\s*repeat\(3,/);
    expect(css).toMatch(/\.abyss-draft__cards\s*\{[^}]*grid-template-columns:\s*repeat\(2,[^}]*grid-template-rows:\s*repeat\(3,/);
    expect(css).not.toMatch(/\.abyss-draft__choices\s*\{[^}]*grid-template-columns:\s*1fr/);
  });
});
