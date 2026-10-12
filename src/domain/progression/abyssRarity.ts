import { RARITY_TO_LEVEL, STANDARD_RARITIES, type CardRarity } from '../cards/types';
import type { SkillSpec } from '../skills/types';
import { abyssTraitGrade } from './abyssGrades';
import type { AbyssCard, AbyssState } from './abyssTypes';

export function abyssTraitRarityReduction(skill: SkillSpec): number {
  if (abyssTraitGrade(skill) === 'red') return 2;
  return skill.family?.startsWith('group') || skill.family === 'explodeOnDeath' ? 1.5 : 1;
}
export function abyssStatRarityReduction(card: Pick<AbyssCard, 'upgrades'>): number {
  return card.upgrades.atk + (card.upgrades.hp - card.upgrades.cd) * .5;
}
export function abyssRarityReduction(card: Pick<AbyssCard, 'upgrades' | 'addedTraits'>): number {
  return abyssStatRarityReduction(card) + card.addedTraits.reduce((sum, skill) => sum + abyssTraitRarityReduction(skill), 0);
}
/** The JSON table has no D+ / 5.5. Nearest match; ties prefer the higher rarity. */
export function abyssRarityAtLevel(level: number): CardRarity {
  const wanted = Math.max(0, level);
  return STANDARD_RARITIES.reduce((best, rarity) => {
    const distance = Math.abs(RARITY_TO_LEVEL[rarity] - wanted);
    const previous = Math.abs(RARITY_TO_LEVEL[best] - wanted);
    return distance < previous || distance === previous && RARITY_TO_LEVEL[rarity] < RARITY_TO_LEVEL[best] ? rarity : best;
  }, 'SSS');
}

/** Ordinary cultivated player cards only; contracts and enemy floor growth do not count. */
export function withAbyssRarity(card: AbyssCard): AbyssCard {
  const base = card.baseDefinition;
  if (base.rarity.startsWith('#') || card.instanceId.includes('/enemy/')) return card;
  const reduction = Math.max(card.rarityReduction ?? 0, abyssRarityReduction(card));
  const rarity = abyssRarityAtLevel(RARITY_TO_LEVEL[base.rarity] - reduction);
  const promoted = rarity !== base.rarity;
  const level = promoted ? RARITY_TO_LEVEL[rarity] : base.level;
  const marker = promoted ? { sourceRarity: base.rarity, sourceLevel: base.level } : undefined;
  if (card.rarityReduction === reduction && card.definition.rarity === rarity && card.definition.level === level
    && (promoted ? card.definition.art.abyssTitle?.sourceRarity === base.rarity && card.definition.art.abyssTitle?.sourceLevel === base.level : !card.definition.art.abyssTitle)) return card;
  const { abyssTitle: _previous, ...art } = card.definition.art;
  return { ...card, rarityReduction: reduction,
    definition: { ...card.definition, rarity, level, art: marker ? { ...art, abyssTitle: marker } : art } };
}

/** View/load/action adapter for old saved runs; does not reroll or touch base definitions. */
export function withAbyssRarities(state: AbyssState): AbyssState {
  const cards = state.run?.cards.map(withAbyssRarity);
  const runChanged = cards?.some((card, index) => card !== state.run!.cards[index]) ?? false;
  let historyChanged = false;
  const history = state.history.map(entry => {
    const updated = entry.cards.map(withAbyssRarity);
    if (!updated.some((card, index) => card !== entry.cards[index])) return entry;
    historyChanged = true;
    return { ...entry, cards: updated };
  });
  return !runChanged && !historyChanged ? state : { ...state,
    run: runChanged && state.run && cards ? { ...state.run, cards } : state.run, history };
}
