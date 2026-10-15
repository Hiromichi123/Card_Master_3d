import {
  activityPeriod, activityEnemyDeck, activitySeed, bossPhase, BOSS_PHASES, BOSS_TOTAL_HP,
  BOSS_MILESTONES, challengeMask, rankReward,
} from '../../domain/progression/activityModes';
import type { ActivityBattleReport, ActivityKind, ActivityPeriod, ActivityReceipt, ActivityTicket } from '../../domain/progression/activityModes';
import type { CardDefinition } from '../../domain/cards/types';

export interface BossStanding { readonly actorId: string; readonly name: string; readonly damage: number }
export interface ActivityCycle {
  readonly key: string; readonly mode: ActivityKind; readonly period: ActivityPeriod;
  damage: number; actors: Record<string, string>; scores: Record<string, Record<string, number>>;
  frozen: Record<string, BossStanding[]>; tickets: Record<string, ActivityTicket>; receipts: Record<string, ActivityReceipt>;
}
export const newActivityCycle = (mode: ActivityKind, now: number): ActivityCycle => {
  const period = activityPeriod(mode, now);
  return { key: period.key, mode, period, damage: 0, actors: {}, scores: {}, frozen: {}, tickets: {}, receipts: {} };
};
export function standings(cycle: ActivityCycle, phase: number): BossStanding[] {
  return cycle.frozen[phase] ?? Object.entries(cycle.scores[phase] ?? {}).map(([actorId, damage]) => ({ actorId, damage, name: cycle.actors[actorId] ?? '玩家' }))
    .filter(row => row.damage > 0).sort((a,b) => b.damage - a.damage || a.actorId.localeCompare(b.actorId));
}
export function personalDamage(cycle: ActivityCycle, actorId: string): number {
  return Object.values(cycle.scores).reduce((sum, phase) => sum + (phase[actorId] ?? 0), 0);
}
/** Pure settlement allocation, called inside one shared IDB write transaction. */
export function contribute(cycle: ActivityCycle, actorId: string, requested: number): number {
  if (!Number.isSafeInteger(requested) || requested < 0) throw new Error('无效的贡献伤害。');
  let left = Math.min(Math.max(0, Math.floor(requested)), BOSS_TOTAL_HP - cycle.damage), credited = left;
  while (left > 0) {
    const phase = bossPhase(cycle.damage), portion = Math.min(left, phase.remaining);
    if (portion <= 0) break;
    const scores = cycle.scores[phase.index] ?? {};
    cycle.scores[phase.index] = { ...scores, [actorId]: (scores[actorId] ?? 0) + portion };
    cycle.damage += portion; left -= portion;
    if (portion === phase.remaining) cycle.frozen[phase.index] = standings(cycle, phase.index);
  }
  return credited - left;
}
let opened: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!opened) opened = new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('无法使用本地共享存储，请允许此站点使用 IndexedDB。')); return; }
    const request = indexedDB.open('card-master-activity-local-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('cycles', { keyPath: 'key' });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opened = undefined; }; resolve(request.result); };
    request.onerror = () => reject(request.error ?? new Error('本地共享存储打开失败。'));
    request.onblocked = () => reject(new Error('共享存储被旧页面占用，请关闭旧页面后重试。'));
  }).catch(error => { opened = undefined; throw error; });
  return opened;
}
/** No await within the transaction: read, mutate and store are atomic across tabs/accounts. */
async function access<T>(write: boolean, work: (cycles: ActivityCycle[], put: (cycle: ActivityCycle) => void) => T): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('cycles', write ? 'readwrite' : 'readonly'), store = tx.objectStore('cycles');
    let result: T, failure: unknown;
    const request = store.getAll();
    request.onsuccess = () => {
      try { result = work(request.result as ActivityCycle[], cycle => { store.put(cycle); }); }
      catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('共享进度保存失败，请重试。'));
  });
}
export function readActivityCycles(): Promise<ActivityCycle[]> { return access(false, cycles => cycles); }
export function pendingTicket(cycles: readonly ActivityCycle[], actorId: string, mode: ActivityKind): ActivityTicket | undefined {
  return cycles.flatMap(c => Object.values(c.tickets)).find(t => t.actorId === actorId && t.mode === mode && t.status === 'pending');
}
export async function beginActivityBattle(actorId: string, name: string, mode: ActivityKind, playerDeck: readonly string[], cards: readonly CardDefinition[], now = Date.now()): Promise<ActivityTicket> {
  const byId = new Map(cards.map(card => [card.cardId, card]));
  if (!actorId || !playerDeck.length || playerDeck.length > 12 || playerDeck.some(id => byId.get(id)?.status !== 'complete')) throw new Error('请先配置1至12张有效卡牌。');
  const id = `${mode}:${crypto.randomUUID()}`;
  return access(true, (cycles, put) => {
    const pending = pendingTicket(cycles, actorId, mode);
    if (pending) return pending;
    const period = activityPeriod(mode, now), cycle = cycles.find(c => c.key === period.key) ?? newActivityCycle(mode, now);
    if (mode === 'coop' && cycle.damage >= BOSS_TOTAL_HP) throw new Error('本期世界 Boss 已被击败，请领取奖励并等待下期。');
    const phase = mode === 'coop' ? bossPhase(cycle.damage).index : 0;
    const ticket: ActivityTicket = { id, actorId, name, mode, period, phase, createdAt: now, status: 'pending', config: {
      seed: activitySeed(id), playerDeck: [...playerDeck], enemyDeck: activityEnemyDeck(mode, period.key, phase, cards),
      label: mode === 'coop' ? `世界 Boss · 阶段 ${phase + 1}` : '三日高难挑战',
      ai: { difficulty: mode === 'coop' && phase < 3 ? 'normal' : 'hard', style: 'balanced', policy: 'heuristic' },
      rules: { baseHpBySide: { player: 20, enemy: mode === 'coop' ? BOSS_TOTAL_HP - cycle.damage : 40 }, turnLimit: 30 },
    } };
    cycle.actors[actorId] = name; cycle.tickets[id] = ticket; put(cycle); return ticket;
  });
}
export function abandonActivityBattle(id: string, actorId: string): Promise<void> {
  return access(true, (cycles, put) => {
    const cycle = cycles.find(c => c.tickets[id]?.actorId === actorId), ticket = cycle?.tickets[id];
    if (!cycle || !ticket || ticket.status !== 'pending') return;
    cycle.tickets[id] = { ...ticket, status: 'abandoned' }; put(cycle);
  });
}
function validReport(report: ActivityBattleReport): boolean {
  return ['win','draw'].includes(report.outcome.kind) && (report.outcome.kind !== 'win' || ['player','enemy'].includes(report.outcome.winner))
    && [report.turns,report.playerHp,report.enemyHp,report.enemyBaseDamage,report.playerBaseDamage,report.handCount].every(n => Number.isSafeInteger(n) && n >= 0);
}
export function finishActivityBattle(id: string, actorId: string, report: ActivityBattleReport, now = Date.now()): Promise<ActivityReceipt> {
  if (!validReport(report)) return Promise.reject(new Error('无效的战斗结算。'));
  return access(true, (cycles, put) => {
    const cycle = cycles.find(c => c.tickets[id]?.actorId === actorId);
    if (!cycle) throw new Error('本次挑战记录不存在。');
    const receipt = settleActivityReport(cycle, id, actorId, report, now); put(cycle); return receipt;
  });
}
/** Same receipt must be returned after a profile write failure; never apply shared damage twice. */
export function settleActivityReport(cycle: ActivityCycle, id: string, actorId: string, report: ActivityBattleReport, now: number): ActivityReceipt {
  const ticket = cycle.tickets[id];
  if (!ticket || ticket.actorId !== actorId || !validReport(report)) throw new Error('本次挑战记录或战果无效。');
  const receiptId = `battle:${id}`, existing = cycle.receipts[receiptId];
  if (existing) return existing;
  if (ticket.status !== 'pending') throw new Error('本次挑战已被放弃。');
  let damage = 0;
  if (ticket.mode === 'coop' && now < ticket.period.end) damage = contribute(cycle, actorId, Math.min(report.enemyBaseDamage, ticket.config.rules?.baseHpBySide?.enemy ?? 0));
  const receipt: ActivityReceipt = { id: receiptId, actorId, cycleKey: cycle.key, mode: ticket.mode, kind: 'battle', battleId: id, report,
    damage, gold: 0, crystal: 0, ...(ticket.mode === 'extreme' ? { challengeBits: challengeMask(report) } : {}),
    label: ticket.mode === 'coop' ? (now >= ticket.period.end ? '期次已结束，本次伤害不计入排行' : `贡献伤害 ${damage}`) : '高难挑战结算' };
  cycle.receipts[receiptId] = receipt; cycle.tickets[id] = { ...ticket, status: 'finished' }; return receipt;
}
export function prepareBossReward(actorId: string, key: string, kind: 'milestone' | 'rank', index: number, now = Date.now()): Promise<ActivityReceipt> {
  return access(true, (cycles, put) => {
    const cycle = cycles.find(c => c.key === key && c.mode === 'coop');
    if (!cycle) throw new Error('本期没有贡献记录。');
    const id = `${key}:${kind}:${index}:${actorId}`, existing = cycle.receipts[id];
    if (existing) return existing;
    let reward: { gold: number; crystal: number }, label: string;
    if (kind === 'milestone') {
      const milestone = BOSS_MILESTONES[index];
      if (!milestone || personalDamage(cycle, actorId) < milestone.damage) throw new Error('累计伤害尚未达标。');
      reward = milestone; label = `${milestone.damage}伤害里程碑`;
    } else {
      if (!BOSS_PHASES[index] || (!cycle.frozen[index] && now < cycle.period.end)) throw new Error('该阶段尚未结算。');
      if (!cycle.frozen[index]) cycle.frozen[index] = standings(cycle, index);
      const rank = cycle.frozen[index]!.findIndex(row => row.actorId === actorId) + 1;
      if (!rank) throw new Error('本阶段没有贡献伤害。');
      reward = rankReward(rank); label = `阶段${index + 1} · 第${rank}名`;
    }
    const receipt: ActivityReceipt = { id, actorId, cycleKey: key, mode: 'coop', kind, gold: reward.gold, crystal: reward.crystal, label };
    cycle.receipts[id] = receipt; put(cycle); return receipt;
  });
}
