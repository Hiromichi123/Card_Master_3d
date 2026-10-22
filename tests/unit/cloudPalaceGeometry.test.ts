import { expect, it } from 'vitest';
import { palaceRoof, buildCloudPalace } from '../../src/rendering/battle/cloudPalaceGeometry';
import { BOARD_VITALS_THEMES } from '../../src/rendering/battle/boardVitalsThemes';
import { getTableTheme } from '../../src/rendering/table/themes';
it('builds a closed curved roof with raised corner eaves', () => {
  const roof = palaceRoof(4, 3, .75), position = roof.getAttribute('position');
  expect(roof.index!.count).toBeGreaterThan(1000);
  expect(roof.boundingBox!.min.x).toBe(-2); expect(roof.boundingBox!.max.x).toBe(2);
  expect(position.getY(0)).toBeGreaterThan(position.getY(6));
  for (let i = 0; i < position.count; i++) expect(Number.isFinite(position.getY(i))).toBe(true);
  roof.dispose();
});
it('shares complete palace and multi-level tower prototypes without excessive geometry', () => {
  const hall = buildCloudPalace(false), tower = buildCloudPalace(true);
  expect(tower.roof.boundingBox!.max.y).toBeGreaterThan(hall.roof.boundingBox!.max.y);
  for (const prototype of [hall, tower]) for (const geometry of Object.values(prototype)) {
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(geometry.getAttribute('position').count).toBeLessThan(30000);
    expect(geometry.boundingBox!.min.y).toBeGreaterThanOrEqual(-.001);
    geometry.dispose();
  }
});
it('preserves the saved cloud theme ID and keeps solar life bars outside the board and above its rim', () => {
  expect(getTableTheme('cloud-top').name).toBe('云顶天宫');
  const solar = BOARD_VITALS_THEMES.obsidian!;
  expect(solar.layout.x + (solar.layout.width + .19) / 2).toBeLessThan(-5.8);
  expect(solar.elevation).toBeGreaterThan(.4);
  expect(getTableTheme('marble').environmentIntensity).toBeLessThan(.4);
});
