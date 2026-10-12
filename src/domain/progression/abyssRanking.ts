import type { AbyssBest, AbyssHistory, AbyssRun, AbyssState } from './abyssTypes';

export const abyssClearedLabel = (cleared: number): string => cleared > 0
  ? `${Math.floor((cleared - 1) / 10) + 1}-${(cleared - 1) % 10 + 1}` : '未通关';
function better(a: AbyssBest, b: AbyssBest | null): boolean {
  return !b || a.cleared > b.cleared || a.cleared === b.cleared && a.wins > b.wins;
}
/** Old records prove completed boss floors and at least the recorded number of wins. */
function legacyCleared(run: Pick<AbyssHistory, 'floor' | 'wins' | 'highestCleared'>): number {
  return run.highestCleared ?? Math.max((run.floor - 1) * 10, run.wins);
}
export function abyssBestOf(state: AbyssState): AbyssBest | null {
  let best = state.best ?? null;
  for (const entry of state.history) {
    const cleared = entry.reason === 'settled' && entry.encounter === 10
      ? entry.floor * 10 : legacyCleared(entry);
    const candidate = { cleared, wins: entry.wins, runId: entry.runId, achievedAt: entry.endedAt };
    if (cleared > 0 && better(candidate, best)) best = candidate;
  }
  const run = state.run;
  if (run) {
    const won = run.stage.kind === 'bossDecision' || run.stage.kind === 'camp' && run.stage.result === 'win';
    const cleared = Math.max(legacyCleared(run), won ? (run.floor - 1) * 10 + run.encounter : 0);
    const candidate = { cleared, wins: run.wins, runId: run.id, achievedAt: run.startedAt };
    if (cleared > 0 && better(candidate, best)) best = candidate;
  }
  return best;
}
/** Saved in the very same transaction as the victory; history pruning cannot remove it. */
export function withAbyssBest(state: AbyssState, run?: AbyssRun, now?: Date): AbyssState {
  let best = abyssBestOf(state);
  if (run && (run.highestCleared ?? 0) > 0) {
    const candidate: AbyssBest = { cleared: run.highestCleared!, wins: run.wins, runId: run.id,
      achievedAt: now?.toISOString() ?? run.startedAt };
    if (better(candidate, best)) best = candidate;
  }
  return best === (state.best ?? null) ? state : { ...state, best };
}
