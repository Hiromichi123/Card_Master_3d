import { createRng, seedFrom } from '../battle/rng';
import type { Rng } from '../battle/rng';
import { RARITY_TO_LEVEL, STANDARD_RARITIES, type CardDefinition, type CardRarity } from '../cards/types';
import { SKILL_RULES } from '../skills/rules';
import type { SkillSpec } from '../skills/types';
import { describeTraitFunction } from '../skills/traitDescriptions';
import { ABYSS_GRADE_INFO, abyssEffectGrade, abyssGrowthGrade, type AbyssGrade } from './abyssGrades';
import type { AbyssBoonPair, AbyssCard, AbyssDifficulty, AbyssEffect, AbyssEncounter, AbyssGrowthOffer, AbyssGrowthOption, AbyssRun, AbyssStarterChoice } from './abyssTypes';

export const ABYSS_RULES_VERSION = 1 as const;
export const ABYSS_DECK_LIMIT = 12;
export const ABYSS_MAX_FLOOR = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
export const ABYSS_STAT_LIMIT = 999;
/** Legacy save ceiling; new cultivation has one slot without discarding older cards. */
export const ABYSS_TRAIT_LIMIT = 4;
export const ABYSS_CULTIVATED_TRAIT_LIMIT = 1;
export const ABYSS_ERASE_TRAIT_PRICE = 15;
export const ABYSS_TRAINING_PRICE = 5;
export const ABYSS_RECRUIT_PRICE = 5;
export const ABYSS_WIN_COINS = { normal: 15, hard: 30, nightmare: 60 } as const;
export const ABYSS_REWARD_DRAWS = { normal: 1, hard: 2, nightmare: 3 } as const;
export function abyssPurchasePrice(run: AbyssRun, purchase: 'recruit' | 'trait' | 'training'): number {
  const count = purchase === 'recruit' ? run.recruitPurchases ?? 0 : run.traitPurchases ?? 0;
  return Math.min(purchase === 'recruit' ? 50 : 30, 5 * (Math.min(10, count) + 1));
}
export function abyssBaseHp(battle: Pick<AbyssEncounter, 'floor' | 'encounter'>): { player: number; enemy: number } {
  const completed = (battle.floor - 1) * 10 + battle.encounter - 1;
  return { player: 20 + completed * 2, enemy: 20 + completed * 4 };
}
export const ABYSS_DIFFICULTY_NAMES = { normal: '常规', hard: '高难', nightmare: '噩梦 Boss' } as const;

const trait = (raw: string, family: string, param: number | null = 1): SkillSpec => ({ raw, family, param, resolution: 'implemented', matchKind: 'full' });
/** Curated implemented families only; legacy level-one entries are retained. */
const levels = (name: string, family: string, values: readonly number[] = [1, 2, 3]): SkillSpec[] => values.map(n => trait(`${name}${n}`, family, n));
export const ABYSS_GROWTH_TRAITS: readonly SkillSpec[] = [
  ...levels('火球', 'fireball'), ...levels('冰封', 'iceSeal'), ...levels('闪电', 'lightning'),
  ...levels('斩击', 'slash'), ...levels('毒雾', 'poisonCloud'),
  ...levels('防御', 'defense'), ...levels('闪避', 'dodge'), ...levels('恢复', 'selfHeal'),
  ...levels('吸血', 'vampire'), ...levels('反击', 'counter'), ...levels('加速', 'haste'),
  ...levels('燃烧', 'burning', [1, 2]), ...levels('剧毒', 'venom', [1, 2]),
  trait('对空', 'antiAir', null), trait('隐匿', 'concealment', null), trait('先攻', 'firstStrike', null),
  ...levels('群体火球', 'groupFireball', [1, 2]), ...levels('群体治疗', 'groupHeal', [1, 2]),
  ...levels('群体延迟', 'groupDelay', [1, 2]),
  trait('法术反弹', 'spellReflect', null), trait('不屈', 'unyielding', null),
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
  ...[2, 3].flatMap(n => [
    effect(`might-${n}`, `战意 +${n}`, `本战己方全部单位 ATK +${n}。`, 'positive', n),
    effect(`vitality-${n}`, `坚韧 +${n}`, `本战己方全部单位 HP +${n}。`, 'positive', 0, n),
    effect(`swiftness-${n}`, `迅捷 ${n}`, `本战己方全部单位 CD −${n}，最低0。`, 'positive', 0, 0, -n),
    effect(`frailty-${n}`, `脆弱 ${n}`, `本战己方全部单位 HP −${n}，最低1。`, 'negative', 0, -n),
    effect(`weakness-${n}`, `衰弱 ${n}`, `本战己方全部单位 ATK −${n}，最低0。`, 'negative', -n),
    effect(`delay-${n}`, `迟滞 ${n}`, `本战己方全部单位 CD +${n}。`, 'negative', 0, 0, n),
  ]),
  ...ABYSS_GROWTH_TRAITS.map(skill => effect(`ability-${skill.family}-${skill.param ?? 0}`, skill.raw,
    `本战己方全部单位获得${skill.raw}：${describeTraitFunction(skill)}`, 'positive', 0, 0, 0, [skill])),
];

/** Old identifiers remain valid. New discoveries are recorded at their actual tier. */
export function abyssEffectDiscoveryIds(value: AbyssEffect): string[] {
  const same = ABYSS_EFFECTS.filter(item => item.polarity === value.polarity
    && item.modifier.atk === value.modifier.atk && item.modifier.hp === value.modifier.hp && item.modifier.cd === value.modifier.cd
    && item.modifier.traits.length === value.modifier.traits.length
    && item.modifier.traits.every((skill, index) => skill.family === value.modifier.traits[index]?.family && skill.param === value.modifier.traits[index]?.param));
  return [...new Set([value.id, ...same.map(item => item.id)])];
}

function weightedChoices<T>(items: readonly T[], count: number, rng: Rng, gradeOf: (item: T) => AbyssGrade, keyOf: (item: T) => string): T[] {
  let pool = [...items];
  const choices: T[] = [];
  while (pool.length && choices.length < count) {
    let roll = rng.next() * pool.reduce((sum, item) => sum + ABYSS_GRADE_INFO[gradeOf(item)].weight, 0);
    let chosen: T = pool[pool.length - 1]!;
    for (const item of pool) { roll -= ABYSS_GRADE_INFO[gradeOf(item)].weight; if (roll < 0) { chosen = item; break; } }
    choices.push(chosen);
    const key = keyOf(chosen);
    pool = pool.filter(item => keyOf(item) !== key);
  }
  return choices;
}
function growthKey(option: AbyssGrowthOption): string { return option.kind === 'trait' ? `trait:${option.trait.family}` : option.kind; }
function effectKey(value: AbyssEffect): string { return value.modifier.traits.length ? `trait:${value.modifier.traits[0]!.family}` : value.id.replace(/-\d+$/, ''); }
function canBenefit(run: AbyssRun, value: AbyssEffect): boolean {
  const m = value.modifier;
  return run.cards.some(card => (m.atk > 0 && card.definition.atk < ABYSS_STAT_LIMIT) || (m.hp > 0 && card.definition.hp < ABYSS_STAT_LIMIT)
    || (m.cd < 0 && card.definition.cd > 0) || m.traits.some(skill => {
      const same = card.definition.skills.filter(existing => existing.family === skill.family);
      return !same.length || skill.param !== null && same.every(existing => (existing.param ?? 1) < skill.param!);
    }));
}

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
  const traits = modifier.traits.map(skill => {
    if (skill.param === null || strength === 1) return skill;
    const param = Math.min(9999, skill.param * strength);
    return { ...skill, param, raw: skill.raw.replace(/\d+$/, String(param)) };
  });
  const scaled = { atk: modifier.atk * strength, hp: modifier.hp * strength, cd: modifier.cd * strength, traits };
  const text = scaled.traits.length ? `本战己方全部单位获得${scaled.traits.map(skill => `${skill.raw}：${describeTraitFunction(skill)}`).join('；')}` : `本战己方全部单位${scaled.atk ? ` ATK ${scaled.atk > 0 ? '+' : ''}${scaled.atk}` : ''}${scaled.hp ? ` HP ${scaled.hp > 0 ? '+' : ''}${scaled.hp}` : ''}${scaled.cd ? ` CD ${scaled.cd > 0 ? '+' : ''}${scaled.cd}` : ''}（ATK/CD最低0，HP最低1）。`;
  return { ...base, strength, description: text, modifier: scaled };
}

function boonPairs(run: AbyssRun): readonly AbyssBoonPair[] {
  const rng = createRng(seedFrom(`${run.seed}:boons:${run.floor}:${run.encounter}`));
  const positives = ABYSS_EFFECTS.filter(item => item.polarity === 'positive' && canBenefit(run, item));
  const negatives = ABYSS_EFFECTS.filter(item => item.polarity === 'negative'
    && (!item.id.startsWith('weakness') || run.cards.some(card => card.definition.atk > 0))
    && (!item.id.startsWith('frailty') || run.cards.some(card => card.definition.hp > 1)));
  const candidates: AbyssBoonPair[] = [];
  for (const positive of positives) for (const negative of negatives) {
    if (!positive.modifier.traits.length && positive.modifier.atk + negative.modifier.atk === 0 && positive.modifier.hp + negative.modifier.hp === 0 && positive.modifier.cd + negative.modifier.cd === 0) continue;
    candidates.push({ id: `${positive.id}:${negative.id}`, positive, negative });
  }
  return weightedChoices(candidates, 3, rng, pair => abyssEffectGrade(pair.positive), pair => effectKey(pair.positive));
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

export function abyssGrowthTargets(cards: readonly AbyssCard[], option: AbyssGrowthOption, crystals = 0): readonly AbyssCard[] {
  switch (option.kind) {
    case 'atk': return cards.filter(card => card.definition.atk < ABYSS_STAT_LIMIT);
    case 'hp': return cards.filter(card => card.definition.hp < ABYSS_STAT_LIMIT);
    case 'cd': return cards.filter(card => card.definition.cd > 0);
    case 'remove': return cards.length > 1 ? cards : [];
    case 'trait': return cards.filter(card => !card.baseDefinition.skills.some(skill => skill.family === option.trait.family)
      && (card.addedTraits.length === 0 || crystals > 0)
      && !(card.addedTraits.length === 1 && card.addedTraits[0]!.raw === option.trait.raw));
    case 'crystal': return [];
    case 'recruit': return cards.length >= ABYSS_DECK_LIMIT ? cards : [];
  }
}

/** Expected level of each paid candidate, interpolated between the four chapter milestones. */
export function abyssRecruitLevel(run: Pick<AbyssRun, 'floor' | 'encounter'>): number {
  const step = Math.max(0, (run.floor - 1) * 10 + run.encounter - 1);
  if (step <= 9) return 5 - step * 2 / 9;
  if (step <= 19) return 3 - (step - 9) * 1.5 / 10;
  return Math.max(0, 1.5 - (step - 19) * 1.5 / 10);
}

/** Smooth rarity distribution; its expectation matches the table level, not a card stat. */
export function abyssRecruitDistribution(run: Pick<AbyssRun, 'floor' | 'encounter'>, definitions: readonly CardDefinition[]) {
  const pool = definitions.filter(isAbyssTemplate);
  const available = STANDARD_RARITIES.filter(rarity => pool.some(card => card.rarity === rarity))
    .map(rarity => ({ rarity, level: RARITY_TO_LEVEL[rarity] }));
  if (!available.length) throw new Error('深渊招募卡池没有合法普通卡牌。');
  const minimum = Math.min(...available.map(item => item.level)), maximum = Math.max(...available.map(item => item.level));
  const target = Math.max(minimum, Math.min(maximum, abyssRecruitLevel(run)));
  if (target === minimum || target === maximum) return available.filter(item => item.level === target).map(item => ({ ...item, weight: 1 }));
  const weights = (tilt: number) => {
    const logs = available.map(item => { const d = item.level - target; return -d * d / (2 * .65 * .65) + tilt * d; });
    const peak = Math.max(...logs), raw = logs.map(log => Math.exp(log - peak));
    const total = raw.reduce((sum, value) => sum + value, 0);
    return raw.map(value => value / total);
  };
  let low = -64, high = 64;
  for (let i = 0; i < 64; i++) {
    const middle = (low + high) / 2, values = weights(middle);
    const mean = available.reduce((sum, item, index) => sum + item.level * values[index]!, 0);
    if (mean < target) low = middle; else high = middle;
  }
  const probabilities = weights((low + high) / 2);
  return available.map((item, index) => ({ ...item, weight: probabilities[index]! }));
}

function recruitCard(run: AbyssRun, serial: number, index: number, definitions: readonly CardDefinition[], used = new Set<string>()): AbyssCard {
  const rng = createRng(seedFrom(`${run.seed}:recruit:${run.floor}:${run.encounter}:${serial}:${index}`));
  const pool = definitions.filter(isAbyssTemplate), table = abyssRecruitDistribution(run, definitions);
  let roll = rng.next(), rarity = table[table.length - 1]!.rarity;
  for (const item of table) { roll -= item.weight; if (roll < 0) { rarity = item.rarity; break; } }
  return makeAbyssCard(chooseTemplate(pool, [rarity], rng, used), `${run.id}/recruit/${run.floor}/${run.encounter}/${serial}/${index}`);
}

export function makeAbyssGrowthOffer(run: AbyssRun, source: AbyssGrowthOffer['source'], serial: number, definitions: readonly CardDefinition[]): AbyssGrowthOffer {
  const id = `${run.id}/offer/${run.floor}/${run.encounter}/${serial}`;
  if (source === 'recruit') {
    const used = new Set<string>();
    return { id, source, options: Array.from({ length: 3 }, (_, index) => ({ kind: 'recruit' as const, label: '选择新卡', card: recruitCard(run, serial, index, definitions, used) })) };
  }
  const rng = createRng(seedFrom(`${run.seed}:growth:${run.floor}:${run.encounter}:${serial}`));
  const upgrades: AbyssGrowthOption[] = [
    ...[1, 2, 3].flatMap((amount): AbyssGrowthOption[] => [
      { kind: 'atk', amount, label: `攻击 +${amount}` }, { kind: 'hp', amount, label: `生命 +${amount}` }, { kind: 'cd', amount, label: `冷却 −${amount}` },
    ]), { kind: 'remove', label: '删除一张卡' },
    ...ABYSS_GROWTH_TRAITS.map(item => ({ kind: 'trait' as const, label: `赋予 ${item.raw}`, trait: item })),
  ];
  const choices = upgrades.filter(option => abyssGrowthTargets(run.cards, option, run.crystals ?? 0).length > 0);
  choices.push({ kind: 'crystal', label: '深渊结晶 +1' });
  // Free rewards and paid cultivation share one pool; recruiting remains separate.
  const options = weightedChoices(choices, 3, rng, abyssGrowthGrade, growthKey);
  return { id, source, options };
}
