import type { AbyssCard, AbyssGrowthOption, AbyssRun } from '../domain/progression/abyssTypes';
import { abyssGrowthTargets } from '../domain/progression/abyssRules';

export type ChoicePoint = readonly [number, number, number];
export const CHOICE_PARTY_SCALE = 1.2;
export function starterChoicePositions(group: number): readonly ChoicePoint[] {
  const columns = group === 0 ? 3 : 2;
  const centerX = group === 0 ? 0 : group === 1 ? -3.45 : 3.45;
  return Array.from({ length: 6 }, (_, index): ChoicePoint => [
    centerX + (index % columns - (columns - 1) / 2) * (group === 0 ? 1.9 : 1.72), .2,
    (group === 0 ? -3.65 : 1.3) + Math.floor(index / columns) * 2,
  ]);
}
export function starterChoiceButton(group: number): ChoicePoint {
  return [group === 0 ? 0 : group === 1 ? -3.45 : 3.45, .25, group === 0 ? -.35 : 6.65];
}
export function choiceOptionPosition(index: number, count: number, contract = false): ChoicePoint {
  return [(index - (count - 1) / 2) * 3.3, .22, contract ? -2 : .15];
}
export function choicePartyLayout(cards: readonly AbyssCard[]) {
  return cards.map((card, index) => {
    const row = Math.floor(index / 6), rowCount = Math.min(6, cards.length - row * 6);
    return { id: card.instanceId, position: [(index % 6 - (rowCount - 1) / 2) * 1.55, .24, 4.45 + row * 2.35] as ChoicePoint };
  });
}
export function choiceNeedsTarget(option: AbyssGrowthOption, count: number): boolean {
  return option.kind !== 'crystal' && (option.kind !== 'recruit' || count >= 12);
}
export function choiceTargetIds(run: AbyssRun, option: AbyssGrowthOption): readonly string[] {
  return abyssGrowthTargets(run.cards, option, run.crystals ?? 0).map(card => card.instanceId);
}
export function choicePartyHit(point: ChoicePoint, layout: ReturnType<typeof choicePartyLayout>): string | null {
  return layout.find(item => Math.abs(point[0] - item.position[0]) <= CHOICE_PARTY_SCALE * .56
    && Math.abs(point[2] - item.position[2]) <= CHOICE_PARTY_SCALE * .83)?.id ?? null;
}
/** Current authoritative offer, never a displayed label or a stale drag, determines overwrite cost. */
export function choiceOverwrite(run: AbyssRun, option: AbyssGrowthOption, targetId?: string): boolean {
  return option.kind === 'trait' && !!run.cards.find(card => card.instanceId === targetId)?.addedTraits.length;
}
