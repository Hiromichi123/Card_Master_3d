import { describe, expect, it, vi } from 'vitest';
import { applyCommand, createBattle, validateCommand } from '../../src/domain/battle/engine';
import { autoEvolutionCommand, canAutoEvolve, syncAutoEvolution } from '../../src/domain/battle/autoEvolution';
import { isCooldownCard } from '../../src/domain/battle/turnActions';
import { observeForAi, sampleWorld } from '../../src/domain/battle/ai/observation';
import { BattleSession } from '../../src/rendering/presentation/session';
import type { BattleState } from '../../src/domain/battle/types';
import type { CardDefinition, SideId } from '../../src/domain/cards/types';

const idle: CardDefinition = { cardId: 'idle', name: 'Idle', rarity: 'C', level: 5,
  atk: 0, hp: 99, cd: 0, rawTraits: [], skills: [], status: 'complete', description: '',
  art: { artId: 'idle', sourcePresent: false } };
const definitions = { idle };
function battlefield(reserve = false): BattleState {
  const deck = reserve ? ['idle', 'idle'] : ['idle'];
  const state = createBattle({ seed: 12, playerDeck: deck, enemyDeck: deck,
    rules: { openingDraw: 1, drawPerTurn: reserve ? 1 : 0, turnLimit: 0 } }, definitions);
  for (const side of ['player', 'enemy'] as const) {
    const zones = state.zones[side];
    const id = zones.hand.find(id => !isCooldownCard(state.instances[id]!.definitionId))!;
    zones.hand.splice(zones.hand.indexOf(id), 1);
    zones.battle[0] = id;
    state.instances[id]!.zone = 'battle';
    state.instances[id]!.slotIndex = 0;
  }
  state.currentSide = 'player';
  syncAutoEvolution(state);
  return state;
}
const advance = (state: BattleState) => applyCommand(state, autoEvolutionCommand(state));

describe('残局自动演进', () => {
  it('ignores cooldown hands and remaining decks, but ordinary prep blocks entry', () => {
    const state = battlefield(true);
    expect(canAutoEvolve(state)).toBe(true);
    const id = state.zones.enemy.deck.shift()!;
    state.zones.enemy.prep[0] = id;
    state.instances[id]!.zone = 'prep';
    state.instances[id]!.slotIndex = 0;
    syncAutoEvolution(state);
    expect(state.autoEvolution).toBeNull();
  });

  it.each([{ player: 12, enemy: 9, winner: 'player' }, { player: 9, enemy: 12, winner: 'enemy' },
    { player: 12, enemy: 12, winner: null }])('judges base HP after precisely ten host actions: %j', ({ player, enemy, winner }) => {
    let state = battlefield();
    state.hp = { player, enemy };
    const original = structuredClone(state);
    for (let completed = 1; completed <= 10; completed++) {
      const result = advance(state);
      expect(result.accepted).toBe(true);
      expect(result.events.filter(e => e.type === 'BattleEnded')).toHaveLength(completed === 10 ? 1 : 0);
      expect(result.events.some(e => e.type === 'CooldownCardGranted')).toBe(false);
      state = result.finalState;
      expect(state.autoEvolution?.completedTurns).toBe(completed);
      if (completed < 10) expect(state.outcome).toBeNull();
    }
    expect(state.outcome).toEqual(winner
      ? { kind: 'win', winner, reason: 'autoEvolutionLimit' }
      : { kind: 'draw', reason: 'autoEvolutionLimit' });
    expect(original.autoEvolution?.completedTurns).toBe(0);
  });

  it('does not count a guest deployment window as a host action', () => {
    let state = battlefield();
    state.phase = 'awaitingResponse'; state.hostAttacked = false; state.priority = 'last';
    state = advance(state).finalState;
    expect(state.phase).toBe('awaitingPlay');
    expect(state.autoEvolution?.completedTurns).toBe(0);
    expect(advance(state).finalState.autoEvolution?.completedTurns).toBe(1);
  });

  it('ordinary draws exit auto mode; re-entry resets its counter', () => {
    let state = battlefield(true);
    const result = advance(state); state = result.finalState;
    expect(state.autoEvolution).toBeNull();
    expect(result.events.some(e => e.type === 'AutoEvolutionChanged' && !e.active)).toBe(true);
    const zones = state.zones.enemy;
    const id = zones.hand.find(id => !isCooldownCard(state.instances[id]!.definitionId))!;
    const deployed = applyCommand(applyCommand(state, { kind: 'playCard', side: 'enemy', instanceId: id }).finalState,
      { kind: 'deployCard', side: 'enemy', instanceId: id, battleSlot: 1 });
    expect(deployed.accepted).toBe(true);
    expect(deployed.finalState.autoEvolution?.completedTurns).toBe(0);
  });

  it('normal terminal outcomes win over the automatic deadline and old turn caps do not pre-empt it', () => {
    let state = battlefield();
    state = { ...state, rules: { ...state.rules, turnLimit: 1 }, turnIndex: 2 };
    expect(advance(state).finalState.outcome).toBeNull();
    state.hp.player = 0;
    expect(advance(state).finalState.outcome).toEqual({ kind: 'win', winner: 'enemy', reason: 'hpDepleted' });
  });

  it('allows either side to concede outside its input window and never overrides an existing outcome', () => {
    const state = battlefield();
    state.phase = 'awaitingResponse';
    expect(validateCommand(state, { kind: 'concede', side: 'enemy' }).ok).toBe(true);
    const result = applyCommand(state, { kind: 'concede', side: 'enemy' });
    expect(result.finalState.outcome).toEqual({ kind: 'win', winner: 'player', reason: 'conceded' });
    expect(applyCommand(result.finalState, { kind: 'concede', side: 'player' }).accepted).toBe(false);
    expect(state.outcome).toBeNull();
  });

  it('keeps auto progress in AI observations and reconstructs hidden hands as cooldown tokens', () => {
    const state = battlefield();
    const side: SideId = state.zones.enemy.hand.length ? 'player' : 'enemy';
    state.autoEvolution!.completedTurns = 3;
    const sampled = sampleWorld(observeForAi(state, [idle], false, side), 40);
    expect(sampled.autoEvolution?.completedTurns).toBe(3);
    expect(canAutoEvolve(sampled)).toBe(true);
  });
});

function session(drawPerTurn = 0, speed: 'skip' | 'normal' = 'skip') {
  const onOutcome = vi.fn(), decide = vi.fn();
  const game = new BattleSession({ seed: 12, playerDeck: ['idle'], enemyDeck: ['idle'],
    rules: { openingDraw: 0, drawPerTurn, turnLimit: 0 } }, definitions, () => speed,
    { play: () => {}, skipAll: () => {} },
    { localMultiplayer: true, autoEnemy: false, onOutcome,
      aiDriver: { decide, cancel: () => {}, dispose: () => {} } });
  game.start();
  return { game, onOutcome, decide };
}

describe('自动演进会话与认输', () => {
  it('advances both human sides without inputs or AI workers', () => {
    const { game, onOutcome, decide } = session();
    for (let frame = 0; frame < 80 && game.getSnapshot().mode !== 'result'; frame++) game.tick(1);
    expect(game.getSnapshot().mode).toBe('result');
    expect(game.getSnapshot().autoEvolutionTurns).toBe(10);
    expect(onOutcome).toHaveBeenCalledExactlyOnceWith({ kind: 'draw', reason: 'autoEvolutionLimit' });
    expect(decide).not.toHaveBeenCalled(); game.dispose();
  });

  it('opens normal human input after the next host draws a card', () => {
    const { game, decide } = session(1);
    for (let frame = 0; frame < 20 && !game.getSnapshot().inputOpen; frame++) game.tick(1);
    expect(game.getSnapshot().autoEvolutionActive).toBe(false);
    expect(game.getSnapshot().inputOpen).toBe(true);
    expect(decide).not.toHaveBeenCalled(); game.dispose();
  });

  it('concedes during the automatic wait and cancels every pending advance', () => {
    const { game, onOutcome } = session(0, 'normal');
    expect(game.isPerforming).toBe(true);
    game.concede('player');
    const seq = game.authoritative.nextEventSeq;
    game.skipPerformance();
    for (let frame = 0; frame < 5; frame++) game.tick(1);
    expect(game.authoritative.nextEventSeq).toBe(seq);
    expect(game.getSnapshot().mode).toBe('result');
    expect(onOutcome).toHaveBeenCalledExactlyOnceWith({ kind: 'win', winner: 'enemy', reason: 'conceded' });
    game.concede('enemy'); expect(onOutcome).toHaveBeenCalledTimes(1); game.dispose();
  });
});
