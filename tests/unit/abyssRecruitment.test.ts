import { describe, expect, it } from 'vitest';
import { cardDatabase } from '../../src/data';
import { abyssRecruitLevel, abyssRecruitDistribution, makeAbyssGrowthOffer } from '../../src/domain/progression/abyssRules';
import { abyssBestOf } from '../../src/domain/progression/abyssRanking';
import { leaderboardEntries, sortLeaderboard } from '../../src/domain/progression/leaderboard';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { validateAbyssState } from '../../src/domain/progression/abyssValidation';
import type { AbyssAction } from '../../src/domain/progression/abyssTypes';
import type { ProfileState } from '../../src/domain/progression/types';

const now = new Date('2026-10-12T12:00:00Z');
type Action = AbyssAction extends infer T ? T extends AbyssAction ? Omit<T, 'expectedToken' | 'operationId'> : never : never;
function move(profile: ProfileState, action: Action) {
  const plan = planAbyssAction(profile, { ...action, expectedToken: abyssStateToken(profile) }, now);
  if ('rejected' in plan) throw new Error(plan.rejected);
  const result = applyEconomyTransaction(profile, plan.transaction);
  expect(result.applied).toBe(true); expect(validateAbyssState(result.profile.abyss)).toBe(true);
  return result.profile;
}
function battle() {
  let p = createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261012', starterCardIds: [], now });
  for (const a of [{ kind: 'start' }, { kind: 'chooseStarter', index: 0 }, { kind: 'chooseBoon', index: 0 }, { kind: 'beginBattle' }] as const) p = move(p, a);
  return p;
}
function win(p: ProfileState) {
  const stage = p.abyss.run!.stage;
  if (stage.kind !== 'inBattle') throw new Error('not in battle');
  return move(p, { kind: 'settle', battleId: stage.battle.battleId, outcome: { kind: 'win', winner: 'player', reason: 'hpDepleted' } });
}

describe('Abyss recruits, endless and permanent leaderboard records', () => {
  it.each([[1, 1, 5], [1, 10, 3], [2, 10, 1.5], [3, 10, 0], [4, 1, 0]])('matches the target expectation at %i-%i', (floor, encounter, target) => {
    expect(abyssRecruitLevel({ floor, encounter })).toBe(target);
    const table = abyssRecruitDistribution({ floor, encounter }, cardDatabase.definitions);
    expect(table.reduce((sum, row) => sum + row.weight, 0)).toBeCloseTo(1, 10);
    expect(table.reduce((sum, row) => sum + row.level * row.weight, 0)).toBeCloseTo(target, 9);
    if (target === 0) expect(table).toEqual([{ rarity: 'SSS', level: 0, weight: 1 }]);
  });
  it('interpolates monotonically and creates stable three-card offers at the SSS cap', () => {
    let previous = 6;
    const run = battle().abyss.run!;
    for (let j = 0; j < 35; j++) {
      const stage = { floor: Math.floor(j / 10) + 1, encounter: j % 10 + 1 };
      const target = abyssRecruitLevel(stage);
      expect(target).toBeLessThanOrEqual(previous); previous = target;
    }
    const deep = { ...run, floor: 3, encounter: 10 };
    const a = makeAbyssGrowthOffer(deep, 'recruit', 1, cardDatabase.definitions);
    expect(a).toEqual(makeAbyssGrowthOffer(deep, 'recruit', 1, cardDatabase.definitions));
    expect(a.options).toHaveLength(3);
    expect(a.options.every(option => option.kind === 'recruit' && option.card.definition.rarity === 'SSS')).toBe(true);
    expect(new Set(a.options.map(option => option.kind === 'recruit' ? option.card.instanceId : '')).size).toBe(3);
  });
  it('pays once for three choices, keeps saved candidates and only acquires the selected card', () => {
    let p = move(win(battle()), { kind: 'skipFree' });
    p = move(p, { kind: 'buy', purchase: 'recruit' });
    const run = p.abyss.run!, stage = run.stage;
    if (stage.kind !== 'camp' || !stage.offer) throw new Error('not camp');
    expect(run.coins).toBe(10); expect(stage.offer.options).toHaveLength(3);
    const selected = stage.offer.options[2]!;
    if (selected.kind !== 'recruit') throw new Error('not recruit');
    const saved = move(p, { kind: 'save' });
    expect(saved.abyss.run!.stage).toEqual(stage);
    const legacy = { ...p.abyss, run: { ...run, stage: { ...stage, offer: { ...stage.offer, options: [stage.offer.options[0]!] } } } };
    expect(validateAbyssState(legacy)).toBe(true);
    p = move(saved, { kind: 'chooseGrowth', offerId: stage.offer.id, index: 2 });
    expect(p.abyss.run!.cards).toHaveLength(run.cards.length + 1);
    expect(p.abyss.run!.cards.at(-1)!.instanceId).toBe(selected.card.instanceId);
    expect(p.abyss.run!.recruitPurchases).toBe(1);
    expect(p.abyss.run!.coins).toBe(10);
  });
  it('opens settlement after 3-10, permits endless camp settlement, and preserves best results beyond ten histories', () => {
    let p = battle();
    for (let j = 1; j <= 30; j++) {
      p = move(win(p), { kind: 'skipFree' });
      p = move(p, { kind: 'next' });
      if (j === 10 || j === 20) {
        expect(p.abyss.run!.stage.kind).toBe('boonChoice');
        expect(planAbyssAction(p, { kind: 'finish', expectedToken: abyssStateToken(p) }, now)).toHaveProperty('rejected');
      }
      if (j < 30) p = move(move(p, { kind: 'chooseBoon', index: 0 }), { kind: 'beginBattle' });
    }
    expect(p.abyss.run!.stage.kind).toBe('bossDecision');
    const settled = move(p, { kind: 'finish' });
    expect(settled.abyss.history[0]).toMatchObject({ floor: 3, encounter: 10, reason: 'settled' });
    p = move(p, { kind: 'next' });
    p = move(move(p, { kind: 'chooseBoon', index: 0 }), { kind: 'beginBattle' });
    p = move(win(p), { kind: 'skipFree' });
    p = move(p, { kind: 'finish' });
    expect(p.abyss.history[0]).toMatchObject({ floor: 4, encounter: 1, reason: 'settled' });
    expect(abyssBestOf(p.abyss)).toMatchObject({ cleared: 31, wins: 31 });
    for (let j = 0; j < 12; j++) p = move(move(p, { kind: 'start' }), { kind: 'abandon' });
    expect(p.abyss.history).toHaveLength(10);
    expect(p.abyss.history.every(entry => entry.reason === 'abandoned')).toBe(true);
    const restored = JSON.parse(JSON.stringify(p));
    expect(validateAbyssState(restored.abyss)).toBe(true);
    expect(leaderboardEntries(restored, cardDatabase.definitions).find(row => row.isSelf)).toMatchObject({ abyssCleared: 31, abyssWins: 31 });
  });
  it('sorts depth before win tie-breaks without altering the original entries', () => {
    const base = leaderboardEntries(battle(), cardDatabase.definitions)[0]!;
    const rows = [{ ...base, id: 'b', abyssCleared: 30, abyssWins: 28 },
      { ...base, id: 'a', abyssCleared: 30, abyssWins: 29 }, { ...base, id: 'c', abyssCleared: 31, abyssWins: 28 }];
    expect(sortLeaderboard(rows, 'abyss').map(row => row.id)).toEqual(['c', 'a', 'b']);
    expect(rows.map(row => row.id)).toEqual(['b', 'a', 'c']);
  });
});
