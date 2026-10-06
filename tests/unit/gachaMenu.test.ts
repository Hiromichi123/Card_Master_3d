import { describe, expect, it } from 'vitest';
import legacyLayouts from '../fixtures/legacy-gacha-menu.json';
import { dashboardSelection, menuFit, showcaseRects } from '../../src/rendering/gacha/menuLayout';

describe('original gacha menu layout', () => {
  // Golden coordinates were generated from the original Python method, without pygame.
  it.each(legacyLayouts)('matches the original positions and draw order for $count cards', ({ count, rects }) => {
    expect(showcaseRects(count)).toEqual(rects);
  });

  it('fits both wide and tall windows using the same scale on both axes', () => {
    expect(menuFit(1440, 900)).toBe(0.5);
    expect(menuFit(1920, 1080)).toBe(0.6);
    expect(menuFit(900, 1440)).toBe(0.3125);
    for (const [width, height] of [[1440, 900], [1920, 1080], [900, 1440]]) {
      const scale = menuFit(width!, height!);
      expect(2880 * scale).toBeLessThanOrEqual(width!);
      expect(1800 * scale).toBeLessThanOrEqual(height!);
      expect((300 * scale) / (450 * scale)).toBeCloseTo(2 / 3);
    }
  });

  it('snaps the vertical list and stops at its original finite ends', () => {
    expect(dashboardSelection(-140, 8)).toBe(0);
    expect(dashboardSelection(0, 8)).toBe(0);
    expect(dashboardSelection(140 * 3 + 65, 8)).toBe(3);
    expect(dashboardSelection(140 * 3 + 75, 8)).toBe(4);
    expect(dashboardSelection(140 * 10, 8)).toBe(7);
  });
});
