import { describe, expect, it } from 'vitest';
import { framedBackdropSize, revealEdgeHighlight, backdropTextureRepeat } from '../../src/rendering/gacha/revealStyle';
import { backgroundUrl } from '../../src/data/assets';
import { gachaPools } from '../../src/data';

describe('reveal rim and framed backdrop', () => {
  it('starts white and settles monotonically to the rarity color without a second flash', () => {
    expect(revealEdgeHighlight(-1)).toBe(0);
    expect(revealEdgeHighlight(0)).toBe(1);
    let previous = 1;
    for (let age = 0; age <= 3; age += 0.01) {
      const brightness = revealEdgeHighlight(age);
      expect(brightness).toBeLessThanOrEqual(previous + 1e-9);
      expect(brightness).toBeGreaterThanOrEqual(0);
      previous = brightness;
    }
    expect(revealEdgeHighlight(2.4)).toBeCloseTo(0);
  });

  it('sizes the board to the screen and crops artwork without stretching', () => {
    for (const imageAspect of [1, 1.6, 16 / 9, 2.4]) {
      const [width, height] = framedBackdropSize(16, 9, imageAspect);
      const rim = Math.min(0.14, 9 * 1.45 * 0.035);
      expect((width + rim * 2.24) / (height + rim * 2.24)).toBeCloseTo(16 / 9);
      const [x, y] = backdropTextureRepeat(width / height, imageAspect);
      expect(imageAspect * x / y).toBeCloseTo(width / height);
      expect(x).toBeLessThanOrEqual(1); expect(y).toBeLessThanOrEqual(1);
    }
  });

  it('every configured card pool resolves an actual illustration', () => {
    for (const pool of gachaPools.pools) expect(backgroundUrl(pool.bgType)).toMatch(/^\/assets\/bg\/gacha_.*\.webp$/);
  });
});
