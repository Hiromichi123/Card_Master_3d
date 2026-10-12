import { cardById, cardDatabase } from '../../data';
import { createRng, seedFrom } from '../battle/rng';
import { RARITY_TO_LEVEL, STANDARD_RARITIES, type CardDefinition, type CardRarity } from '../cards/types';
import { ABYSS_WEEK_MS, nextAbyssSettlement } from './abyss';
import type { AbyssCompletionClaim, AbyssRun, AbyssState } from './abyssTypes';
import type { EconomyTransaction } from './types';

export const ABYSS_WEEKLY_TIERS = [
  { reached: 20, label: '2-10', rarity: 'A' }, { reached: 30, label: '3-10', rarity: 'S' },
  { reached: 40, label: '4-10', rarity: 'S+' }, { reached: 60, label: '6-10', rarity: 'SS' },
  { reached: 90, label: '9-10', rarity: 'SSS' },
] as const;
export const ABYSS_COMPLETION_REWARDS = [
  { tier: 1, label: '1-10', gold: [2000, 2500], crystal: [100, 150], average: 'C', levels: [6, 5, 5, 4.5, 4.5] },
  { tier: 2, label: '2-10', gold: [3000, 3500], crystal: [200, 250], average: 'C+', levels: [5, 5, 4.5, 4, 4] },
  { tier: 3, label: '3-10', gold: [4500, 5000], crystal: [275, 325], average: 'B', levels: [5, 4, 4, 3.5, 3.5] },
] as const;
export const abyssWeekKey = (time: number): string => new Date(nextAbyssSettlement(time) - ABYSS_WEEK_MS).toISOString();
export const abyssProgressLabel = (ordinal: number): string => ordinal <= 0 ? '尚未开战' : `${Math.ceil(ordinal / 10)}-${(ordinal - 1) % 10 + 1}`;
export const abyssCompletionTier = (run: AbyssRun): number => Math.min(3, Math.floor((run.highestCleared ??
  Math.max((run.floor - 1) * 10, (run.stage.kind === 'camp' || run.stage.kind === 'bossDecision') && run.encounter === 10 ? run.floor * 10 : 0)) / 10));
export const abyssCompletionCount = (state: AbyssState, time: number): number => (state.completionClaims ?? []).filter(c => c.weekKey === abyssWeekKey(time)).length;
export const abyssPendingPacks = (state: AbyssState): readonly AbyssCompletionClaim[] => (state.completionClaims ?? []).filter(c => !c.selected);
const ordinary = (definitions: readonly CardDefinition[]) => definitions.filter(c => c.status === 'complete' && STANDARD_RARITIES.includes(c.rarity)).slice().sort((a, b) => a.cardId.localeCompare(b.cardId));

/** Catalogue choices are persisted, never regenerated when reopening a reward. */
export function prepareAbyssWeek(state: AbyssState, time: number, definitions = cardDatabase.definitions): AbyssState {
  const weekKey = abyssWeekKey(time);
  if (state.weeks?.some(w => w.weekKey === weekKey)) return state;
  const rng = createRng(seedFrom(`abyss-week:${weekKey}`));
  const pool = ordinary(definitions);
  const designatedCardIds = ABYSS_WEEKLY_TIERS.map(tier => rng.pick(pool.filter(c => c.rarity === tier.rarity)).cardId);
  return { ...state, weeks: [...state.weeks ?? [], { weekKey, highestReached: 0, designatedCardIds, claimedMilestones: [] }] };
}
export function markAbyssReached(state: AbyssState, run: AbyssRun, time: number, definitions = cardDatabase.definitions): AbyssState {
  const prepared = prepareAbyssWeek(state, time, definitions), key = abyssWeekKey(time);
  return { ...prepared, weeks: prepared.weeks!.map(w => w.weekKey === key ? { ...w, highestReached: Math.max(w.highestReached, (run.floor - 1) * 10 + run.encounter) } : w) };
}
export function abyssCompletionAmounts(runId: string, tier: number): { gold: number; crystal: number } {
  const rule = ABYSS_COMPLETION_REWARDS[tier - 1];
  if (!rule) throw new Error('尚未通关结算节点。');
  const rng = createRng(seedFrom(`abyss-completion:${runId}:${tier}`));
  return { gold: rng.int(rule.gold[0], rule.gold[1]), crystal: rng.int(rule.crystal[0], rule.crystal[1]) };
}
export function completionReward(state: AbyssState, run: AbyssRun, date: Date, definitions = cardDatabase.definitions): { state: AbyssState; claim?: AbyssCompletionClaim } {
  const tier = abyssCompletionTier(run);
  if (!tier || state.completionClaims?.some(c => c.runId === run.id) || abyssCompletionCount(state, date.getTime()) >= 2) return { state };
  const rule = ABYSS_COMPLETION_REWARDS[tier - 1]!;
  const rng = createRng(seedFrom(`abyss-pack:${run.id}:${tier}`));
  const pool = ordinary(definitions), chosen = new Set<string>();
  const candidates = rng.shuffle(rule.levels.map(level => {
    const matches = pool.filter(c => RARITY_TO_LEVEL[c.rarity] === level && !chosen.has(c.cardId));
    const card = rng.pick(matches); chosen.add(card.cardId); return card.cardId;
  }));
  const claim: AbyssCompletionClaim = { id: `${run.id}/completion`, runId: run.id, tier, weekKey: abyssWeekKey(date.getTime()),
    claimedAt: date.toISOString(), ...abyssCompletionAmounts(run.id, tier), candidates };
  return { state: { ...state, completionClaims: [...state.completionClaims ?? [], claim] }, claim };
}
export const packInventory = (claim: AbyssCompletionClaim, indices: readonly number[]): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const index of indices) { const id = claim.candidates[index]!; result[id] = (result[id] ?? 0) + 1; }
  return result;
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const sameInventory = (a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([id, amount]) => b[id] === amount);

/** Bound every main-wallet change to an atomic, persistent claim; mode currency never leaks. */
export function validAbyssRewardTransaction(old: AbyssState, next: AbyssState, tx: EconomyTransaction): boolean {
  const before = old.completionClaims ?? [], after = next.completionClaims ?? [], marker = tx.abyssReward;
  let expectedCurrency: { gold?: number; crystal?: number } = {}, expectedInventory: Record<string, number> = {};
  if (marker?.kind === 'completion') {
    const added = after[before.length];
    if (!added || added.selected !== undefined || after.length !== before.length + 1 || !same(before, after.slice(0, -1)) || !old.run
      || added.runId !== old.run.id || added.runId !== marker.runId || added.tier !== abyssCompletionTier(old.run)
      || before.some(c => c.runId === added.runId) || before.filter(c => c.weekKey === added.weekKey).length >= 2) return false;
    const archived = next.history.some(h => h.runId === added.runId);
    if (!archived && !(next.run?.id === added.runId && old.run.floor === 3 && old.run.encounter === 10 && next.run.floor === 4)) return false;
    expectedCurrency = abyssCompletionAmounts(added.runId, added.tier);
    if (added.gold !== expectedCurrency.gold || added.crystal !== expectedCurrency.crystal) return false;
  } else if (marker?.kind === 'pack') {
    const claim = before.find(c => c.id === marker.claimId);
    if (!claim || claim.selected || marker.indices.length !== 3 || new Set(marker.indices).size !== 3
      || marker.indices.some(i => !Number.isInteger(i) || i < 0 || i > 4)) return false;
    const expected = before.map(c => c === claim ? { ...c, selected: [...marker.indices].sort((a: number, b: number) => a - b) } : c);
    if (!same(expected, after)) return false;
    expectedInventory = packInventory(claim, marker.indices);
  } else if (!same(before, after)) return false;
  const oldWeeks = old.weeks ?? [], newWeeks = next.weeks ?? [];
  if (newWeeks.length < oldWeeks.length || newWeeks.length > oldWeeks.length + 1) return false;
  for (const week of oldWeeks) {
    const updated = newWeeks.find(w => w.weekKey === week.weekKey);
    if (!updated || !same(updated.designatedCardIds, week.designatedCardIds) || updated.highestReached < week.highestReached) return false;
    const milestones = marker?.kind === 'weekly' && marker.weekKey === week.weekKey ? [...week.claimedMilestones, marker.milestone].sort((a: number, b: number) => a - b) : week.claimedMilestones;
    if (!same(updated.claimedMilestones, milestones)) return false;
  }
  if (newWeeks.some(w => !oldWeeks.some(o => o.weekKey === w.weekKey) && w.claimedMilestones.length > 0)) return false;
  if (marker?.kind === 'weekly') {
    if (!same(before, after)) return false;
    const week = oldWeeks.find(w => w.weekKey === marker.weekKey);
    const index = ABYSS_WEEKLY_TIERS.findIndex(t => t.reached === marker.milestone);
    if (!week || index < 0 || week.highestReached < marker.milestone || week.claimedMilestones.includes(marker.milestone)) return false;
    expectedInventory = { [week.designatedCardIds[index]!]: 1 };
  }
  return Object.keys(tx.currencyDelta).every(k => k === 'gold' || k === 'crystal')
    && (tx.currencyDelta.gold ?? 0) === (expectedCurrency.gold ?? 0) && (tx.currencyDelta.crystal ?? 0) === (expectedCurrency.crystal ?? 0)
    && sameInventory(tx.inventoryDelta, expectedInventory);
}

/** Optional ledgers keep legacy v6 saves readable, but present records must be complete. */
export function validAbyssRewardLedgers(value: unknown): boolean {
  const state = value as AbyssState;
  const claims = state.completionClaims, weeks = state.weeks;
  const safeWeekKey = (time: number): string | null => { try { return abyssWeekKey(time); } catch { return null; } };
  const validKey = (key: unknown): key is string => typeof key === 'string' && safeWeekKey(Date.parse(key)) === key;
  const validCardId = (id: unknown): id is string => typeof id === 'string' && !!cardById.get(id) && STANDARD_RARITIES.includes(cardById.get(id)!.rarity);
  if (claims !== undefined) {
    if (!Array.isArray(claims) || claims.length > 10000) return false;
    const ids = new Set<string>(), counts = new Map<string, number>();
    for (const c of claims) {
      if (!c || typeof c.runId !== 'string' || c.runId.length > 300 || c.id !== `${c.runId}/completion` || ids.has(c.runId)
        || !Number.isInteger(c.tier) || c.tier < 1 || c.tier > 3 || !validKey(c.weekKey) || typeof c.claimedAt !== 'string'
        || !Number.isFinite(Date.parse(c.claimedAt)) || safeWeekKey(Date.parse(c.claimedAt)) !== c.weekKey
        || !Array.isArray(c.candidates) || c.candidates.length !== 5 || new Set(c.candidates).size !== 5 || !c.candidates.every(validCardId)) return false;
      const expectedLevels = [...ABYSS_COMPLETION_REWARDS[c.tier - 1]!.levels].sort((a: number, b: number) => a - b);
      const levels = c.candidates.map((id: string) => RARITY_TO_LEVEL[cardById.get(id)!.rarity]).sort((a: number, b: number) => a - b);
      if (!same(levels, expectedLevels)) return false;
      const amounts = abyssCompletionAmounts(c.runId, c.tier);
      if (c.gold !== amounts.gold || c.crystal !== amounts.crystal) return false;
      if (c.selected !== undefined && (!Array.isArray(c.selected) || c.selected.length !== 3 || new Set(c.selected).size !== 3
        || c.selected.some((i: number) => !Number.isInteger(i) || i < 0 || i > 4))) return false;
      ids.add(c.runId); const count = (counts.get(c.weekKey) ?? 0) + 1; counts.set(c.weekKey, count); if (count > 2) return false;
    }
  }
  if (weeks !== undefined) {
    if (!Array.isArray(weeks) || weeks.length > 10000 || new Set(weeks.map(w => w?.weekKey)).size !== weeks.length) return false;
    for (const w of weeks) {
      if (!w || !validKey(w.weekKey) || !Number.isSafeInteger(w.highestReached) || w.highestReached < 0
        || !Array.isArray(w.designatedCardIds) || w.designatedCardIds.length !== 5 || !w.designatedCardIds.every(validCardId)
        || !Array.isArray(w.claimedMilestones) || new Set(w.claimedMilestones).size !== w.claimedMilestones.length
        || w.claimedMilestones.some((n: number) => !ABYSS_WEEKLY_TIERS.some(t => t.reached === n) || n > w.highestReached)) return false;
      if (!w.designatedCardIds.every((id: string, i: number) => cardById.get(id)!.rarity === (ABYSS_WEEKLY_TIERS[i]!.rarity as CardRarity))) return false;
    }
  }
  return true;
}
