import { describe, expect, it } from 'vitest';
import { buildChoreography, createPose, samplePose, sampleCamera, createCameraPose, UI_EXIT, landingBeamEnvelope } from '../../src/rendering/gacha/choreography';

function build(count: number) {
  return buildChoreography({ cards: Array.from({ length: count }, (_, i) => ({ cardId: String(i), rarity: i === 0 ? 'SSS' : 'D' })),
    rankOf: (rarity) => rarity === 'SSS' ? 6 : 0, isHighRarity: (rarity) => rarity === 'SSS', aspect: 16 / 9 });
}
describe('continuous gacha entrance', () => {
  it.each([1, 10])('lands all %s backs before the camera pushes in and sequential reveals begin', (count) => {
    const choreo = build(count); const pose = createPose();
    expect(choreo.shots).toHaveLength(count);
    for (const shot of choreo.shots) {
      expect(shot.delay).toBeGreaterThan(UI_EXIT);
      expect(shot.flipAt).toBeGreaterThanOrEqual(choreo.revealStart);
      samplePose(choreo, shot.index, choreo.allLandedAt, pose);
      expect(pose.visible).toBe(true);
      expect(pose.flip).toBe(1);
      expect(pose.position[1]).toBeCloseTo(shot.slot[1]);
      expect(landingBeamEnvelope(shot, shot.delay)).toBeGreaterThan(0);
      expect(landingBeamEnvelope(shot, choreo.revealStart)).toBe(0);
    }
    for (let i = 1; i < count; i++) expect(choreo.shots[i]!.flipAt)
      .toBeGreaterThan(choreo.shots[i - 1]!.flipAt + choreo.shots[i - 1]!.flipDuration);
  });

  it('captures the current view, holds it during UI exit, pulls back along it, then pushes in', () => {
    const initial = { position: [0.2, 0.1, 3.5] as [number, number, number], target: [0.1, 0, 0] as [number, number, number] };
    const choreo = buildChoreography({ cards: [{ cardId: 'x', rarity: 'D' }], rankOf: () => 0,
      isHighRarity: () => false, aspect: 16 / 9, initialCamera: initial });
    const pose = createCameraPose();
    sampleCamera(choreo, UI_EXIT / 2, pose);
    expect(pose).toEqual(initial);
    sampleCamera(choreo, choreo.landingStart, pose);
    expect(pose.position[2]).toBeGreaterThan(initial.position[2]);
    expect((pose.position[0] - initial.target[0]) / (pose.position[2] - initial.target[2]))
      .toBeCloseTo((initial.position[0] - initial.target[0]) / initial.position[2]);
    const distant = pose.position[2];
    sampleCamera(choreo, choreo.revealStart, pose);
    expect(pose.position[2]).toBeLessThan(distant);
  });

  it('beam intervals are finite and skipping gives the same settled revealed cards', () => {
    const choreo = build(10); const pose = createPose();
    for (const shot of choreo.shots) {
      expect(landingBeamEnvelope(shot, 0)).toBe(0);
      expect(landingBeamEnvelope(shot, choreo.total)).toBe(0);
      samplePose(choreo, shot.index, choreo.total, pose);
      expect(pose.flip).toBe(0);
      expect(pose.position[2]).toBeCloseTo(0);
    }
  });
});
