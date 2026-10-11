import { cardById, cardDatabase } from '../../data';
import { seedFrom } from '../battle/rng';
import { RARITY_TO_LEVEL, type CardDefinition } from '../cards/types';
import { SKILL_RULES } from '../skills/rules';
import { ABYSS_EFFECTS, ABYSS_GROWTH_TRAITS, ABYSS_RULES_VERSION, ABYSS_STAT_LIMIT, ABYSS_TRAIT_LIMIT, abyssDifficulty, abyssGrowthTargets, scaleAbyssEffect } from './abyssRules';
import type { AbyssCard, AbyssEffect, AbyssEncounter, AbyssGrowthOffer, AbyssGrowthOption, AbyssRun, AbyssState } from './abyssTypes';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const text = (value: unknown, max = 300): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const date = (value: unknown): value is string => text(value, 40) && Number.isFinite(Date.parse(value));
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const traitMatches = (value: unknown, expected: { readonly raw: string; readonly family: string | null; readonly param: number | null }) => record(value) && value.raw === expected.raw && value.family === expected.family && value.param === expected.param && value.resolution === 'implemented';

function validSkill(value: unknown): boolean {
  if (!record(value) || typeof value.raw !== 'string' || value.raw.length > 1000) return false;
  if (value.resolution === 'flavor') return value.family === null && value.param === null;
  if (value.resolution === 'scene-rule' && value.raw === '飞行') return value.family === null && value.param === null;
  return ['implemented', 'scene-rule'].includes(String(value.resolution)) && typeof value.family === 'string' && value.family in SKILL_RULES
    && (value.param === null || integer(value.param, 0, 9999));
}

function validDefinition(value: unknown): value is CardDefinition {
  if (!record(value) || !text(value.cardId) || !text(value.name, 1000) || typeof value.description !== 'string' || value.description.length > 10000
    || typeof value.rarity !== 'string' || !(value.rarity in RARITY_TO_LEVEL) || typeof value.level !== 'number' || !Number.isFinite(value.level)
    || value.status !== 'complete' || !integer(value.atk, 0, ABYSS_STAT_LIMIT) || !integer(value.hp, 1, ABYSS_STAT_LIMIT) || !integer(value.cd, 0, 99)
    || !record(value.art) || !text(value.art.artId) || typeof value.art.sourcePresent !== 'boolean'
    || !Array.isArray(value.rawTraits) || !Array.isArray(value.skills) || value.skills.length > 100 || value.rawTraits.length !== value.skills.length) return false;
  const skills: unknown[] = value.skills;
  return skills.every(validSkill) && value.rawTraits.every((raw, index) => {
    const skill = skills[index];
    return typeof raw === 'string' && record(skill) && raw === skill.raw;
  });
}

function validCard(value: unknown): value is AbyssCard {
  if (!record(value) || !text(value.instanceId) || !text(value.baseCardId) || !cardById.has(value.baseCardId)
    || !validDefinition(value.definition) || !validDefinition(value.baseDefinition) || !record(value.upgrades)
    || !Array.isArray(value.addedTraits) || value.addedTraits.length > ABYSS_TRAIT_LIMIT) return false;
  const def = value.definition;
  const base = value.baseDefinition;
  if (def.cardId !== value.instanceId || base.cardId !== value.baseCardId
    || def.name !== base.name || def.rarity !== base.rarity || def.art.artId !== base.art.artId || def.level !== base.level) return false;
  if (!integer(value.upgrades.atk, 0, ABYSS_STAT_LIMIT) || !integer(value.upgrades.hp, 0, ABYSS_STAT_LIMIT) || !integer(value.upgrades.cd, -99, 0)
    || !value.addedTraits.every(item => ABYSS_GROWTH_TRAITS.some(expected => traitMatches(item, expected)))) return false;
  const added = value.addedTraits as { family: string; raw: string; param: number | null }[];
  if (!unique(added.map(item => item.family)) || added.some(item => base.skills.some(skill => skill.family === item.family))) return false;
  if (def.atk !== base.atk + value.upgrades.atk || def.hp !== base.hp + value.upgrades.hp || def.cd !== base.cd + value.upgrades.cd
    || def.skills.length !== base.skills.length + added.length) return false;
  if (!base.skills.every((item, index) => item.raw === def.skills[index]?.raw && item.family === def.skills[index]?.family && item.param === def.skills[index]?.param)
    || !added.every((item, index) => traitMatches(def.skills[base.skills.length + index], item))) return false;
  return true;
}

function validCards(value: unknown, min = 1, max = 12): value is readonly AbyssCard[] {
  return Array.isArray(value) && value.length >= min && value.length <= max && value.every(validCard) && unique(value.map(card => card.instanceId));
}

function validEffect(value: unknown, positive: boolean, strength: number): value is AbyssEffect {
  if (!record(value) || !record(value.modifier)) return false;
  const base = ABYSS_EFFECTS.find(item => item.id === value.id && item.polarity === (positive ? 'positive' : 'negative'));
  if (!base || value.strength !== strength || !text(value.name) || !text(value.description, 2000) || value.polarity !== base.polarity) return false;
  const expected = scaleAbyssEffect(base, strength).modifier;
  return value.modifier.atk === expected.atk && value.modifier.hp === expected.hp && value.modifier.cd === expected.cd
    && Array.isArray(value.modifier.traits) && value.modifier.traits.length === expected.traits.length
    && value.modifier.traits.every((item, index) => traitMatches(item, expected.traits[index]!));
}

function validBattle(value: unknown, run: AbyssRun): value is AbyssEncounter {
  if (!record(value) || value.battleId !== `${run.id}/battle/${run.floor}/${run.encounter}` || value.seed !== seedFrom(`${run.seed}:battle:${run.floor}:${run.encounter}`)
    || value.floor !== run.floor || value.encounter !== run.encounter || value.difficulty !== abyssDifficulty(run.encounter)
    || !validCards(value.enemyCards) || !Array.isArray(value.boonChoices) || value.boonChoices.length !== 3
    || !(value.selectedBoon === null || integer(value.selectedBoon, 0, 2))) return false;
  const strength = Math.min(99, (value.difficulty === 'normal' ? 1 : value.difficulty === 'hard' ? 2 : 3) + Math.floor((run.floor - 1) / 3));
  if (!validEffect(value.enemyEffect, true, strength) || !['might', 'vitality', ...(value.difficulty === 'normal' ? [] : ['immunity'])].includes(value.enemyEffect.id)) return false;
  const pairs = value.boonChoices;
  if (!pairs.every(pair => record(pair) && validEffect(pair.positive, true, 1) && validEffect(pair.negative, false, 1)
    && pair.id === `${pair.positive.id}:${pair.negative.id}`)) return false;
  if (!unique(pairs.map(pair => String(pair.id)))) return false;
  return value.enemyCards.every(card => card.instanceId.startsWith(`${run.id}/enemy/${run.floor}/${run.encounter}/`));
}

function validOffer(value: unknown, run: AbyssRun, serial: number): value is AbyssGrowthOffer {
  if (!record(value) || value.id !== `${run.id}/offer/${run.floor}/${run.encounter}/${serial}` || !['free', 'training', 'recruit'].includes(String(value.source))
    || !Array.isArray(value.options) || value.options.length !== (value.source === 'recruit' ? 1 : 3)) return false;
  const keys: string[] = [];
  for (const option of value.options) {
    if (!record(option) || !text(option.label)) return false;
    if (['atk', 'hp', 'cd', 'remove'].includes(String(option.kind))) keys.push(String(option.kind));
    else if (option.kind === 'trait' && ABYSS_GROWTH_TRAITS.some(item => traitMatches(option.trait, item))) keys.push(`trait:${String((option.trait as { family: string }).family)}`);
    else if (option.kind === 'recruit' && validCard(option.card)) {
      const recruit = option.card;
      if (!recruit.instanceId.startsWith(`${run.id}/recruit/${run.floor}/${run.encounter}/${serial}/`) || run.cards.some(card => card.instanceId === recruit.instanceId)) return false;
      keys.push(recruit.instanceId);
    } else return false;
    if (option.kind !== 'recruit' && abyssGrowthTargets(run.cards, option as unknown as AbyssGrowthOption).length === 0) return false;
  }
  return unique(keys) && (value.source !== 'recruit' || (value.options[0] as { kind: string }).kind === 'recruit');
}

function validRun(value: unknown, contentVersion: string): value is AbyssRun {
  if (!record(value) || !text(value.id) || !integer(value.revision, 1) || !integer(value.seed, 0, 0xffffffff)
    || value.rulesVersion !== ABYSS_RULES_VERSION || value.contentVersion !== contentVersion || !date(value.startedAt)
    || !integer(value.floor, 1, 10000) || !integer(value.encounter, 1, 10) || !integer(value.lives, 1, 3)
    || !integer(value.coins) || !integer(value.earnedCoins) || value.coins > value.earnedCoins
    || !integer(value.wins) || !integer(value.losses, 0, 2) || value.lives !== 3 - value.losses
    || !record(value.stage) || !validCards(value.cards, value.stage.kind === 'starterDraft' ? 0 : 1)) return false;
  const run = value as unknown as AbyssRun;
  const completedBefore = (run.floor - 1) * 10 + run.encounter - 1;
  const stage = value.stage;
  if (stage.kind === 'starterDraft') {
    if (run.floor !== 1 || run.encounter !== 1 || run.cards.length !== 0 || run.wins !== 0 || run.losses !== 0 || run.coins !== 0 || run.earnedCoins !== 0 || run.lastSettledBattleId !== null
      || !Array.isArray(stage.choices) || stage.choices.length !== 3) return false;
    const instanceIds: string[] = [];
    for (const [index, choice] of stage.choices.entries()) {
      if (!record(choice) || choice.id !== `${run.id}/starter/${index}` || !text(choice.name) || !validCards(choice.cards, 6, 6)) return false;
      const rarities = choice.cards.map(card => card.definition.rarity);
      if (rarities.filter(rarity => rarity === 'D').length !== 1 || rarities.filter(rarity => rarity === 'C').length !== 3 || rarities.filter(rarity => rarity === 'C+').length !== 2) return false;
      if (!choice.cards.every(card => card.instanceId.startsWith(`${choice.id}/`))) return false;
      instanceIds.push(...choice.cards.map(card => card.instanceId));
    }
    return unique(instanceIds);
  }
  if (!['boonChoice', 'battleReady', 'inBattle', 'camp', 'bossDecision'].includes(String(stage.kind)) || !validBattle(stage.battle, run)
    || !run.cards.every(card => card.instanceId.startsWith(`${run.id}/starter/`) || card.instanceId.startsWith(`${run.id}/recruit/`))) return false;
  const after = stage.kind === 'camp' || stage.kind === 'bossDecision';
  if (run.wins + run.losses !== completedBefore + Number(after)) return false;
  const previousFloor = after || run.encounter > 1 ? run.floor : run.floor - 1;
  const previousEncounter = after ? run.encounter : run.encounter > 1 ? run.encounter - 1 : 10;
  if (run.lastSettledBattleId !== (run.wins + run.losses === 0 ? null : `${run.id}/battle/${previousFloor}/${previousEncounter}`)) return false;
  if ((stage.kind === 'boonChoice') !== (stage.battle.selectedBoon === null)) return false;
  if (stage.kind === 'bossDecision') return run.encounter === 10 && stage.battle.difficulty === 'nightmare';
  if (stage.kind === 'camp') {
    if (!['win', 'loss', 'draw'].includes(String(stage.result)) || !integer(stage.freeRemaining, 0, 3) || !integer(stage.offerSerial)
      || (stage.result !== 'win' && (stage.freeRemaining !== 0 || run.encounter === 10))) return false;
    if (stage.offer === null) return stage.freeRemaining === 0;
    if (!validOffer(stage.offer, run, stage.offerSerial)) return false;
    return (stage.freeRemaining > 0) === (stage.offer.source === 'free');
  }
  return true;
}

/** 自动加载和导入共用：新版本坏进度拒绝，绝不补造新候选或奖励账本。 */
export function validateAbyssState(value: unknown, contentVersion = cardDatabase.contentVersion): value is AbyssState {
  if (!record(value) || !integer(value.revision) || !Array.isArray(value.history) || value.history.length > 10
    || !Array.isArray(value.knownEffectIds) || value.knownEffectIds.length > ABYSS_EFFECTS.length + ABYSS_GROWTH_TRAITS.length) return false;
  const known = new Set([...ABYSS_EFFECTS.map(item => item.id), ...ABYSS_GROWTH_TRAITS.map(item => `trait:${item.family}`)]);
  if (!value.knownEffectIds.every(id => typeof id === 'string' && known.has(id)) || !unique(value.knownEffectIds as string[])) return false;
  if (value.run !== null && !validRun(value.run, contentVersion)) return false;
  for (const entry of value.history) {
    if (!record(entry) || !text(entry.runId) || !date(entry.startedAt) || !date(entry.endedAt) || Date.parse(entry.endedAt) < Date.parse(entry.startedAt)
      || !['settled', 'defeated', 'abandoned'].includes(String(entry.reason)) || !integer(entry.floor, 1, 10000) || !integer(entry.encounter, 1, 10)
      || !integer(entry.wins) || !integer(entry.losses, 0, 3) || !integer(entry.coins) || !integer(entry.earnedCoins) || entry.coins > entry.earnedCoins
      || !validCards(entry.cards, entry.reason === 'abandoned' ? 0 : 1) || !entry.cards.every(card => card.instanceId.startsWith(`${entry.runId}/`))) return false;
    if (entry.reason === 'settled' && entry.encounter !== 10) return false;
  }
  const ids = value.history.map(entry => String(entry.runId));
  return unique(ids) && (value.run === null || !ids.includes((value.run as AbyssRun).id));
}
