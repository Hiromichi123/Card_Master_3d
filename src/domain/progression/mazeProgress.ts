import { createRng, seedFrom } from '../battle/rng';
import { weekKeyOf } from './clock';
import { generateMaze, MAZE_FLOOR_1, mazeRngFor } from './maze';
import type { MazeProgressState, MazeRunState, ProfileState } from './types';

export function emptyMazeProgress(): MazeProgressState {
  return { explorationCount: 0, awardedCount: 0, lastRewardCardId: null, lastResetWeek: null };
}

export function mazeResetRemaining(progress: MazeProgressState, dayKey: string): 0 | 1 {
  const week = weekKeyOf(dayKey);
  return week && (!progress.lastResetWeek || week > progress.lastResetWeek) ? 1 : 0;
}

export function hasMazeHistory(progress: MazeProgressState): boolean {
  return progress.explorationCount > 0 || progress.awardedCount > 0
    || progress.lastRewardCardId !== null || progress.lastResetWeek !== null;
}

/** 包含位置、去重集合、货架与账本；旧动画不能覆盖新的任何迷宫状态。 */
export function mazeProgressToken(profile: Pick<ProfileState, 'mazeRun' | 'mazeProgress' | 'revision'>): string {
  return JSON.stringify([profile.revision, profile.mazeRun, profile.mazeProgress]);
}

/** 空池只累计不扣次数；有池后可由进入事务补发，不依赖再找到新格。 */
export function settleMazeGuarantees(
  progress: MazeProgressState,
  run: MazeRunState,
  cardIds: readonly string[],
): { progress: MazeProgressState; rewardCardIds: readonly string[]; inventoryDelta: Record<string, number> } {
  let { explorationCount, awardedCount, lastRewardCardId } = progress;
  const rewardCardIds: string[] = [];
  const inventoryDelta: Record<string, number> = {};
  while (cardIds.length > 0 && explorationCount >= 100) {
    const rng = createRng(seedFrom(`maze-guarantee:${run.floorKey}:${run.version}:${run.playerNodeId}:${awardedCount}`));
    const cardId = rng.pick(cardIds);
    rewardCardIds.push(cardId);
    inventoryDelta[cardId] = (inventoryDelta[cardId] ?? 0) + 1;
    explorationCount -= 100;
    awardedCount += 1;
    lastRewardCardId = cardId;
  }
  return { progress: { ...progress, explorationCount, awardedCount, lastRewardCardId }, rewardCardIds, inventoryDelta };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function natural(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function normalizeMazeProgress(value: unknown): MazeProgressState | null {
  if (!record(value) || !natural(value.explorationCount) || !natural(value.awardedCount)
    || !(value.lastRewardCardId === null || (typeof value.lastRewardCardId === 'string' && value.lastRewardCardId.length > 0))
    || !(value.lastResetWeek === null || (typeof value.lastResetWeek === 'string' && weekKeyOf(value.lastResetWeek) === value.lastResetWeek))
    || (value.awardedCount === 0) !== (value.lastRewardCardId === null)) return null;
  return {
    explorationCount: value.explorationCount, awardedCount: value.awardedCount,
    lastRewardCardId: value.lastRewardCardId, lastResetWeek: value.lastResetWeek,
  };
}

/** 校验而非重置探索集合，避免导入后重新计数。旧货架字段原样保留。 */
export function validateMazeState(
  rawRun: unknown,
  rawProgress: unknown,
  settledBattleIds: readonly string[] = [],
): { run: MazeRunState | null; progress: MazeProgressState } | null {
  const progress = normalizeMazeProgress(rawProgress);
  if (!progress) return null;
  if (rawRun === null || rawRun === undefined) {
    return hasMazeHistory(progress) || settledBattleIds.some(id => id.startsWith('maze:'))
      ? null : { run: null, progress };
  }
  if (!record(rawRun) || rawRun.floorKey !== MAZE_FLOOR_1 || !natural(rawRun.version) || rawRun.version < 1
    || !natural(rawRun.playerNodeId) || !Array.isArray(rawRun.exploredNodeIds) || !record(rawRun.shopByNode)) return null;
  const map = generateMaze(mazeRngFor(rawRun.floorKey, rawRun.version));
  const ids = rawRun.exploredNodeIds;
  if (ids.some(id => !natural(id) || !map.nodes[id]) || new Set(ids).size !== ids.length
    || !ids.includes(map.entryId) || !ids.includes(rawRun.playerNodeId) || !map.nodes[rawRun.playerNodeId]) return null;
  for (const [key, shop] of Object.entries(rawRun.shopByNode)) {
    const id = Number(key);
    if (!natural(id) || String(id) !== key || map.nodes[id]?.type !== 'supply' || !ids.includes(id)
      || !record(shop) || typeof shop.dayKey !== 'string' || !natural(shop.seed) || shop.seed > 0xffffffff
      || !Array.isArray(shop.soldOut) || shop.soldOut.some(entry => typeof entry !== 'string')
      || (shop.catalogVersion !== undefined && shop.catalogVersion !== 2)
      || (shop.refreshCount !== undefined && !natural(shop.refreshCount))) return null;
  }
  return { run: rawRun as unknown as MazeRunState, progress };
}
