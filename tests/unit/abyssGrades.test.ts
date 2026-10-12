import { describe, expect, it } from 'vitest';
import { cardDatabase } from '../../src/data';
import { SKILL_RULES } from '../../src/domain/skills/rules';
import { ABYSS_EFFECTS, ABYSS_GROWTH_TRAITS, makeAbyssCard, scaleAbyssEffect } from '../../src/domain/progression/abyssRules';
import { abyssEffectGrade, abyssEffectLevel, abyssGrowthAmount, abyssGrowthGrade, abyssStatGrade, abyssTraitGrade,
  abyssTraitDiscoveryId } from '../../src/domain/progression/abyssGrades';
import { withAbyssBattleEffects } from '../../src/scenes/abyssBattle';
import { abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { validateAbyssState } from '../../src/domain/progression/abyssValidation';
import type { SkillSpec } from '../../src/domain/skills/types';
import type { AbyssAction, AbyssGrowthOffer } from '../../src/domain/progression/abyssTypes';
import type { ProfileState } from '../../src/domain/progression/types';

const spec = (family: string, param: number | null = 1): SkillSpec => ({ raw: `${family}${param ?? ''}`, family, param, resolution: 'implemented' });
const now = new Date('2026-10-12T10:00:00Z');
type Action = AbyssAction extends infer T ? T extends AbyssAction ? Omit<T, 'expectedToken' | 'operationId'> : never : never;
function move(profile: ProfileState, action: Action): ProfileState {
  const plan = planAbyssAction(profile, { ...action, expectedToken: abyssStateToken(profile) }, now);
  if ('rejected' in plan) throw new Error(plan.rejected);
  const result = applyEconomyTransaction(profile, plan.transaction);
  expect(result.applied).toBe(true);
  expect(validateAbyssState(result.profile.abyss)).toBe(true);
  return result.profile;
}
function camp(): ProfileState {
  let profile = createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261012', starterCardIds: [], now });
  for (const action of [{ kind: 'start' }, { kind: 'chooseStarter', index: 0 }, { kind: 'chooseBoon', index: 0 }, { kind: 'beginBattle' }] as const) profile = move(profile, action);
  const stage = profile.abyss.run!.stage;
  if (stage.kind !== 'inBattle') throw new Error('not battle');
  return move(profile, { kind: 'settle', battleId: stage.battle.battleId, outcome: { kind: 'win', winner: 'player', reason: 'hpDepleted' } });
}
function attributes(profile: ProfileState, legacy = false): ProfileState {
  const run = profile.abyss.run!, stage = run.stage;
  if (stage.kind !== 'camp' || !stage.offer) throw new Error('not camp');
  const offer: AbyssGrowthOffer = { ...stage.offer, options: legacy ? [
    { kind: 'atk', label: '攻击 +1' }, { kind: 'hp', label: '生命 +2' }, { kind: 'cd', label: '冷却 −1' },
  ] : [
    { kind: 'atk', amount: 3, label: '攻击 +3' }, { kind: 'hp', amount: 3, label: '生命 +3' }, { kind: 'cd', amount: 3, label: '冷却 −3' },
  ] };
  return { ...profile, abyss: { ...profile.abyss, run: { ...run, stage: { ...stage, offer } } } };
}

describe('深渊统一等级', () => {
  it('matches the requested attribute, skill, state, group and peak colors', () => {
    for (const stat of ['hp', 'cd'] as const) expect([1, 2, 3].map(n => abyssStatGrade(stat, n))).toEqual(['green', 'blue', 'purple']);
    expect([1, 2, 3].map(n => abyssStatGrade('atk', n))).toEqual(['blue', 'purple', 'gold']);
    expect([1, 2, 3].map(n => abyssTraitGrade(spec('fireball', n)))).toEqual(['blue', 'purple', 'gold']);
    expect([1, 2, 3].map(n => abyssTraitGrade(spec('defense', n)))).toEqual(['purple', 'gold', 'red']);
    expect(abyssTraitGrade(spec('selfHeal'))).toBe('purple');
    expect(abyssTraitGrade(spec('groupFireball'))).toBe('gold');
    expect(abyssTraitGrade(spec('groupFireball', 2))).toBe('red');
    expect(abyssTraitGrade(spec('spellReflect', null))).toBe('red');
    expect(abyssTraitGrade(spec('unyielding', null))).toBe('red');
  });
  it('uses actual applied values for scaled battle effects', () => {
    const vitality = ABYSS_EFFECTS.find(item => item.id === 'vitality')!;
    expect([1, 2, 3].map(n => abyssEffectGrade(scaleAbyssEffect(vitality, n)))).toEqual(['green', 'blue', 'purple']);
    const fire = ABYSS_EFFECTS.find(item => item.id === 'ability-fireball-1')!;
    const scaled = scaleAbyssEffect(fire, 3);
    expect(scaled.modifier.traits[0]).toMatchObject({ raw: '火球3', param: 3 });
    expect(abyssEffectGrade(scaled)).toBe('gold'); expect(abyssEffectLevel(scaled)).toBe(3);
    expect(scaled.description).toContain('3 点');
  });
  it('uses a curated fully implemented subset and preserves the old traits', () => {
    expect(ABYSS_GROWTH_TRAITS).toHaveLength(48);
    expect(ABYSS_GROWTH_TRAITS.every(skill => skill.family !== null && skill.family in SKILL_RULES && skill.resolution === 'implemented')).toBe(true);
    expect(new Set(ABYSS_GROWTH_TRAITS.map(skill => skill.family)).size).toBeLessThan(Object.keys(SKILL_RULES).length);
    expect(ABYSS_GROWTH_TRAITS.map(skill => skill.raw)).toEqual(expect.arrayContaining(['火球1', '防御1', '恢复1', '吸血1', '反击1', '加速1', '对空']));
  });
  it('temporarily upgrades the strongest existing skill without stacking or mutating the cultivation snapshot', () => {
    const template = cardDatabase.definitions.find(card => card.status === 'complete' && card.hp > 0)!;
    const own = { ...template, rawTraits: ['火球1'], skills: [{ ...spec('fireball'), raw: '火球1' }] };
    const base = makeAbyssCard(own, 'abyss/test/fire');
    const saved = structuredClone(base);
    const high = ABYSS_EFFECTS.find(effect => effect.id === 'ability-fireball-3')!;
    const low = ABYSS_EFFECTS.find(effect => effect.id === 'ability-fireball-1')!;
    const battle = withAbyssBattleEffects(base.definition, [high, low, high]);
    expect(battle.skills.filter(skill => skill.family === 'fireball')).toHaveLength(1);
    expect(battle.rawTraits).toEqual(['火球3']);
    expect(withAbyssBattleEffects(battle, [low]).rawTraits).toEqual(['火球3']);
    expect(base).toEqual(saved);
  });
  it('applies tier-three attribute rewards and preserves legacy unnumbered rewards', () => {
    let profile = attributes(camp());
    const run = profile.abyss.run!, stage = run.stage;
    if (stage.kind !== 'camp' || !stage.offer) throw new Error('not camp');
    const target = run.cards[0]!;
    profile = move(profile, { kind: 'chooseGrowth', offerId: stage.offer.id, index: 1, targetId: target.instanceId });
    expect(profile.abyss.run!.cards[0]!.definition.hp).toBe(target.definition.hp + 3);
    expect(profile.abyss.run!.cards[0]!.baseDefinition).toEqual(target.baseDefinition);
    const old = attributes(camp(), true), oldStage = old.abyss.run!.stage;
    if (oldStage.kind !== 'camp' || !oldStage.offer) throw new Error('not camp');
    expect(abyssGrowthAmount(oldStage.offer.options[1]!)).toBe(2);
    expect(abyssGrowthGrade(oldStage.offer.options[1]!)).toBe('blue');
    const oldTarget = old.abyss.run!.cards[0]!;
    const recovered = move(old, { kind: 'chooseGrowth', offerId: oldStage.offer.id, index: 1, targetId: oldTarget.instanceId });
    expect(recovered.abyss.run!.cards[0]!.definition.hp).toBe(oldTarget.definition.hp + 2);
  });
  it('accepts legacy family discovery and exact new tiers, rejecting forged discovery and reward levels', () => {
    const profile = attributes(camp()), fire = ABYSS_GROWTH_TRAITS.find(skill => skill.raw === '火球3')!;
    const state = { ...profile.abyss, knownEffectIds: ['trait:fireball', abyssTraitDiscoveryId(fire)] };
    expect(validateAbyssState(state)).toBe(true);
    expect(validateAbyssState({ ...state, knownEffectIds: ['trait:fireball:999'] })).toBe(false);
    const run = profile.abyss.run!, stage = run.stage;
    if (stage.kind !== 'camp' || !stage.offer) throw new Error('not camp');
    const invalid = { ...state, run: { ...run, stage: { ...stage, offer: { ...stage.offer, options: stage.offer.options.map((option, index) => index === 0 ? { ...option, amount: 4 } : option) } } } };
    expect(validateAbyssState(invalid)).toBe(false);
  });
});
