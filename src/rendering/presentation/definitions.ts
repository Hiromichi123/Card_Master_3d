import { cardById } from '../../data';
import { COOLDOWN_CARD, isCooldownCard } from '../../domain/battle/turnActions';
import type { CardDefinition } from '../../domain/cards/types';
import type { DefinitionTable } from './demoBattle';

/** 本局模板优先；未传模板表的旧展示入口仍可使用主卡库。 */
export function resolveBattleDefinition(
  definitionId: string,
  definitions?: DefinitionTable,
): CardDefinition | undefined {
  if (isCooldownCard(definitionId)) return COOLDOWN_CARD;
  return definitions?.[definitionId] ?? cardById.get(definitionId);
}
