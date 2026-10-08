import { slashTiming } from './slashTiming';

/** Pure timing shared by geometry, skill recipes and presentation beats. */
export function attackStatusTiming(template: string): { travel: number; impact: number; fade: number; hit: number } {
  const travel=template==='burnMark'?.12:template==='poisonLance'?.88:
    ['frostShatter','burnBurst','poisonBurst','grievousPulse'].includes(template)?.12:.42;
  const impact=template==='frostRetaliation'?.60:template==='poisonLance'?.46:.32;
  const fade=template==='poisonLance'?.85:.65;
  return {travel,impact,fade,hit:travel};
}


export function statusAppliedHit(kind: string): number {
  const template = ({ frost: 'frostRetaliation', burn: 'burnMark', poison: 'poisonLance', bleed: 'bleedMark', grievous: 'grievousMark' } as Record<string, string>)[kind];
  return attackStatusTiming(template ?? '').hit;
}

export function statusTriggeredHit(kind: string): number {
  return kind === 'bleed' ? slashTiming('slash').hit : .12;
}
