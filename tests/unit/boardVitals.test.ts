import { expect, it } from 'vitest';
import { TABLE_THEMES } from '../../src/rendering/table/themes';
import { BOARD_VITALS_THEMES, hpLabelDimensions } from '../../src/rendering/battle/boardVitalsThemes';

it('gives every published table a tabletop health display and distinguishes both sides', () => {
  for (const theme of TABLE_THEMES) {
    if (theme.id === 'tournament' || theme.id === 'abyss') continue; // Existing inset channels.
    const spec = BOARD_VITALS_THEMES[theme.id];
    expect(spec, theme.id).toBeDefined();
    expect(spec!.friendly).not.toEqual(spec!.enemy);
    expect(spec!.layout.channelWidth).toBeLessThan(spec!.layout.width);
    expect(spec!.layout.width).toBeLessThan(spec!.layout.length);
    expect(Math.abs(spec!.layout.x)).toBeGreaterThan(5);
  }
});
it('keeps the same glyph scale for five-digit boss HP and lets the text extend beyond the bar', () => {
  const measure = (text: string) => text.length * 70;
  const normal = hpLabelDimensions(20, measure), boss = hpLabelDimensions(35000, measure);
  expect(normal.worldWidth).toBe(.9);
  expect(boss.worldHeight).toBe(normal.worldHeight);
  expect(boss.worldWidth / boss.width).toBe(normal.worldWidth / normal.width);
  expect(boss.worldWidth).toBeGreaterThan(normal.worldWidth);
  expect(boss.width).toBeGreaterThan(measure('35000/35000'));
  expect(boss.worldWidth).toBeGreaterThan(BOARD_VITALS_THEMES['white-mecha']!.layout.width);
});
