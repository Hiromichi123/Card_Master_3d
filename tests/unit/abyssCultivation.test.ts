import { describe, expect, it } from 'vitest';
import { Euler, Vector3 } from 'three';
import { cardDatabase } from '../../src/data';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import { ABYSS_GROWTH_TRAITS, abyssGrowthTargets } from '../../src/domain/progression/abyssRules';
import { validateAbyssState } from '../../src/domain/progression/abyssValidation';
import type { AbyssAction, AbyssGrowthOption } from '../../src/domain/progression/abyssTypes';
import type { ProfileState } from '../../src/domain/progression/types';
import { handCardTransform } from '../../src/rendering/battle/layout';

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
function camp() {
  let profile = createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261012', starterCardIds: [], now });
  profile = move(move(profile, { kind: 'start' }), { kind: 'chooseStarter', index: 0 });
  for (let battle = 1; battle <= 8; battle++) {
    profile = move(move(profile, { kind: 'chooseBoon', index: 0 }), { kind: 'beginBattle' });
    const stage = profile.abyss.run!.stage;
    if (stage.kind !== 'inBattle') throw new Error('not in battle');
    profile = move(profile, { kind: 'settle', battleId: stage.battle.battleId, outcome: { kind: 'win', winner: 'player', reason: 'hpDepleted' } });
    profile = move(profile, { kind: 'skipFree' });
    if (battle < 8) profile = move(profile, { kind: 'next' });
  }
  return profile;
}

describe('深渊培养与存档', () => {
  it('applies drawn attributes repeatedly and replaces a cultivated trait for one crystal, preserving originals', () => {
    let profile = camp();
    const target = profile.abyss.run!.cards[0]!, original = structuredClone(target);
    const traits = ABYSS_GROWTH_TRAITS.filter(skill => !target.baseDefinition.skills.some(own => own.family === skill.family));
    const first = traits[0]!, second = traits.find(skill => skill.family !== first.family)!;
    const choose = (option: AbyssGrowthOption) => {
      profile = move(profile, { kind: 'buy', purchase: 'trait' });
      const run = profile.abyss.run!, stage = run.stage;
      if (stage.kind !== 'camp' || !stage.offer) throw new Error('not offer');
      profile = { ...profile, abyss: { ...profile.abyss, run: { ...run, stage: { ...stage,
        offer: { ...stage.offer, options: [option] } } } } };
      const command = { kind: 'chooseGrowth' as const, offerId: stage.offer.id, index: 0,
        ...(option.kind === 'crystal' ? {} : { targetId: target.instanceId }) };
      if (option.kind === 'trait' && run.cards.find(card => card.instanceId === target.instanceId)!.addedTraits.length > 0) {
        const before = JSON.stringify(profile);
        expect(planAbyssAction(profile, { ...command, expectedToken: abyssStateToken(profile) }, now)).toHaveProperty('rejected');
        expect(JSON.stringify(profile)).toBe(before); // No confirmation means no cost or consumed candidate.
      }
      profile = move(profile, { ...command, confirmReplace: true });
    };
    choose({ kind: 'trait', label: first.raw, trait: first });
    for (const stat of ['atk', 'atk', 'hp', 'hp'] as const) choose({ kind: stat, label: stat, amount: stat === 'hp' ? 2 : 1 });
    let grown = profile.abyss.run!.cards.find(card => card.instanceId === target.instanceId)!;
    expect(grown.definition.atk).toBe(original.definition.atk + 2);
    expect(grown.definition.hp).toBe(original.definition.hp + 4);
    const replace = { kind: 'trait' as const, label: second.raw, trait: second };
    expect(abyssGrowthTargets([grown], replace, 0)).toEqual([]);
    choose({ kind: 'crystal', label: '结晶' });
    expect(profile.abyss.run!.crystals).toBe(1);
    choose(replace);
    grown = profile.abyss.run!.cards.find(card => card.instanceId === target.instanceId)!;
    expect(profile.abyss.run!.crystals).toBe(0); expect(grown.addedTraits).toEqual([second]);
    expect(grown.definition.skills).toEqual([...original.baseDefinition.skills, second]);
    expect(grown.definition.atk).toBe(original.definition.atk + 2);
    expect(grown.definition.hp).toBe(original.definition.hp + 4);
    expect(profile.abyss.run!.traitPurchases).toBe(7);
    expect(validateAbyssState(JSON.parse(JSON.stringify(profile.abyss)))).toBe(true);
  });

  it('saves pending paid candidates exactly, without rerolling or consuming the offer', () => {
    const profile = move(camp(), { kind: 'buy', purchase: 'trait' });
    const saved = move(profile, { kind: 'save' });
    expect(saved.abyss.run!.stage).toEqual(profile.abyss.run!.stage);
    expect(saved.abyss.run!.coins).toBe(profile.abyss.run!.coins);
    expect(saved.abyss.run!.cards).toEqual(profile.abyss.run!.cards);
    expect(saved.abyss.run!.revision).toBe(profile.abyss.run!.revision + 1);
    expect(validateAbyssState(JSON.parse(JSON.stringify(saved.abyss)))).toBe(true);
  });

  it('does not allow erasing innate traits or modifying a card while an offer is pending', () => {
    const profile = camp(), target = profile.abyss.run!.cards[0]!;
    const erase = planAbyssAction(profile, { kind: 'eraseTrait', targetId: target.instanceId,
      family: target.baseDefinition.skills.find(skill => skill.family)?.family ?? 'fireball', expectedToken: abyssStateToken(profile) }, now);
    expect(erase).toHaveProperty('rejected');
    const pending = move(profile, { kind: 'buy', purchase: 'trait' });
    expect(planAbyssAction(pending, { kind: 'train', targetId: target.instanceId, stat: 'atk', expectedToken: abyssStateToken(pending) }, now)).toHaveProperty('rejected');
    expect(pending.abyss.run!.cards).toEqual(profile.abyss.run!.cards);
  });
});

it('each hand leans toward its owner and the face head is above its foot on both sides', () => {
  for (const side of ['player', 'enemy'] as const) {
    const pose = handCardTransform(0, 1, side);
    const rotation = new Euler(pose.rotationX, pose.rotationY, pose.rotationZ, 'XYZ');
    const normal = new Vector3(0, 0, 1).applyEuler(rotation);
    const head = new Vector3(0, 1, 0).applyEuler(rotation);
    expect(normal.y).toBeGreaterThan(0);
    expect(Math.sign(normal.z)).toBe(side === 'player' ? 1 : -1);
    expect(head.y).toBeGreaterThan(0);
    expect(Math.sign(head.z)).toBe(side === 'player' ? -1 : 1);
  }
});
