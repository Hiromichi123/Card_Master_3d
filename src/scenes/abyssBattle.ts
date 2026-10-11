import { cardById } from '../data';
import type { BattleConfig } from '../domain/battle/types';
import type { CardDefinition } from '../domain/cards/types';
import type { AbyssEffect, AbyssEncounter, AbyssRun } from '../domain/progression/abyssTypes';
import { summonDefinitionIds } from '../domain/skills/tacticalTraits';
import type { DefinitionTable } from '../rendering/presentation/demoBattle';

/** 仅编译本战副本；不会把正负增益写回run的培养卡。 */
export function withAbyssBattleEffects(card: CardDefinition, effects: readonly AbyssEffect[], cardId = card.cardId): CardDefinition {
  const delta = effects.reduce((sum, effect) => ({
    atk: sum.atk + effect.modifier.atk,
    hp: sum.hp + effect.modifier.hp,
    cd: sum.cd + effect.modifier.cd,
  }), { atk: 0, hp: 0, cd: 0 });
  const additions = effects.flatMap(effect => effect.modifier.traits)
    .filter((skill, index, skills) => !card.skills.some(existing => existing.family === skill.family)
      && skills.findIndex(other => other.family === skill.family) === index);
  return {
    ...card, cardId,
    atk: Math.max(0, Math.min(999, card.atk + delta.atk)),
    hp: Math.max(1, Math.min(999, card.hp + delta.hp)),
    cd: Math.max(0, Math.min(999, card.cd + delta.cd)),
    rawTraits: [...card.rawTraits, ...additions.map(skill => skill.raw)],
    skills: [...card.skills, ...additions],
    description: `${card.description}${card.description ? '\n' : ''}本战效果：${effects.map(effect => effect.description).join('；') || '无'}`,
  };
}

export function compileAbyssBattle(run: AbyssRun, battle: AbyssEncounter, lookup: (id: string) => CardDefinition | undefined = id => cardById.get(id)): {
  readonly config: BattleConfig;
  readonly definitions: DefinitionTable;
} {
  const pair = battle.selectedBoon === null ? undefined : battle.boonChoices[battle.selectedBoon];
  if (!pair) throw new Error('本战尚未确认正负绑定特性');
  const definitions: Record<string, CardDefinition> = {};
  const summonDefinitions: Record<'player' | 'enemy', Record<string, string>> = { player: {}, enemy: {} };
  for (const side of ['player', 'enemy'] as const) {
    const cards = side === 'player' ? run.cards : battle.enemyCards;
    const effects = side === 'player' ? [pair.positive, pair.negative] : [battle.enemyEffect];
    const local = new Map(cards.map(card => [card.instanceId, card.definition]));
    for (const card of cards) {
      const growth = `本轮培养：ATK +${card.upgrades.atk}，HP +${card.upgrades.hp}，CD ${card.upgrades.cd}；新增特性：${card.addedTraits.map(skill => skill.raw).join('、') || '无'}。`;
      definitions[card.instanceId] = withAbyssBattleEffects({ ...card.definition,
        description: `${card.definition.description}${card.definition.description ? '\n' : ''}${side === 'player' ? growth : '敌方基础成长已计入卡牌数值。'}`,
      }, effects);
    }
    const dependencies = summonDefinitionIds(cards.map(card => card.instanceId), id => local.get(id) ?? lookup(id));
    for (const id of dependencies) {
      if (local.has(id)) continue;
      const template = lookup(id);
      if (!template) throw new Error(`召唤卡定义缺失：${id}`);
      const runtimeId = `${run.id}/summon/${side}/${id}`;
      summonDefinitions[side][id] = runtimeId;
      definitions[runtimeId] = withAbyssBattleEffects(template, effects, runtimeId);
    }
  }
  return {
    config: {
      seed: battle.seed,
      playerDeck: run.cards.map(card => card.instanceId),
      enemyDeck: battle.enemyCards.map(card => card.instanceId),
      label: `深渊 ${battle.floor}-${battle.encounter}`,
      summonDefinitions,
    }, definitions,
  };
}
