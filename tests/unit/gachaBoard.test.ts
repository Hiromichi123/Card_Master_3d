import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildChoreography, createCameraPose, createPose, sampleCamera, samplePose, backdropSize } from '../../src/rendering/gacha/choreography';
import { GACHA_BOARD_Z, framedBackdropSize, menuBoardCameraDistance, sceneBoardDistance } from '../../src/rendering/gacha/revealStyle';
import { damp } from '../../src/rendering/anim/motion';
import { SPEED_SCALE } from '../../src/state/settingsStore';
import { GachaProbabilityStrip } from '../../src/ui/GachaProbabilityStrip';

function build(count: number, rareIndex: number, aspect: number) {
  return buildChoreography({ cards: Array.from({ length: count }, (_, i) => ({ cardId: String(i), rarity: i === rareIndex ? 'SSS' : 'D' })),
    rankOf: (rarity) => rarity === 'SSS' ? 6 : 0, isHighRarity: (rarity) => rarity === 'SSS', aspect, initialCamera: { position: [0, 0, menuBoardCameraDistance(aspect)], target: [0, 0, 0] } });
}

describe('cards resting on the gacha board', () => {
  it('keeps every rotating card in front of the image and settles close to its surface', () => {
    for (const count of [1, 10]) {
      const choreo = build(count, 0, 16 / 9);
      const pose = createPose();
      for (let i = 0; i < count; i++) {
        for (let step = 0; step <= 200; step++) {
          samplePose(choreo, i, step * choreo.total / 200, pose);
          if (!pose.visible) continue;
          const angle = pose.rotationY + Math.PI * pose.flip;
          const nearestEdge = pose.position[2] - Math.abs(Math.sin(angle)) * pose.scale * 0.5
            - Math.abs(Math.cos(angle)) * pose.scale * 0.012;
          expect(nearestEdge).toBeGreaterThan(GACHA_BOARD_Z + 0.02);
          expect(pose.position[2]).toBeLessThanOrEqual(Math.max(0.18, choreo.cardScale * 0.55) + 0.01);
        }
        samplePose(choreo, i, choreo.total, pose);
        expect(pose.position[2] - GACHA_BOARD_Z).toBeCloseTo(0.08);
      }
    }
  });
});

describe('board coverage during rare-card camera focus', () => {
  it.each([0.75, 1.6, 16 / 9, 2.4])('covers every reveal-view corner at aspect %s, including damped focus and return', (aspect) => {
    for (const rareIndex of [0, 4, 5, 9]) for (const speed of ['normal', 'fast'] as const) {
      const choreo = build(10, rareIndex, aspect);
      const [viewWidth, viewHeight] = backdropSize(sceneBoardDistance(aspect) - GACHA_BOARD_Z, 42, aspect);
      const [width, height] = framedBackdropSize(viewWidth, viewHeight, 1.6);
      const desired = createCameraPose(); const current = createCameraPose();
      sampleCamera(choreo, 0, current);
      const camera = new PerspectiveCamera(42, aspect, 0.1, 80);
      const direction = new Vector3(); const hit = new Vector3();
      const frames = Math.ceil(choreo.total * SPEED_SCALE[speed] * 60) + 120;
      for (let frame = 0; frame < frames; frame++) {
        sampleCamera(choreo, Math.min(choreo.total, frame / 60 / SPEED_SCALE[speed]), desired);
        for (let axis = 0; axis < 3; axis++) {
          const intro = frame / 60 / SPEED_SCALE[speed] <= choreo.revealStart;
          current.position[axis] = intro ? desired.position[axis]! : damp(current.position[axis]!, desired.position[axis]!, 6, 1 / 60);
          current.target[axis] = intro ? desired.target[axis]! : damp(current.target[axis]!, desired.target[axis]!, 3.5, 1 / 60);
        }
        if (frame % 3 !== 0 || frame / 60 / SPEED_SCALE[speed] < choreo.revealStart) continue;
        camera.position.set(...current.position); camera.lookAt(...current.target); camera.updateMatrixWorld();
        for (const x of [-1, 1]) for (const y of [-1, 1]) {
          direction.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
          expect(direction.z).toBeLessThan(0);
          hit.copy(camera.position).addScaledVector(direction, (GACHA_BOARD_Z - camera.position.z) / direction.z);
          expect(Math.abs(hit.x) + 0.05).toBeLessThan(width / 2);
          expect(Math.abs(hit.y) + 0.05).toBeLessThan(height / 2);
        }
      }
    }
  });
});

it('renders every rarity percentage in the shared compact row without a disclosure control', () => {
  const markup = renderToStaticMarkup(createElement(GachaProbabilityStrip, {
    rows: [{ rarity: 'SSS', percent: 1 }, { rarity: 'A', percent: 5.3 }, { rarity: 'D', percent: 93.7 }], rare: 6.3,
  }));
  expect(markup).toContain('SSS(');
  expect(markup).toContain('93.7%');
  expect(markup).toContain('6.3%');
  expect(markup).not.toContain('<details');
});

it('the selection view crops 20% inward and leaves room for mouse parallax without showing the frame', () => {
  for (const aspect of [0.75, 1.6, 16 / 9, 2.4]) {
    const [w, h] = backdropSize(sceneBoardDistance(aspect) - GACHA_BOARD_Z, 42, aspect);
    const [width, height] = framedBackdropSize(w, h, 1.6);
    const rim = Math.min(0.14, h * 1.45 * 0.035);
    const front = GACHA_BOARD_Z + rim * 0.72;
    const [visibleWidth, visibleHeight] = backdropSize(menuBoardCameraDistance(aspect) - front, 42, aspect);
    expect(visibleWidth).toBeLessThanOrEqual(width - rim * 0.24 + 1e-8);
    expect(visibleHeight).toBeLessThanOrEqual(height - rim * 0.24 + 1e-8);
    expect(visibleHeight).toBeCloseTo(Math.min((width - rim * 0.24) / aspect, height - rim * 0.24) * 0.8);
    expect(visibleWidth * 1.16).toBeLessThan(width - rim * 0.24);
    expect(visibleHeight * 1.16).toBeLessThan(height - rim * 0.24);
  }
});
