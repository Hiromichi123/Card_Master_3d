import { describe, expect, it } from 'vitest';
import { cardById, cardDatabase } from '../../src/data';
import { makeAbyssCard } from '../../src/domain/progression/abyssRules';
import { abyssRarityAtLevel, abyssRarityReduction, abyssTraitRarityReduction, withAbyssRarity, withAbyssRarities } from '../../src/domain/progression/abyssRarity';
import { abyssFaceRequest, recolorNamePixels } from '../../src/rendering/cards/abyssCardFace';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import { validateAbyssState } from '../../src/domain/progression/abyssValidation';
import type { SkillSpec } from '../../src/domain/skills/types';
import type { AbyssAction } from '../../src/domain/progression/abyssTypes';
import type { ProfileState } from '../../src/domain/progression/types';

const template = () => cardDatabase.definitions.find(card => card.rarity === 'C' && card.status === 'complete' && card.hp > 0)!;
const spec = (family: string, param: number | null = 1): SkillSpec => ({ raw: `${family}${param ?? ''}`, family, param, resolution: 'implemented' });
const now = new Date('2026-10-12T12:00:00Z');
type Action = AbyssAction extends infer T ? T extends AbyssAction ? Omit<T, 'expectedToken' | 'operationId'> : never : never;
function move(profile: ProfileState, action: Action): ProfileState {
  const plan = planAbyssAction(profile, { ...action, expectedToken: abyssStateToken(profile) }, now);
  if ('rejected' in plan) throw new Error(plan.rejected);
  const result = applyEconomyTransaction(profile, plan.transaction);
  expect(result.applied).toBe(true); expect(validateAbyssState(result.profile.abyss)).toBe(true);
  return result.profile;
}
function camp(): ProfileState {
  let profile = createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261012', starterCardIds: [], now });
  for (const action of [{ kind: 'start' }, { kind: 'chooseStarter', index: 0 }, { kind: 'chooseBoon', index: 0 }, { kind: 'beginBattle' }] as const) profile = move(profile, action);
  const stage = profile.abyss.run!.stage;
  if (stage.kind !== 'inBattle') throw new Error('not battle');
  profile = move(profile, { kind: 'settle', battleId: stage.battle.battleId, outcome: { kind: 'win', winner: 'player', reason: 'hpDepleted' } });
  return move(profile, { kind: 'skipFree' });
}

describe('深渊培养稀有度', () => {
  it('deducts the requested actual stat growth and trait categories from the original rarity level', () => {
    const card = makeAbyssCard(template(), 'abyss/test/starter/0');
    const grown = { ...card, upgrades: { atk: 1, hp: 2, cd: -1 }, addedTraits: [spec('fireball')] };
    expect(abyssRarityReduction(grown)).toBe(3.5);
    expect(withAbyssRarity(grown).definition).toMatchObject({ rarity: 'S+', level: 1.5 });
    expect(abyssTraitRarityReduction(spec('fireball', 3))).toBe(1);
    expect(abyssTraitRarityReduction(spec('groupFireball', 1))).toBe(1.5);
    expect(abyssTraitRarityReduction(spec('groupFireball', 2))).toBe(2);
    expect(abyssTraitRarityReduction(spec('spellReflect', null))).toBe(2);
    expect(abyssRarityAtLevel(5.5)).toBe('C');
    expect(abyssRarityAtLevel(-20)).toBe('SSS');
  });
  it('retains the best rarity on erasure without repeatedly counting reassignment', () => {
    const card = makeAbyssCard(template(), 'abyss/test/starter/0');
    const first = withAbyssRarity({ ...card, addedTraits: [spec('spellReflect', null)] });
    expect(first.definition.rarity).toBe('A');
    let current = withAbyssRarity({ ...first, addedTraits: [] });
    for (let i = 0; i < 8; i++) {
      current = withAbyssRarity({ ...current, addedTraits: [spec('fireball')] });
      current = withAbyssRarity({ ...current, addedTraits: [] });
    }
    expect(current.rarityReduction).toBe(2); expect(current.definition.rarity).toBe('A');
    expect(current.baseDefinition).toEqual(card.baseDefinition);
    expect(current.definition.art.artId).toBe(card.definition.art.artId);
  });
  it('does not promote event cards or automatic enemy floor growth', () => {
    const event = { ...template(), rarity: '#yoroi' as const, level: 3 };
    const special = makeAbyssCard(event, 'abyss/test/starter/0', 20, 30);
    const enemy = makeAbyssCard(template(), 'abyss/test/enemy/2/1/0', 20, 30);
    expect(withAbyssRarity(special)).toBe(special); expect(withAbyssRarity(enemy)).toBe(enemy);
  });
  it('atomically saves a paid training promotion without changing the collection/template and survives serialization', () => {
    let profile = camp();
    const target = profile.abyss.run!.cards.find(card => card.baseDefinition.rarity === 'C')!;
    const global = structuredClone(cardById.get(target.baseCardId)!);
    profile = move(profile, { kind: 'buy', purchase: 'trait' });
    const run = profile.abyss.run!, stage = run.stage;
    if (stage.kind !== 'camp' || !stage.offer) throw new Error('not offer');
    profile = { ...profile, abyss: { ...profile.abyss, run: { ...run, stage: { ...stage,
      offer: { ...stage.offer, options: [{ kind: 'atk', amount: 1, label: '攻击 +1' }] } } } } };
    profile = move(profile, { kind: 'chooseGrowth', offerId: stage.offer.id, index: 0, targetId: target.instanceId });
    const promoted = profile.abyss.run!.cards.find(card => card.instanceId === target.instanceId)!;
    expect(promoted.definition).toMatchObject({ rarity: 'B', level: 4 });
    expect(promoted.definition.art.abyssTitle).toEqual({ sourceRarity: 'C', sourceLevel: target.baseDefinition.level });
    expect(promoted.baseDefinition).toEqual(target.baseDefinition);
    expect(cardById.get(target.baseCardId)).toEqual(global);
    expect(validateAbyssState(JSON.parse(JSON.stringify(profile.abyss)))).toBe(true);
    const forged = { ...profile.abyss, run: { ...profile.abyss.run!, cards: profile.abyss.run!.cards.map(card => card.instanceId === target.instanceId
      ? { ...card, definition: { ...card.definition, rarity: 'SSS' as const, level: 0 } } : card) } };
    expect(validateAbyssState(forged)).toBe(false);
  });
  it('derives old saved cultivation without resetting choices and keeps the base art reference', () => {
    const profile = camp(), run = profile.abyss.run!;
    const old = makeAbyssCard(template(), `${run.id}/starter/0/0`, 1, 2);
    const legacy = { ...profile.abyss, run: { ...run, cards: [old] } };
    const converted = withAbyssRarities(legacy);
    expect(converted.run!.cards[0]!.definition.rarity).toBe('A');
    expect(converted.run!.stage).toBe(legacy.run.stage);
    expect(converted.run!.cards[0]!.baseDefinition.rarity).toBe('C');
    expect(converted.run!.cards[0]!.definition.art.artId).toBe(old.definition.art.artId);
    expect(withAbyssRarities(converted)).toBe(converted);
  });
});

describe('原名字形颜色覆盖', () => {
  it('keeps antialias, black outlines, alpha and all unmasked illustration pixels', () => {
    const pixels = new Uint8ClampedArray([0, 255, 0, 255, 0, 128, 0, 255, 0, 0, 0, 255, 0, 255, 0, 255]);
    const mask = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0]);
    expect(recolorNamePixels(pixels, mask, [0, 255, 0], [255, 0, 0])).toBe(2);
    expect([...pixels]).toEqual([255, 0, 0, 255, 128, 0, 0, 255, 0, 0, 0, 255, 0, 255, 0, 255]);
  });
  it('only requests a derived face for explicitly promoted Abyss definitions', () => {
    const base = template(), grown = withAbyssRarity(makeAbyssCard(base, 'abyss/test/starter/0', 1));
    expect(abyssFaceRequest(base, 'battle')).toBeNull();
    expect(abyssFaceRequest({ ...grown.definition, cardId: base.cardId }, 'battle')).toBeNull();
    const request = abyssFaceRequest(grown.definition, 'battle');
    expect(request?.source).toContain('/assets/card/');
    expect(request?.targetColor).toBe('#00bfff');
  });
});
