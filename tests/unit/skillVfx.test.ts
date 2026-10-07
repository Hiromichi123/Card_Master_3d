import { describe, expect, it, vi } from 'vitest';
import { Color, Vector3, type Object3D } from 'three';
import { ParticlePool } from '../../src/rendering/effects/ParticlePool';
import { SkillVisualPool } from '../../src/rendering/effects/SkillVisualPool';
import { buildSkillTimeline } from '../../src/rendering/effects/skillRecipes';
import { effectRequestFor, targetsOf, type EffectContext } from '../../src/rendering/presentation/eventEffects';
import type { BattleEvent } from '../../src/domain/battle/types';

describe('bounded skill geometry lifecycle', () => {
  it('reclaims geometry actors on completion and skip while firing one group callback', () => {
    const visuals = new SkillVisualPool(4);
    const onHit = vi.fn();
    const context = { pool: new ParticlePool(100), visuals, from: new Vector3(0, 0.55, 2),
      to: new Vector3(0, 0.08, -2), extraTargets: [new Vector3(1, 0.08, -2), new Vector3(-1, 0.08, -2)],
      color: new Color('white'), intensity: 2, countScale: 1, durationScale: 1, onHit };
    const timeline = buildSkillTimeline('groupIceSeal', context);
    expect(visuals.activeCount).toBe(3);
    timeline.update(0.2);
    timeline.skipToEnd();
    expect(onHit).toHaveBeenCalledTimes(1);
    expect(visuals.activeCount).toBe(0);
    // The pool permanently holds two subsystem groups — the linear-ability visuals and the
    // three.quarks batched renderer — so actors have to be gone from inside them.
    expect(visuals.group.children).toHaveLength(2);
    const [linear, quarks] = visuals.group.children;
    expect(linear!.name).toContain('LinearAbilityCasting');
    expect(quarks!.name).toBe('three.quarks:card-artillery');
    expect(linear!.children).toHaveLength(0);
    const leftoverActors: string[] = [];
    quarks!.traverse((node) => { if (node.name.startsWith('quarks-')) leftoverActors.push(node.name); });
    expect(leftoverActors).toEqual([]);
    timeline.skipToEnd();
    expect(onHit).toHaveBeenCalledTimes(1);
    visuals.dispose();
  });

  it('caps rapid requests, isolates concurrent endpoints and supports equal origin/target', () => {
    const visuals = new SkillVisualPool(2);
    // 'heal' belongs to neither subsystem, so its actor stays a direct child of the pool group
    // and its grounded ring keeps the endpoint of its own cast.
    const a = visuals.create({ template: 'heal', from: new Vector3(0, 1, 3), to: new Vector3(-2, 0, -3), intensity: 1 });
    const b = visuals.create({ template: 'heal', from: new Vector3(0, 1, 3), to: new Vector3(2, 0, -3), intensity: 1 });
    a.update('travel', 1); b.update('travel', 1);
    const actors = visuals.group.children.filter((child) => child.name === 'skill-heal');
    const placedAt = (actor: Object3D, x: number): boolean =>
      actor.children.some((child) => Math.abs(child.position.x - x) < 1e-6);
    expect(actors).toHaveLength(2);
    expect(placedAt(actors[0]!, -2)).toBe(true);
    expect(placedAt(actors[1]!, 2)).toBe(true);
    const c = visuals.create({ template: 'lightning', from: new Vector3(), to: new Vector3(), intensity: 1 });
    expect(visuals.activeCount).toBe(2);
    a.update('impact', 0.5); // Evicted handles remain safe, including their later timeline updates.
    c.update('travel', 0.5);
    visuals.clear();
    expect(visuals.activeCount).toBe(0);
    expect(visuals.geometryCount).toBe(6);
    visuals.dispose();
  });

  it('normal and fast visual playback reach the same callback and release every actor', () => {
    for (const scale of [1, 0.45]) {
      const visuals = new SkillVisualPool(4);
      const onHit = vi.fn();
      const timeline = buildSkillTimeline('heal', { pool: new ParticlePool(50), visuals,
        from: new Vector3(), to: new Vector3(), extraTargets: [], color: new Color('white'),
        intensity: 1, countScale: 0, durationScale: scale, onHit });
      for (let i = 0; i < 180 && !timeline.isFinished; i += 1) timeline.update(1 / 60);
      expect(timeline.isFinished).toBe(true);
      expect(onHit).toHaveBeenCalledTimes(1);
      expect(visuals.activeCount).toBe(0);
      visuals.dispose();
    }
  });
});

describe('presentation recipients', () => {
  const events: BattleEvent[] = [
    { type: 'SkillTriggered', seq: 1, turn: 1, side: 'player', instanceId: 'caster', trigger: 'beforeAttack', family: 'groupHeal', raw: '群体治愈2', param: 2 },
    { type: 'Healed', seq: 2, turn: 1, side: 'player', instanceId: 'caster', amount: 2, hpBefore: 2, hpAfter: 4 },
    { type: 'Healed', seq: 3, turn: 1, side: 'player', instanceId: 'ally', amount: 2, hpBefore: 1, hpAfter: 3 },
  ];
  const context: EffectContext = {
    events, index: 0,
    worldPointOf: (id) => id === 'caster' ? [1, 0, 2] : [-1, 0, 2],
    slotPointOf: () => [0, 0, 0], playerAnchor: () => [0, 1, 6],
  };
  it('keeps the caster in group healing and sends all actual target positions', () => {
    expect(targetsOf(context).map((target) => target.instanceId)).toEqual(['caster', 'ally']);
    const request = effectRequestFor(events[0]!, context);
    expect(request?.template).toBe('groupHeal');
    expect(request?.to).toEqual([1, 0.08, 2]);
    expect(request?.extraTargets).toEqual([[-1, 0.08, 2]]);
  });
  it('places a no-target self effect on the actual card, rather than its cast offset', () => {
    const request = effectRequestFor(events[0]!, { ...context, events: [events[0]!] });
    expect(request?.to).toEqual([1, 0.08, 2]);
  });
});
