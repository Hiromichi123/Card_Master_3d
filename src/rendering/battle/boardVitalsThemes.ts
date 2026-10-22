import type { BoardVitalsLayout } from './AbyssVitals';
export type VitalsStyle = 'mecha' | 'volcano' | 'temple' | 'solar' | 'harvest' | 'icefield' | 'cloud';
export interface VitalsTheme {
  readonly style: VitalsStyle;
  readonly elevation?: number;
  readonly frame: string; readonly bed: string; readonly trim: string;
  readonly metalness: number; readonly roughness: number;
  readonly friendly: readonly [string, string]; readonly enemy: readonly [string, string];
  readonly layout: BoardVitalsLayout;
}
const layout: BoardVitalsLayout = { x: -5.55, z: 2.75, width: .32, channelWidth: .15, length: 4.25 };
export const BOARD_VITALS_THEMES: Readonly<Record<string, VitalsTheme>> = {
  'white-mecha': { style: 'mecha', frame: '#a7b3bd', bed: '#18242d', trim: '#54c9ff', metalness: .72, roughness: .4, friendly: ['#07525a', '#41efff'], enemy: ['#711c25', '#ff5368'], layout },
  volcano: { style: 'volcano', frame: '#383333', bed: '#1d1515', trim: '#e89c48', metalness: .08, roughness: .88, friendly: ['#6f3a06', '#ffdc58'], enemy: ['#8b1305', '#ff6830'], layout: { ...layout, x: -5.8 } },
  marble: { style: 'temple', frame: '#ddd9c9', bed: '#526574', trim: '#bc9a55', metalness: .08, roughness: .5, friendly: ['#15538b', '#68cfff'], enemy: ['#812b3e', '#f19c9c'], layout },
  obsidian: { style: 'solar', elevation: .72, frame: '#283247', bed: '#0b1425', trim: '#e9bf6e', metalness: .6, roughness: .45, friendly: ['#13476f', '#65d8ed'], enemy: ['#782342', '#fa6a91'], layout: { ...layout, x: -6.55 } },
  wasteland: { style: 'harvest', frame: '#806043', bed: '#342b20', trim: '#cbb870', metalness: 0, roughness: .8, friendly: ['#386122', '#d0df6d'], enemy: ['#762b19', '#ee9652'], layout },
  snow: { style: 'icefield', frame: '#90c3df', bed: '#35526c', trim: '#ddf6ff', metalness: .12, roughness: .36, friendly: ['#125e8c', '#84edff'], enemy: ['#6d3b75', '#ffa6d9'], layout },
  'cloud-top': { style: 'cloud', frame: '#eee9de', bed: '#7792a2', trim: '#d0ac60', metalness: .18, roughness: .55, friendly: ['#247b78', '#a8f1db'], enemy: ['#974754', '#ffc0a0'], layout },
};
/** Fixed pixel/world scale: more digits expand the label instead of shrinking its font. */
export function hpLabelDimensions(maxHp: number, measure: (text: string) => number) {
  const width = Math.ceil(measure(`${maxHp}/${maxHp}`)) + 24;
  const referenceWidth = Math.ceil(measure('20/20')) + 24;
  const worldPerPixel = .9 / referenceWidth;
  return { width, height: 160, worldWidth: width * worldPerPixel, worldHeight: 160 * worldPerPixel };
}
