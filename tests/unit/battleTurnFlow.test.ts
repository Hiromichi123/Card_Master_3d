import { describe, expect, it } from 'vitest';
import { applyCommand, createBattle, validateCommand } from '../../src/domain/battle/engine';
import { hasUsableBattleAction, inputSideOf, isCooldownCard } from '../../src/domain/battle/turnActions';
import { BattleSession } from '../../src/rendering/presentation/session';
import type { BattleState } from '../../src/domain/battle/types';
import type { CardDefinition, SideId } from '../../src/domain/cards/types';

const unit: CardDefinition = { cardId: 'unit', name: 'Unit', rarity: 'C', level: 5,
  atk: 1, hp: 99, cd: 1, rawTraits: [], skills: [], status: 'complete', description: '',
  art: { artId: 'unit', sourcePresent: false } };
const definitions = { unit };
const config = { seed: 12, playerDeck: ['unit'], enemyDeck: ['unit'], rules: { openingDraw: 1, drawPerTurn: 0 } };
function ordinary(state: BattleState, side: SideId): string {
  return state.zones[side].hand.find(id => !isCooldownCard(state.instances[id]!.definitionId))!;
}
function prep(state: BattleState, side: SideId, cd: number): string {
  const id = ordinary(state, side), zones = state.zones[side];
  zones.hand.splice(zones.hand.indexOf(id), 1); zones.prep[0] = id;
  state.instances[id]!.zone = 'prep'; state.instances[id]!.slotIndex = 0; state.instances[id]!.cd = cd;
  return id;
}

describe('fixed guest deployment and actionless completion', () => {
  it('opens the mature guest window before any host action, without a priority choice or extra guest attack', () => {
    let state = createBattle(config, definitions); state.currentSide = 'player';
    prep(state, 'player', 1);
    const change = applyCommand(state, { kind: 'endTurn', side: 'player' });
    state = change.finalState;
    expect(change.accepted).toBe(true);
    expect(state.phase).toBe('awaitingResponse'); expect(state.currentSide).toBe('enemy');
    expect(inputSideOf(state)).toBe('player');
    expect(change.events.some(event => event.type === 'DeploymentWindowOpened')).toBe(true);
    expect(change.events.some(event => event.type === 'PriorityChosen')).toBe(false);
    expect(validateCommand(state, { kind: 'choosePriority', side: 'enemy', order: 'first' }).ok).toBe(false);
    const before = state.hp, turn = state.turnIndex;
    state = applyCommand(state, { kind: 'endTurn', side: 'player' }).finalState;
    expect(state.phase).toBe('awaitingPlay'); expect(state.turnIndex).toBe(turn); expect(state.hp).toEqual(before);
    expect(inputSideOf(state)).toBe('enemy');
  });

  it('keeps cooldown targets and deployable mature cards actionable, even after the ordinary card quota', () => {
    const state = createBattle(config, definitions);
    const side = state.zones.enemy.hand.some(id => isCooldownCard(state.instances[id]!.definitionId)) ? 'enemy' : 'player';
    state.currentSide = side; state.cardsPlayedThisTurn = 1;
    const id = prep(state, side, 1);
    expect(hasUsableBattleAction(state)).toBe(true);
    state.instances[id]!.cd = 0;
    expect(hasUsableBattleAction(state)).toBe(true);
    state.zones[side].battle.fill('occupied');
    expect(hasUsableBattleAction(state)).toBe(false);
    state.phase = 'awaitingResponse'; state.currentSide = side === 'player' ? 'enemy' : 'player';
    state.instances[id]!.cd = 1;
    expect(hasUsableBattleAction(state)).toBe(false); // Guests cannot spend cooldown cards.
  });

  it('waits a full unscaled second and cancels/resets when the option is switched off', () => {
    let enabled = true;
    const session = new BattleSession(config, definitions, () => 'skip', { play: () => {}, skipAll: () => {} },
      { localMultiplayer: true, autoEnemy: false, readSkipTurnEnd: () => enabled });
    session.start();
    const state = session.authoritative, side = inputSideOf(state);
    const id = ordinary(state, side), zones = state.zones[side];
    zones.hand.splice(zones.hand.indexOf(id), 1); zones.battle[0] = id;
    state.instances[id]!.zone = 'battle'; state.instances[id]!.slotIndex = 0;
    session.refreshTurnPreferences();
    expect(session.getSnapshot().autoTurnEndPending).toBe(true);
    session.tick(.8); expect(session.authoritative.turnIndex).toBe(1);
    enabled = false; session.refreshTurnPreferences(); session.tick(2);
    expect(session.getSnapshot().autoTurnEndPending).toBe(false); expect(session.authoritative.turnIndex).toBe(1);
    enabled = true; session.refreshTurnPreferences(); session.tick(.99);
    expect(session.authoritative.turnIndex).toBe(1);
    session.tick(.02); expect(session.authoritative.turnIndex).toBe(2);
    session.dispose();
  });
});
