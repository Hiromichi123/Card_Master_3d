import { describe, expect, it, vi } from 'vitest';
import { Color, Vector3 } from 'three';
import { attackAdvance, attackDistance, hpFlashBrightness, hpLossValues, hpStepSeconds } from '../../src/rendering/anim/combatMotion';
import { Timeline } from '../../src/rendering/anim/Timeline';
import { ParticlePool } from '../../src/rendering/effects/ParticlePool';
import { SkillVisualPool } from '../../src/rendering/effects/SkillVisualPool';
import { buildSkillTimeline } from '../../src/rendering/effects/skillRecipes';
import { buildBeats, type DirectorDeps } from '../../src/rendering/presentation/director';
import { displayFromState } from '../../src/rendering/presentation/displayState';
import { demoDefinitions, DEMO_CONFIG } from '../../src/rendering/presentation/demoBattle';
import { createBattle } from '../../src/domain/battle/engine';
import type { Resolution } from '../../src/domain/battle/types';

describe('card attack and HP feedback', () => {
  it('accelerates forward, returns to origin and preserves a gap', () => {
    expect(attackAdvance(0)).toBe(0);
    expect(attackAdvance(1)).toBe(0);
    expect(attackAdvance(0.4)).toBeCloseTo(1);
    expect(attackAdvance(0.3) - attackAdvance(0.2)).toBeGreaterThan(attackAdvance(0.2) - attackAdvance(0.1));
    for (const span of [0, 2, 2.8, 3.6, 8]) {
      expect(attackDistance(span, 2.25)).toBeLessThanOrEqual(0.5);
      if (span >= 2.25) expect(span - 2.25 - attackDistance(span, 2.25)).toBeGreaterThanOrEqual(0);
    }
  });

  it('counts down through every integer with one brightness pulse', () => {
    expect(hpLossValues(3, 1)).toEqual([2, 1]);
    expect(hpLossValues(3, 0)).toEqual([2, 1, 0]);
    expect(hpLossValues(1, 3)).toEqual([]);
    expect(hpStepSeconds(2)).toBe(0.045);
    expect(hpStepSeconds(100) * 100).toBeLessThanOrEqual(0.35);
    expect(hpFlashBrightness(0)).toBe(1);
    expect(hpFlashBrightness(0.5)).toBeCloseTo(2.8);
    expect(hpFlashBrightness(1)).toBe(1);
  });

  it.each(['normal', 'skip'] as const)('publishes card and player HP as 3 → 2 → 1 in %s playback', (mode) => {
    const finalState = createBattle(DEMO_CONFIG, demoDefinitions());
    const display = displayFromState(finalState);
    display.instances.test = { definitionId: 'A_011', stateGroupId: 'test' };
    display.groups.test = { hp: 3, maxHp: 3, atk: 1 };
    display.playerHp.enemy = 3;
    const values: number[][] = [];
    const deps: DirectorDeps = {
      display, publish: () => values.push([display.groups.test!.hp, display.playerHp.enemy]),
      play: vi.fn(), skipEffects: vi.fn(), log: vi.fn(), onFinished: vi.fn(),
      worldPointOf: () => [0, 0, 0], slotPointOf: () => [0, 0, 0], pilePointOf: () => [0, 0, 0],
      playerAnchor: () => [0, 0, 0], nameOf: (id) => id, speed: () => 'normal',
    };
    const resolution: Resolution = { finalState, accepted: true,
      events: [
        { type: 'DamageApplied', seq: 1, turn: 1, side: 'player', instanceId: 'test', amount: 2, hpBefore: 3, hpAfter: 1, source: 'normalAttack' },
        { type: 'PlayerHpChanged', seq: 2, turn: 1, side: 'enemy', hpBefore: 3, hpAfter: 1, amount: 2, source: 'emptySlot' },
      ],
      patches: [
        { kind: 'setHp', atEventSeq: 1, side: 'player', instanceId: 'test', value: 1 },
        { kind: 'setHp', atEventSeq: 2, side: 'enemy', instanceId: '@player', value: 1 },
      ],
    };
    const timeline = new Timeline();
    for (const beat of buildBeats(resolution, deps)) timeline.add({ duration: beat.duration,
      ...(beat.onStart ? { onStart: beat.onStart } : {}), ...(beat.onComplete ? { onComplete: beat.onComplete } : {}) });
    if (mode === 'skip') timeline.skipToEnd();
    else for (let i = 0; i < 180 && !timeline.isFinished; i++) timeline.update(1 / 60);
    const changes = (column: number): number[] => values.map((v) => v[column]!).filter((v, i, all) => i === 0 || v !== all[i - 1]);
    expect(changes(0)).toEqual([3, 2, 1]);
    expect(changes(1)).toEqual([3, 2, 1]);
    expect(deps.play).not.toHaveBeenCalled();
    expect(deps.onFinished).toHaveBeenCalledOnce();
  });

  it('normal attacks allocate no VFX; the white flying circle is reclaimed once', () => {
    const visuals = new SkillVisualPool(4);
    const pool = new ParticlePool(50);
    const emit = vi.spyOn(pool, 'emit');
    const onHit = vi.fn();
    const context = { pool, visuals, from: new Vector3(), to: new Vector3(), extraTargets: [],
      color: new Color('white'), intensity: 1, countScale: 1, durationScale: 1, onHit };
    const attack = buildSkillTimeline('normalAttack', context);
    expect(visuals.activeCount).toBe(0);
    attack.update(0.12);
    expect(onHit).toHaveBeenCalledOnce();
    attack.skipToEnd();
    expect(onHit).toHaveBeenCalledOnce();
    expect(emit).not.toHaveBeenCalled();
    const circle = buildSkillTimeline('flyingDeploy', context);
    expect(visuals.activeCount).toBe(1);
    circle.update(0.1);
    const actor = visuals.group.children[0]!;
    expect(actor.children[2]!.visible).toBe(false);
    circle.skipToEnd(); circle.skipToEnd();
    expect(visuals.activeCount).toBe(0);
    expect(onHit).toHaveBeenCalledTimes(2);
    expect(emit).not.toHaveBeenCalled();
    visuals.dispose();
  });
});
