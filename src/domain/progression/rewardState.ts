import { parseDayKey } from './clock';
import type { RewardsState } from './types';

export const CHECK_IN_LIMIT = 30;
export const STORY_NODE_PATTERN = /^[1-4]-[1-4]$/;

export function emptyRewards(): RewardsState {
  return { claimedStoryIds: [], checkIn: [] };
}

/** Older saves get an empty ledger; imported ledgers keep only valid, unique claims. */
export function normalizeRewards(value: unknown): RewardsState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return emptyRewards();
  const source = value as Record<string, unknown>;
  const claimedStoryIds = Array.isArray(source.claimedStoryIds)
    ? [...new Set(source.claimedStoryIds.filter((id): id is string =>
      typeof id === 'string' && STORY_NODE_PATTERN.test(id)))] : [];
  const candidates = Array.isArray(source.checkIn) ? source.checkIn : [];
  const records = candidates.filter((entry): entry is RewardsState['checkIn'][number] => {
    if (typeof entry !== 'object' || entry === null) return false;
    const row = entry as Record<string, unknown>;
    return typeof row.day === 'number' && Number.isInteger(row.day) && row.day >= 1 && row.day <= CHECK_IN_LIMIT
      && typeof row.dayKey === 'string' && parseDayKey(row.dayKey) !== null;
  }).sort((a, b) => a.day - b.day);
  const checkIn: RewardsState['checkIn'][number][] = [];
  for (const entry of records) {
    const previous = checkIn.at(-1);
    if (entry.day !== checkIn.length + 1 || (previous && entry.dayKey <= previous.dayKey)) continue;
    checkIn.push({ day: entry.day, dayKey: entry.dayKey });
  }
  return { claimedStoryIds, checkIn };
}

export function canCheckIn(rewards: RewardsState, day: number, dayKey: string): boolean {
  const last = rewards.checkIn.at(-1);
  return parseDayKey(dayKey) !== null && day <= CHECK_IN_LIMIT && day === rewards.checkIn.length + 1
    && (!last || dayKey > last.dayKey);
}
