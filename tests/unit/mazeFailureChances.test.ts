import { expect, it } from 'vitest';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { mazeFailureProgress, mazeFailureRemaining, mazeProgressToken, normalizeMazeProgress } from '../../src/domain/progression/mazeProgress';
import { generateMaze, mazeRngFor } from '../../src/domain/progression/maze';
import { mazeSettlementFor, planMazeEnter, planMazeMove, planMazeLaunch, planMazeSettlement } from '../../src/scenes/mazeFlow';
import type { Planned } from '../../src/domain/progression/plan';
import type { ProfileState } from '../../src/domain/progression/types';

function apply<T>(profile: ProfileState, plan: Planned<T>) {
  if ('rejected' in plan) throw new Error(plan.rejected);
  const result = applyEconomyTransaction(profile, plan.transaction);
  expect(result.applied).toBe(true);
  return result.profile;
}
function initial() {
  const p = createInitialProfile({ contentVersion: 'test', dayKey: '20261022', starterCardIds: ['D_001'], now: new Date('2026-10-22T00:00:00Z') });
  return apply(p, planMazeEnter({ profile: p, operationId: 'enter', dayKey: '20261022' }));
}
it('starts old/new saves at one chance, accrues calendar days to three, and cannot refill by clock rollback', () => {
  const p = initial().mazeProgress;
  expect(mazeFailureRemaining(p, '20261022')).toBe(1);
  expect(mazeFailureRemaining(p, '20261023')).toBe(2);
  expect(mazeFailureRemaining(p, '20261130')).toBe(3);
  const empty = { ...p, failureChances: 0 };
  expect(mazeFailureRemaining(empty, '20261022')).toBe(0);
  expect(mazeFailureRemaining(empty, '20261023')).toBe(1);
  expect(mazeFailureProgress(empty, '20261021')).toEqual(empty);
  expect(normalizeMazeProgress({ ...empty, failureChances: 4 })).toBeNull();
  expect(normalizeMazeProgress(empty)).toEqual(empty);
});
it('settles a concession and its chance loss atomically once, preserves campaign progress, and blocks moving until next day', () => {
  const p = initial(), run = p.mazeRun!, map = generateMaze(mazeRngFor(run.floorKey, run.version));
  const node = map.nodes.find(n => n.type === 'normal')!;
  const launch = planMazeLaunch({ profile: p, run, node, explored: .1, playerDeck: ['D_001'], launchSeq: 1, dayKey: '20261022' });
  if ('rejected' in launch) throw new Error(launch.rejected);
  const loss = mazeSettlementFor(launch, { kind: 'win', winner: 'enemy', reason: 'conceded' });
  const plan = planMazeSettlement(launch, loss, 'quit', p, '20261022');
  const next = apply(p, plan);
  expect(next.mazeProgress.failureChances).toBe(0);
  expect(next.campaign).toEqual(p.campaign);
  if ('rejected' in plan) throw new Error(plan.rejected);
  expect(applyEconomyTransaction(next, plan.transaction)).toMatchObject({ applied: false, reason: 'alreadySettled' });
  const neighbor = map.nodes[run.playerNodeId]!.neighbors[0]!;
  expect(planMazeMove({ profile: next, nodeId: neighbor, operationId: 'blocked', expectedToken: mazeProgressToken(next), dayKey: '20261022' })).toHaveProperty('rejected');
  expect(planMazeLaunch({ profile: next, run, node, explored: .1, playerDeck: ['D_001'], launchSeq: 2, dayKey: '20261022' })).toHaveProperty('rejected');
  const moved = apply(next, planMazeMove({ profile: next, nodeId: neighbor, operationId: 'tomorrow', expectedToken: mazeProgressToken(next), dayKey: '20261023' }));
  expect(moved.mazeProgress.failureChances).toBe(1);
  expect(moved.mazeRun!.playerNodeId).toBe(neighbor);
});
it('does not spend a failure chance on victory', () => {
  const p = initial(), run = p.mazeRun!, map = generateMaze(mazeRngFor(run.floorKey, run.version));
  const launch = planMazeLaunch({ profile: p, run, node: map.nodes.find(n => n.type === 'normal')!, explored: .1, playerDeck: ['D_001'], launchSeq: 1 });
  if ('rejected' in launch) throw new Error(launch.rejected);
  const win = mazeSettlementFor(launch, { kind: 'win', winner: 'player', reason: 'hpDepleted' });
  const next = apply(p, planMazeSettlement(launch, win, 'won', p, '20261022'));
  expect(next.mazeProgress).toEqual(p.mazeProgress);
});
