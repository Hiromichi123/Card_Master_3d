import { inputSideOf, isCooldownCard } from './turnActions';
import type { BattleEventPayload, BattleState, Command } from './types';

/** Ten alternating host actions, not ten pairs of turns. */
export const AUTO_EVOLUTION_LIMIT = 10;
type Emit = (event: BattleEventPayload) => void;

export function canAutoEvolve(state: BattleState): boolean {
  return !state.outcome && (['player', 'enemy'] as const).every(side =>
    [...state.zones[side].hand, ...state.zones[side].prep].every(id =>
      id === null || isCooldownCard(state.instances[id]?.definitionId ?? '')));
}

/** Re-entry always starts a fresh counter; remaining deck cards are irrelevant. */
export function syncAutoEvolution(state: BattleState, emit?: Emit): void {
  if (state.outcome) return;
  if (canAutoEvolve(state)) {
    if (!state.autoEvolution) {
      state.autoEvolution = { completedTurns: 0, limit: AUTO_EVOLUTION_LIMIT };
      emit?.({ type: 'AutoEvolutionChanged', active: true, ...state.autoEvolution });
    }
  } else if (state.autoEvolution) {
    const previous = state.autoEvolution;
    state.autoEvolution = null;
    emit?.({ type: 'AutoEvolutionChanged', active: false, ...previous });
  }
}

/** Called after normal outcome checks, only for a row that started in auto mode. */
export function finishAutoEvolutionTurn(state: BattleState, emit: Emit): void {
  syncAutoEvolution(state, emit);
  const progress = state.autoEvolution;
  if (state.outcome || !progress) return;
  progress.completedTurns += 1;
  emit({ type: 'AutoEvolutionChanged', active: true, ...progress });
  if (progress.completedTurns < progress.limit) return;
  state.outcome = state.hp.player === state.hp.enemy
    ? { kind: 'draw', reason: 'autoEvolutionLimit' }
    : { kind: 'win', winner: state.hp.player > state.hp.enemy ? 'player' : 'enemy', reason: 'autoEvolutionLimit' };
  state.phase = 'ended';
  emit({ type: 'BattleEnded', outcome: state.outcome });
}

export function autoEvolutionCommand(state: BattleState): Command {
  return { kind: 'endTurn', side: inputSideOf(state) };
}
