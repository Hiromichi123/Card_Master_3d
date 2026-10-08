import type { Rng } from './rng';
import type { BattleState, Command } from './types';
import { inputSideOf, insertionSlots, isCooldownCard, readyCardIds } from './turnActions';

/** Baseline strategy: spend cooling cards, deploy all possible ready cards, random priority/insertion. */
export function chooseCommand(state: BattleState, rng: Rng, side = inputSideOf(state)): Command {
  if (state.outcome) return { kind: 'endTurn', side };
  if (state.phase === 'awaitingPriority') return { kind: 'choosePriority', side, order: rng.chance(0.5) ? 'first' : 'last' };
  const zones = state.zones[side];
  if (state.phase === 'awaitingPlay') {
    const token = zones.hand.find((id) => isCooldownCard(state.instances[id]?.definitionId ?? ''));
    const cooling = zones.prep.filter((id): id is string => id !== null && (state.instances[id]?.cd ?? 0) > 0)
      .sort((a, b) => state.instances[a]!.cd - state.instances[b]!.cd);
    if (token && cooling[0]) return { kind: 'useCooldownCard', side, instanceId: token, targetInstanceId: cooling[0] };
  }
  const ready = readyCardIds(state, side);
  const positions = insertionSlots(state, side);
  if (ready[0] && positions.length > 0) return { kind: 'deployCard', side, instanceId: ready[0], battleSlot: rng.pick(positions) };
  if (state.phase === 'awaitingPlay' && state.cardsPlayedThisTurn < state.rules.cardsPerTurn) {
    const slot = zones.prep.findIndex((id) => id === null);
    const hand = zones.hand.filter((id) => !isCooldownCard(state.instances[id]?.definitionId ?? ''));
    if (slot >= 0 && hand.length > 0) {
      const cd = (id: string): number => state.definitions[state.instances[id]?.definitionId ?? '']?.cd ?? 0;
      const best = Math.min(...hand.map(cd));
      return { kind: 'playCard', side, instanceId: rng.pick(hand.filter((id) => cd(id) === best)), prepSlot: slot };
    }
  }
  return { kind: 'endTurn', side };
}
