import type { CardDefinition } from './types';

/** One-use cards share this identity across deployment rules and numeric badges. */
export function isSelfDestructCard(card: CardDefinition): boolean {
  return card.rawTraits.includes('自毁') || card.skills.some((skill) =>
    skill.family === 'selfDestruct' && (skill.resolution === 'implemented' || skill.resolution === 'alias'));
}
