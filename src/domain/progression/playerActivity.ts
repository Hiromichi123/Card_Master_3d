import type { CardDefinition, CardRarity } from '../cards/types';
import { createRng, seedFrom } from '../battle/rng';
import { reject, type Planned } from './plan';
import type { EconomyTransaction, ProfileState } from './types';

export type NoviceKind = 'battle' | 'draw' | 'fusion';
export interface PlayerActivity {
  readonly draws: number; readonly fusions: number; readonly highestLadderPoints: number;
  readonly abyssSettledRunIds: readonly string[];
  readonly claimedFixed: readonly string[];
  readonly repeatClaims: Readonly<Record<NoviceKind, number>>;
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const natural = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function initialActivity(value: { readonly settledBattleIds?: unknown; readonly gacha?: unknown; readonly ladder?: unknown; readonly abyss?: unknown }): PlayerActivity {
  const gacha = record(value.gacha) ? value.gacha : {}, ladder = record(value.ladder) ? value.ladder : {};
  const pulls = record(gacha.pullsByPool) ? Object.values(gacha.pullsByPool).filter(natural) : [];
  const floors = Array.isArray(ladder.claimedTierFloors) ? ladder.claimedTierFloors.filter(natural) : [];
  const abyss = record(value.abyss) ? value.abyss : {};
  const claims = Array.isArray(abyss.completionClaims) ? abyss.completionClaims : [];
  const history = Array.isArray(abyss.history) ? abyss.history : [];
  const abyssSettledRunIds = [...new Set([...claims, ...history.filter(row => record(row) && row.reason === 'settled')]
    .filter(record).map(row => row.runId).filter((id): id is string => typeof id === 'string' && id.length > 0))];
  return { draws: Math.min(Number.MAX_SAFE_INTEGER, pulls.reduce((a, b) => a + b, 0)), fusions: 0,
    highestLadderPoints: Math.max(natural(ladder.points) ? ladder.points : 0, 0, ...floors),
    abyssSettledRunIds, claimedFixed: [], repeatClaims: { battle: 0, draw: 0, fusion: 0 } };
}
/** Missing legacy fields can be initialized; malformed existing reward ledgers cannot be erased. */
export function normalizeActivity(value: unknown, fallback: PlayerActivity): PlayerActivity | null {
  if (value === undefined) return fallback;
  if (!record(value) || !natural(value.draws) || !natural(value.fusions) || !natural(value.highestLadderPoints)
    || !Array.isArray(value.claimedFixed) || !record(value.repeatClaims)
    || !['battle', 'draw', 'fusion'].every(k => natural(value.repeatClaims && (value.repeatClaims as Record<string, unknown>)[k]))
    || value.claimedFixed.some(id => typeof id !== 'string' || !/^(battle|draw|fusion):[0-2]$/.test(id))
    || new Set(value.claimedFixed).size !== value.claimedFixed.length
    || (value.abyssSettledRunIds !== undefined && (!Array.isArray(value.abyssSettledRunIds)
      || value.abyssSettledRunIds.some(id => typeof id !== 'string' || !id)
      || new Set(value.abyssSettledRunIds).size !== value.abyssSettledRunIds.length))) return null;
  return { draws: value.draws, fusions: value.fusions, highestLadderPoints: Math.max(value.highestLadderPoints, fallback.highestLadderPoints),
    abyssSettledRunIds: [...new Set([...((value.abyssSettledRunIds as readonly string[] | undefined) ?? []), ...fallback.abyssSettledRunIds])],
    claimedFixed: [...value.claimedFixed] as string[], repeatClaims: { battle: value.repeatClaims.battle as number,
      draw: value.repeatClaims.draw as number, fusion: value.repeatClaims.fusion as number } };
}
export function activityOf(profile: ProfileState): PlayerActivity {
  if (profile.activity?.abyssSettledRunIds) return profile.activity;
  const base = initialActivity(profile);
  return profile.activity ? { ...profile.activity, abyssSettledRunIds: profile.activity.abyssSettledRunIds ?? base.abyssSettledRunIds } : base;
}
export function battleCountOf(profile: ProfileState): number {
  // Campaign, world tree and local player matches are settled here; abyss uses its separate ledger.
  return new Set(profile.settledBattleIds.filter(id => !id.startsWith('abyss:'))).size;
}
export function activityCount(profile: ProfileState, kind: NoviceKind): number {
  return kind === 'battle' ? battleCountOf(profile) : kind === 'draw' ? activityOf(profile).draws : activityOf(profile).fusions;
}
export interface NoviceTask { readonly kind: NoviceKind; readonly index: number; readonly target: number; readonly repeat: boolean; readonly label: string; readonly crystals: number; readonly rarities: readonly CardRarity[] }
export function noviceTasks(profile: ProfileState, kind: NoviceKind): readonly NoviceTask[] {
  const targets = kind === 'draw' ? [10, 30, 50] : [5, 10, 20];
  const tiers: readonly CardRarity[] = ['B', 'A', 'S'];
  return [...targets.map((target, index): NoviceTask => ({ kind, index, target, repeat: false,
    label: kind === 'fusion' ? `随机 ${tiers[index]} 卡牌 ×1` : `水晶 ${[100, 150, 200][index]}`,
    crystals: kind === 'fusion' ? 0 : [100, 150, 200][index]!, rarities: kind === 'fusion' ? [tiers[index]!] : [] })),
    { kind, index: activityOf(profile).repeatClaims[kind], target: targets[2]! + (activityOf(profile).repeatClaims[kind] + 1) * (kind === 'draw' ? 20 : 10),
      repeat: true, label: kind === 'fusion' ? '随机 A～S 卡牌 ×1' : '水晶 50', crystals: kind === 'fusion' ? 0 : 50,
      rarities: kind === 'fusion' ? ['A', 'A+', 'S'] : [] }];
}
export function taskClaimed(profile: ProfileState, task: NoviceTask): boolean {
  return !task.repeat && activityOf(profile).claimedFixed.includes(`${task.kind}:${task.index}`);
}
export function planNoviceClaim(profile: ProfileState, kind: NoviceKind, repeat: boolean, index: number, definitions: readonly CardDefinition[]): Planned<{ readonly text: string; readonly cardId?: string }> {
  const task = noviceTasks(profile, kind).find(t => t.repeat === repeat && t.index === index);
  if (!task || taskClaimed(profile, task) || activityCount(profile, kind) < task.target) return reject('任务未完成、已领取或当前奖励已变化。');
  const inventoryDelta: Record<string, number> = {};
  let cardId: string | undefined;
  if (task.rarities.length) {
    const pool = definitions.filter(c => c.status === 'complete' && task.rarities.includes(c.rarity)).sort((a, b) => a.cardId.localeCompare(b.cardId));
    if (!pool.length) return reject('对应奖励卡池暂无可用卡牌。');
    cardId = createRng(seedFrom(`novice:${profile.contentVersion}:${kind}:${repeat}:${index}:${profile.revision}`)).pick(pool).cardId;
    inventoryDelta[cardId] = 1;
  }
  return { transaction: { operationId: `novice:${kind}:${repeat ? 'repeat' : 'fixed'}:${index}`, currencyDelta: task.crystals ? { crystal: task.crystals } : {}, inventoryDelta,
      noviceClaim: { kind, repeat, index } }, view: { text: `已领取 ${task.label}`, ...(cardId ? { cardId } : {}) } };
}
export function validNoviceTransaction(profile: ProfileState, tx: EconomyTransaction): boolean {
  const claim = tx.noviceClaim; if (!claim) return true;
  if (!['battle', 'draw', 'fusion'].includes(claim.kind) || typeof claim.repeat !== 'boolean' || !natural(claim.index)) return false;
  const task = noviceTasks(profile, claim.kind).find(t => t.repeat === claim.repeat && t.index === claim.index);
  if (!task || taskClaimed(profile, task) || activityCount(profile, claim.kind) < task.target
    || tx.abyssUpdate || tx.abyssReward || tx.rewardClaim || tx.ladderRewardClaim || tx.settleBattleId || tx.clearStageId
    || tx.xpDelta !== undefined || tx.activityEvent || tx.shopDayKey || tx.soldOutAdditions || tx.mazeUpdate || tx.mazeSoldOut || tx.mazeShopExpected || tx.mazeShopRefresh
    || (tx.currencyDelta.gold ?? 0) !== 0 || (tx.currencyDelta.badge ?? 0) !== 0 || (tx.currencyDelta.crystal ?? 0) !== task.crystals) return false;
  const amounts = Object.values(tx.inventoryDelta);
  return task.kind === 'fusion' ? amounts.length === 1 && amounts[0] === 1 : amounts.length === 0;
}
export function foldActivity(profile: ProfileState, tx: EconomyTransaction): PlayerActivity {
  const current = activityOf(profile), claim = tx.noviceClaim;
  const nextAbyss = tx.abyssUpdate?.state, run = profile.abyss.run;
  const reachedEndless = run?.floor === 3 && run.encounter === 10 && nextAbyss?.run?.id === run.id && nextAbyss.run.floor === 4;
  const abyssSettledRunIds = [...new Set([...current.abyssSettledRunIds,
    ...(nextAbyss?.completionClaims ?? []).map(c => c.runId),
    ...(nextAbyss?.history ?? []).filter(h => h.reason === 'settled').map(h => h.runId),
    ...(reachedEndless ? [run!.id] : [])])];
  return { ...current, draws: current.draws + (tx.activityEvent?.kind === 'draw' ? tx.activityEvent.count : 0),
    fusions: current.fusions + (tx.activityEvent?.kind === 'fusion' ? 1 : 0),
    highestLadderPoints: Math.max(current.highestLadderPoints, profile.ladder.points), abyssSettledRunIds,
    claimedFixed: claim && !claim.repeat ? [...current.claimedFixed, `${claim.kind}:${claim.index}`] : current.claimedFixed,
    repeatClaims: claim?.repeat ? { ...current.repeatClaims, [claim.kind]: current.repeatClaims[claim.kind] + 1 } : current.repeatClaims };
}
