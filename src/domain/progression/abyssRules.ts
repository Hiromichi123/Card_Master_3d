import { createRng, seedFrom } from '../battle/rng';
import type { Rng } from '../battle/rng';
import { RARITY_TO_LEVEL, type CardDefinition, type CardRarity } from '../cards/types';
import { SKILL_RULES } from '../skills/rules';
import type { SkillSpec } from '../skills/types';
import type { AbyssBoonPair, AbyssCard, AbyssDifficulty, AbyssEffect, AbyssEncounter, AbyssGrowthOffer, AbyssGrowthOption, AbyssRun, AbyssStarterChoice } from './abyssTypes';

export const ABYSS_RULES_VERSION = 1 as const;
export const ABYSS_DECK_LIMIT = 12;
export const ABYSS_STAT_LIMIT = 999;
export const ABYSS_TRAIT_LIMIT = 4;
export const ABYSS_TRAINING_PRICE = 25;
export const ABYSS_RECRUIT_PRICE = 30;
export const ABYSS_WIN_COINS = { normal: 30, hard: 50, nightmare: 100 } as const;
export const ABYSS_DIFFICULTY_NAMES = { normal: '常规', hard: '高难', nightmare: '噩梦 Boss' } as const;

const trait = (raw: string, family: string, param: number | null = 1): SkillSpec => ({ raw, family, param, resolution: 'implemented', matchKind: 'full' });
export const ABYSS_GROWTH_TRAITS: readonly SkillSpec[] = [
  trait('火球1', 'fireball'), trait('防御1', 'defense'), trait('恢复1', 'selfHeal'),
  trait('吸血1', 'vampire'), trait('反击1', 'counter'), trait('加速1', 'haste'), trait('对空', 'antiAir', null),
];
const immunity = trait('免疫', 'immunity', null);
const effect = (id: string, name: string, description: string, polarity: 'positive' | 'negative', atk = 0, hp = 0, cd = 0, traits: readonly SkillSpec[] = []): AbyssEffect => ({
  id, name, description, polarity, strength: 1, modifier: { atk, hp, cd, traits },
});
export const ABYSS_EFFECTS: readonly AbyssEffect[] = [
  effect('might', '战意', '本战己方全部单位 ATK +1。', 'positive', 1),
  effect('vitality', '坚韧', '本战己方全部单位 HP +1。', 'positive', 0, 1),
  effect('swiftness', '迅捷', '本战己方全部单位 CD −1，最低0。', 'positive', 0, 0, -1),
  effect('immunity', '虚无庇护', '本战己方全部单位获得技能伤害免疫；不挡普攻、真伤和自损，受对位沉默压制。', 'positive', 0, 0, 0, [immunity]),
  effect('frailty', '脆弱', '本战己方全部单位 HP −1，最低1。', 'negative', 0, -1),
  effect('weakness', '衰弱', '本战己方全部单位 ATK −1，最低0。', 'negative', -1),
  effect('delay', '迟滞', '本战己方全部单位 CD +1。', 'negative', 0, 0, 1),
];

export function abyssDifficulty(encounter: number): AbyssDifficulty {
  return encounter === 10 ? 'nightmare' : encounter % 3 === 0 ? 'hard' : 'normal';
}

export function isAbyssTemplate(card: CardDefinition): boolean {
  return card.status === 'complete' && Number.isSafeInteger(card.atk) && card.atk >= 0 && card.atk <= ABYSS_STAT_LIMIT
    && Number.isSafeInteger(card.hp) && card.hp > 0 && card.hp <= ABYSS_STAT_LIMIT
    && Number.isSafeInteger(card.cd) && card.cd >= 0 && card.cd <= 99
    && card.skills.every(skill => (skill.resolution === 'flavor' && skill.family === null && skill.param === null)
      || (skill.resolution === 'scene-rule' && skill.raw === '飞行' && skill.family === null)
      || (skill.resolution === 'implemented' && skill.family !== null && skill.family in SKILL_RULES));
}

export function makeAbyssCard(card: CardDefinition, instanceId: string, atk = 0, hp = 0): AbyssCard {
  return {
    instanceId, baseCardId: card.cardId,
    baseDefinition: { ...card, rawTraits: [...card.rawTraits], skills: card.skills.map(skill => ({ ...skill })), art: { ...card.art } },
    definition: { ...card, cardId: instanceId, atk: Math.min(ABYSS_STAT_LIMIT, card.atk + atk), hp: Math.min(ABYSS_STAT_LIMIT, card.hp + hp), rawTraits: [...card.rawTraits], skills: card.skills.map(skill => ({ ...skill })), art: { ...card.art } },
    upgrades: { atk: Math.min(ABYSS_STAT_LIMIT, card.atk + atk) - card.atk, hp: Math.min(ABYSS_STAT_LIMIT, card.hp + hp) - card.hp, cd: 0 }, addedTraits: [],
  };
}

function chooseTemplate(pool: readonly CardDefinition[], rarities: readonly CardRarity[], rng: Rng, used: Set<string>, bias = 0): CardDefinition {
  let candidates = pool.filter(card => rarities.includes(card.rarity));
  if (!candidates.length) throw new Error(`深渊卡池缺少完整且技能有效的 ${rarities.join('/')} 卡牌。`);
  const distinct = candidates.filter(card => !used.has(card.cardId));
  if (distinct.length) candidates = distinct;
  if (bias) {
    candidates = candidates.slice().sort((a, b) => bias > 0 ? b.atk - a.atk : b.hp - a.hp);
    candidates = candidates.slice(0, Math.max(1, Math.ceil(candidates.length * 0.7)));
  }
  const card = rng.pick(candidates);
  used.add(card.cardId);
  return card;
}

export function abyssStarterChoices(runId: string, seed: number, definitions: readonly CardDefinition[]): readonly AbyssStarterChoice[] {
  const pool = definitions.filter(isAbyssTemplate);
  const seen = new Set<string>();
  return ['均衡之始', '进攻之始', '生存之始'].map((name, group) => {
    const rng = createRng(seedFrom(`${seed}:starter:${group}`));
    let cards: AbyssCard[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const used = new Set<string>();
      cards = (['D', 'C', 'C', 'C', 'C+', 'C+'] as const).map((rarity, index) => makeAbyssCard(
        chooseTemplate(pool, [rarity], rng, used, group === 1 ? 1 : group === 2 ? -1 : 0), `${runId}/starter/${group}/${index}`,
      ));
      const signature = cards.map(card => card.baseCardId).sort().join('|');
      if (!seen.has(signature)) { seen.add(signature); break; }
    }
    return { id: `${runId}/starter/${group}`, name, cards };
  });
}

export function scaleAbyssEffect(base: AbyssEffect, strength: number): AbyssEffect {
  const modifier = base.modifier;
  const scaled = { atk: modifier.atk * strength, hp: modifier.hp * strength, cd: modifier.cd * strength, traits: modifier.traits };
  const text = scaled.traits.length ? base.description : `本战己方全部单位${scaled.atk ? ` ATK ${scaled.atk > 0 ? '+' : ''}${scaled.atk}` : ''}${scaled.hp ? ` HP ${scaled.hp > 0 ? '+' : ''}${scaled.hp}` : ''}${scaled.cd ? ` CD ${scaled.cd > 0 ? '+' : ''}${scaled.cd}` : ''}（ATK/CD最低0，HP最低1）。`;
  return { ...base, strength, description: text, modifier: scaled };
}

function boonPairs(run: AbyssRun): readonly AbyssBoonPair[] {
  const rng = createRng(seedFrom(`${run.seed}:boons:${run.floor}:${run.encounter}`));
  const positives = ABYSS_EFFECTS.filter(item => item.polarity === 'positive' && (item.id !== 'swiftness' || run.cards.some(card => card.definition.cd > 0)));
  const negatives = ABYSS_EFFECTS.filter(item => item.polarity === 'negative'
    && (item.id !== 'weakness' || run.cards.some(card => card.definition.atk > 0))
    && (item.id !== 'frailty' || run.cards.some(card => card.definition.hp > 1)));
  const candidates: AbyssBoonPair[] = [];
  for (const positive of positives) for (const negative of negatives) {
    if ((positive.id === 'might' && negative.id === 'weakness') || (positive.id === 'vitality' && negative.id === 'frailty') || (positive.id === 'swiftness' && negative.id === 'delay')) continue;
    candidates.push({ id: `${positive.id}:${negative.id}`, positive, negative });
  }
  return rng.shuffle(candidates).slice(0, 3);
}

export function makeAbyssEncounter(run: AbyssRun, definitions: readonly CardDefinition[]): AbyssEncounter {
  const difficulty = abyssDifficulty(run.encounter);
  const seed = seedFrom(`${run.seed}:battle:${run.floor}:${run.encounter}`);
  const rng = createRng(seedFrom(`${seed}:enemy`));
  const pool = definitions.filter(isAbyssTemplate);
  const low = difficulty === 'normal' ? 4.5 : difficulty === 'hard' ? 4 : 3;
  const high = difficulty === 'normal' ? 6 : difficulty === 'hard' ? 5 : 4.5;
  const shift = Math.min(3, Math.floor((run.floor - 1) / 2) * 0.5);
  const rarities = Object.entries(RARITY_TO_LEVEL).filter(([rarity, level]) => !rarity.startsWith('#') && level >= Math.max(0, low - shift) && level <= Math.max(0.5, high - shift)).map(([rarity]) => rarity as CardRarity);
  const count = Math.min(12, (difficulty === 'normal' ? 6 : difficulty === 'hard' ? 7 : 8) + Math.floor((run.floor - 1) / 2));
  const used = new Set<string>();
  const enemyCards = Array.from({ length: count }, (_, index) => makeAbyssCard(chooseTemplate(pool, rarities, rng, used), `${run.id}/enemy/${run.floor}/${run.encounter}/${index}`, Math.min(998, run.floor - 1), Math.min(998, (run.floor - 1) * 2)));
  const strength = Math.min(99, (difficulty === 'normal' ? 1 : difficulty === 'hard' ? 2 : 3) + Math.floor((run.floor - 1) / 3));
  const enemyPool = ABYSS_EFFECTS.filter(item => ['might', 'vitality', ...(difficulty === 'normal' ? [] : ['immunity'])].includes(item.id));
  return {
    battleId: `${run.id}/battle/${run.floor}/${run.encounter}`, seed, floor: run.floor, encounter: run.encounter, difficulty,
    enemyCards, enemyEffect: scaleAbyssEffect(rng.pick(enemyPool), strength), boonChoices: boonPairs(run), selectedBoon: null,
  };
}

export function abyssGrowthTargets(cards: readonly AbyssCard[], option: AbyssGrowthOption): readonly AbyssCard[] {
  switch (option.kind) {
    case 'atk': return cards.filter(card => card.definition.atk < ABYSS_STAT_LIMIT);
    case 'hp': return cards.filter(card => card.definition.hp < ABYSS_STAT_LIMIT);
    case 'cd': return cards.filter(card => card.definition.cd > 0);
    case 'remove': return cards.length > 1 ? cards : [];
    case 'trait': return cards.filter(card => card.addedTraits.length < ABYSS_TRAIT_LIMIT && !card.definition.skills.some(skill => skill.family === option.trait.family));
    case 'recruit': return cards.length >= ABYSS_DECK_LIMIT ? cards : [];
  }
}

function recruitCard(run: AbyssRun, serial: number, index: number, definitions: readonly CardDefinition[]): AbyssCard {
  const rng = createRng(seedFrom(`${run.seed}:recruit:${run.floor}:${run.encounter}:${serial}:${index}`));
  const pool = definitions.filter(isAbyssTemplate);
  const rare = Math.min(4, Math.floor((run.floor - 1) / 2));
  const table: readonly (readonly [CardRarity, number])[] = [ ['D', Math.max(0, 10 - rare * 5)], ['C', Math.max(5, 40 - rare * 10)], ['C+', 30], ['B', 15 + rare * 5], ['B+', 5 + rare * 5], ['A', rare * 5], ['A+', rare * 2] ];
  const available = table.filter(([rarity, weight]) => weight > 0 && pool.some(card => card.rarity === rarity));
  if (!available.length) throw new Error('深渊招募卡池没有合法卡牌。');
  let roll = rng.next() * available.reduce((sum, entry) => sum + entry[1], 0);
  let rarity = available[available.length - 1]![0];
  for (const item of available) { roll -= item[1]; if (roll < 0) { rarity = item[0]; break; } }
  return makeAbyssCard(chooseTemplate(pool, [rarity], rng, new Set()), `${run.id}/recruit/${run.floor}/${run.encounter}/${serial}/${index}`);
}

export function makeAbyssGrowthOffer(run: AbyssRun, source: AbyssGrowthOffer['source'], serial: number, definitions: readonly CardDefinition[]): AbyssGrowthOffer {
  const id = `${run.id}/offer/${run.floor}/${run.encounter}/${serial}`;
  if (source === 'recruit') return { id, source, options: [{ kind: 'recruit', label: '招募新卡', card: recruitCard(run, serial, 0, definitions) }] };
  const rng = createRng(seedFrom(`${run.seed}:growth:${run.floor}:${run.encounter}:${serial}`));
  const upgrades: AbyssGrowthOption[] = [ { kind: 'atk', label: '攻击 +1' }, { kind: 'hp', label: '生命 +2' }, { kind: 'cd', label: '冷却 −1' }, { kind: 'remove', label: '删除一张卡' }, ...ABYSS_GROWTH_TRAITS.map(item => ({ kind: 'trait' as const, label: `赋予 ${item.raw}`, trait: item })) ];
  const choices = upgrades.filter(option => abyssGrowthTargets(run.cards, option).length > 0);
  choices.push({ kind: 'recruit', label: '招募新卡', card: recruitCard(run, serial, 0, definitions) });
  const options = rng.shuffle(choices).slice(0, 3);
  while (options.length < 3) options.push({ kind: 'recruit', label: '招募新卡', card: recruitCard(run, serial, options.length, definitions) });
  return { id, source, options };
}
