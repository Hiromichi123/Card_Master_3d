import { describe, expect, it } from 'vitest';
import { cardDatabase } from '../../src/data';
import { abyssBaseHp, abyssPurchasePrice, ABYSS_REWARD_DRAWS, ABYSS_WIN_COINS, makeAbyssGrowthOffer } from '../../src/domain/progression/abyssRules';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { validateAbyssState } from '../../src/domain/progression/abyssValidation';
import { compileAbyssBattle } from '../../src/scenes/abyssBattle';
import { applyCommand, createBattle } from '../../src/domain/battle/engine';
import { evaluateState, rankActions, weightsFor, stateFeatures } from '../../src/domain/battle/ai/features';
import { legalActions } from '../../src/domain/battle/ai/actions';
import type { AbyssAction } from '../../src/domain/progression/abyssTypes';
import type { ProfileState } from '../../src/domain/progression/types';
import type { CardDefinition } from '../../src/domain/cards/types';

const now = new Date('2026-10-12T12:00:00Z');
type Action = AbyssAction extends infer T ? T extends AbyssAction ? Omit<T, 'expectedToken' | 'operationId'> : never : never;
function move(profile: ProfileState, action: Action) {
  const plan = planAbyssAction(profile, { ...action, expectedToken: abyssStateToken(profile) }, now);
  if ('rejected' in plan) throw new Error(plan.rejected);
  const result = applyEconomyTransaction(profile, plan.transaction);
  expect(result.applied).toBe(true); expect(validateAbyssState(result.profile.abyss)).toBe(true);
  return result.profile;
}
function started() {
  let p = createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261012', starterCardIds: [], now });
  for (const a of [{ kind: 'start' }, { kind: 'chooseStarter', index: 0 }, { kind: 'chooseBoon', index: 0 }, { kind: 'beginBattle' }] as const) p = move(p, a);
  return p;
}

describe('Abyss balance and AI tempo', () => {
  it('scales asymmetric base HP across floors and initializes battle authority from it', () => {
    const run = started().abyss.run!;
    if (run.stage.kind !== 'inBattle') throw new Error('not battle');
    expect(abyssBaseHp({ floor: 1, encounter: 1 })).toEqual({ player: 20, enemy: 20 });
    expect(abyssBaseHp({ floor: 1, encounter: 2 })).toEqual({ player: 22, enemy: 24 });
    const compiled = compileAbyssBattle(run, { ...run.stage.battle, floor: 2, encounter: 1 });
    expect(createBattle(compiled.config, compiled.definitions).hp).toEqual({ player: 40, enemy: 60 });
  });
  it.each([true, false])('rewards completion irrespective of victory: %s', won => {
    let p = started();
    for (let j = 1; j <= (won ? 10 : 2); j++) {
      const run = p.abyss.run!, stage = run.stage;
      if (stage.kind !== 'inBattle') throw new Error('not battle');
      p = move(p, { kind: 'settle', battleId: stage.battle.battleId, outcome: { kind: 'win', winner: won ? 'player' : 'enemy', reason: 'hpDepleted' } });
      expect(p.abyss.run!.coins - run.coins).toBe(ABYSS_WIN_COINS[stage.battle.difficulty]);
      expect(p.abyss.run!.stage).toMatchObject({ kind: 'camp', freeRemaining: ABYSS_REWARD_DRAWS[stage.battle.difficulty] });
      if (j === (won ? 10 : 2)) break;
      p = move(skipFreeRewards(p), { kind: 'next' });
      if (p.abyss.run!.stage.kind === 'bossDecision') p = move(p, { kind: 'next' });
      p = move(move(p, { kind: 'chooseBoon', index: 0 }), { kind: 'beginBattle' });
    }
  });
  it('keeps independent capped purchase counters through cancel and save; direct training is forbidden', () => {
    let p = started(); const stage = p.abyss.run!.stage;
    if (stage.kind !== 'inBattle') throw new Error('not battle');
    p = move(p, { kind: 'settle', battleId: stage.battle.battleId, outcome: { kind: 'win', winner: 'player', reason: 'hpDepleted' } });
    p = skipFreeRewards(p);
    p = { ...p, abyss: { ...p.abyss, run: { ...p.abyss.run!, coins: 1000, earnedCoins: 1000 } } };
    for (const purchase of ['trait', 'recruit'] as const) for (let i = 0; i < 12; i++) {
      const price = abyssPurchasePrice(p.abyss.run!, purchase), previous = p.abyss.run!.coins;
      expect(price).toBe(Math.min(purchase === 'trait' ? 30 : 50, 5 * (i + 1)));
      p = move(p, { kind: 'buy', purchase });
      expect(p.abyss.run!.coins).toBe(previous - price);
      expect(p.abyss.run!.stage).toMatchObject({ offer: { paidPrice: price } });
      p = move(p, { kind: 'cancelOffer' });
    }
    const saved = move(p, { kind: 'save' });
    expect(saved.abyss.run).toMatchObject({ recruitPurchases: 12, traitPurchases: 12 });
    expect(validateAbyssState(JSON.parse(JSON.stringify(saved.abyss)))).toBe(true);
    expect(planAbyssAction(saved, { kind: 'train', stat: 'atk', targetId: saved.abyss.run!.cards[0]!.instanceId, expectedToken: abyssStateToken(saved) }, now)).toHaveProperty('rejected');
  });
  it('uses the same cultivation pool for paid and free options and includes crystals without recruiting', () => {
    const run = started().abyss.run!;
    const kinds = new Set<string>();
    for (let serial = 0; serial < 160; serial++) {
      const paid = makeAbyssGrowthOffer(run, 'trait', serial, cardDatabase.definitions);
      const free = makeAbyssGrowthOffer(run, 'free', serial, cardDatabase.definitions);
      expect(paid.options).toEqual(free.options);
      for (const option of paid.options) kinds.add(option.kind);
    }
    expect(kinds.has('crystal')).toBe(true); expect(kinds.has('atk')).toBe(true); expect(kinds.has('recruit')).toBe(false);
  });
  it('scores committing a slow card above idle token banking for every style, with no simulated-state mutation', () => {
    const unit: CardDefinition = { cardId: 'unit', name: 'Unit', rarity: 'C', level: 5, atk: 4, hp: 8, cd: 6,
      rawTraits: [], skills: [], status: 'complete', description: '', art: { artId: 'unit', sourcePresent: false } };
    let state = createBattle({ seed: 12, playerDeck: ['unit'], enemyDeck: ['unit'], rules: { openingDraw: 1, drawPerTurn: 0 } }, { unit });
    state.currentSide = 'player';
    for (let i = 0; i < 8; i++) { state = applyCommand(state, { kind: 'endTurn', side: 'player' }).finalState; state.currentSide = 'player'; }
    const before = structuredClone(state);
    expect(stateFeatures(state, 'player')[9]).toBe(0); // No cooling target, no value for stockpiled tokens.
    for (const style of ['balanced', 'aggressive', 'defensive', 'control'] as const) {
      const weights = weightsFor(style), choices = rankActions(state, legalActions(state), weights);
      expect(choices[0]!.command.kind).toBe('playCard');
      const invested = applyCommand(state, choices[0]!.command).finalState;
      expect(evaluateState(invested, 'player', weights)).toBeGreaterThan(evaluateState(state, 'player', weights));
    }
    expect(state).toEqual(before);
  });
});

/** Leaving camp in these fixtures intentionally declines each remaining independent reward. */
function skipFreeRewards(profile: ProfileState): ProfileState {
  while (profile.abyss.run?.stage.kind === 'camp' && profile.abyss.run.stage.freeRemaining > 0)
    profile = move(profile, { kind: 'skipFree' });
  return profile;
}
