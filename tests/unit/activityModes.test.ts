import { describe, expect, it } from 'vitest';
import { cardDatabase } from '../../src/data';
import { activityPeriod, activityEnemyDeck, BOSS_PHASES, BOSS_TOTAL_HP, bossPhase, challengeMask,
  planActivityReceipt, activityProgressOf, normalizeActivityProgress } from '../../src/domain/progression/activityModes';
import type { ActivityBattleReport, ActivityReceipt, ActivityTicket } from '../../src/domain/progression/activityModes';
import { newActivityCycle, contribute, standings, settleActivityReport } from '../../src/services/activity/activityRepository';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { migrateToCurrent } from '../../src/domain/progression/migrations';

const now = Date.parse('2026-10-15T04:00:00+08:00');
const profile = () => createInitialProfile({ contentVersion: 'test', dayKey: '20261015', starterCardIds: ['D_001'],
  initialCurrencies: { gold: 0, crystal: 0, badge: 0 }, now: new Date(now) });
const won: ActivityBattleReport = { outcome: { kind: 'win', winner: 'player', reason: 'hpDepleted' }, turns: 14,
  playerHp: 20, enemyHp: 0, enemyBaseDamage: 40, playerBaseDamage: 0, handCount: 7 };
function ticket(cycle: ReturnType<typeof newActivityCycle>, id: string, actorId: string): ActivityTicket {
  const t: ActivityTicket = { id, actorId, name: actorId, mode: cycle.mode, period: cycle.period, phase: 0, createdAt: now,
    status: 'pending', config: { seed: 1, playerDeck: ['D_001'], enemyDeck: ['D_001'], rules: { baseHpBySide: { player:20, enemy:BOSS_TOTAL_HP } } } };
  cycle.actors[actorId] = actorId; cycle.tickets[id] = t; return t;
}

describe('shared boss and three-day challenge', () => {
  it('uses Beijing 04:00 boundaries without depending on the host timezone', () => {
    const week = activityPeriod('coop', now), threeDays = activityPeriod('extreme', now);
    expect(new Date(week.start).toISOString()).toBe('2026-10-11T20:00:00.000Z');
    expect(activityPeriod('coop', week.end - 1).key).toBe(week.key);
    expect(activityPeriod('coop', week.end).key).not.toBe(week.key);
    expect(threeDays.start).toBe(now);
    expect(threeDays.end - threeDays.start).toBe(3 * 86400000);
    expect(activityPeriod('extreme', now - 1).key).not.toBe(threeDays.key);
  });
  it('splits overflow between phases, freezes rank order, and caps the final health', () => {
    const cycle = newActivityCycle('coop',now); cycle.actors = { a:'Alice', b:'Bob' };
    contribute(cycle,'a',200); contribute(cycle,'b',150);
    expect(cycle.damage).toBe(350); expect(cycle.scores[0]).toEqual({ a:200,b:100 });
    expect(cycle.scores[1]).toEqual({ b:50 }); expect(standings(cycle,0).map(r => r.actorId)).toEqual(['a','b']);
    const frozen = structuredClone(cycle.frozen[0]);
    contribute(cycle,'b',BOSS_TOTAL_HP);
    expect(cycle.damage).toBe(BOSS_TOTAL_HP); expect(contribute(cycle,'a',500)).toBe(0);
    expect(cycle.frozen[0]).toEqual(frozen); expect(bossPhase(cycle.damage).remaining).toBe(0);
  });
  it('persists a stable receipt so retrying after profile failure cannot add damage twice', () => {
    const cycle = newActivityCycle('coop',now); ticket(cycle,'coop:attempt','a');
    const first = settleActivityReport(cycle,'coop:attempt','a',won,now);
    expect(first.damage).toBe(40);
    expect(settleActivityReport(cycle,'coop:attempt','a',won,now)).toBe(first);
    expect(cycle.damage).toBe(40);
    expect(() => settleActivityReport(cycle,'coop:attempt','b',won,now)).toThrow();
  });
  it('ignores expired boss damage while still recording completed battles', () => {
    const cycle = newActivityCycle('coop',now); ticket(cycle,'coop:expired','a');
    const receipt = settleActivityReport(cycle,'coop:expired','a',won,cycle.period.end);
    expect(receipt.damage).toBe(0); expect(cycle.damage).toBe(0); expect(receipt.battleId).toBe('coop:expired');
  });
  it('credits concurrent finishes only against currently remaining shared health', () => {
    const cycle = newActivityCycle('coop',now); ticket(cycle,'coop:a','a'); ticket(cycle,'coop:b','b');
    contribute(cycle,'a',BOSS_TOTAL_HP - 60);
    expect(settleActivityReport(cycle,'coop:a','a',won,now).damage).toBe(40);
    expect(settleActivityReport(cycle,'coop:b','b',won,now).damage).toBe(20);
    expect(cycle.damage).toBe(BOSS_TOTAL_HP);
  });
  it('generates reproducible public decks of the phase rarity, starting at D', () => {
    const key = activityPeriod('coop',now).key, defs = new Map(cardDatabase.definitions.map(c => [c.cardId,c]));
    for (let phase=0; phase<BOSS_PHASES.length; phase++) {
      const deck = activityEnemyDeck('coop',key,phase,cardDatabase.definitions);
      expect(deck).toHaveLength(12); expect(deck.every(id => defs.get(id)?.rarity === BOSS_PHASES[phase]!.rarity)).toBe(true);
      expect(activityEnemyDeck('coop',key,phase,cardDatabase.definitions)).toEqual(deck);
    }
    const challenge = activityEnemyDeck('extreme',activityPeriod('extreme',now).key,0,cardDatabase.definitions);
    expect(challenge).toHaveLength(12); expect(challenge.every(id => defs.get(id)?.status === 'complete')).toBe(true);
  });
  it('does not restore no-damage eligibility after healing; strict objectives exclude 15 rounds and 6 cards', () => {
    expect(challengeMask(won)).toBe(15);
    expect(challengeMask({ ...won, playerBaseDamage:1, turns:15, handCount:6 })).toBe(1);
    expect(challengeMask({ ...won, outcome:{ kind:'draw', reason:'turnLimit' } })).toBe(0);
  });
  it('awards only newly completed objectives and atomically records profile receipts and battle count', () => {
    let p = profile();
    const receipt = (id:string, report:ActivityBattleReport): ActivityReceipt => ({ id,actorId:'a',cycleKey:'extreme:0',kind:'battle',mode:'extreme',
      battleId:id,report,challengeBits:challengeMask(report),gold:0,crystal:0,label:'挑战结算' });
    const first = receipt('extreme:first',{ ...won,turns:15,handCount:6 });
    const plan = planActivityReceipt(p,first); if ('rejected' in plan) throw new Error(plan.rejected);
    const applied = applyEconomyTransaction(p,plan.transaction); expect(applied.applied).toBe(true); p=applied.profile;
    expect(p.currencies).toEqual({ gold:1200,crystal:120,badge:0 });
    expect(applyEconomyTransaction(p,plan.transaction).applied).toBe(false);
    const second = planActivityReceipt(p,receipt('extreme:second',won)); if ('rejected' in second) throw new Error(second.rejected);
    p=applyEconomyTransaction(p,second.transaction).profile;
    expect(p.currencies).toEqual({ gold:1600,crystal:160,badge:0 });
    const repeat = planActivityReceipt(p,receipt('extreme:repeat',won)); if ('rejected' in repeat) throw new Error(repeat.rejected);
    expect(repeat.transaction.currencyDelta).toEqual({ gold:0,crystal:0 });
    expect(applyEconomyTransaction(p,{ ...repeat.transaction,currencyDelta:{ gold:1000,crystal:100 } }).applied).toBe(false);
    p=applyEconomyTransaction(p,repeat.transaction).profile;
    expect(p.settledBattleIds).toHaveLength(3); expect(activityProgressOf(p).challengeBits['extreme:0']).toBe(15);
  });
  it('migrates v9 ledgers without replacing existing fields and rejects malformed reward history', () => {
    const old = { ...profile(), schemaVersion:9, activityModes:undefined };
    const migrated = migrateToCurrent(old,9); if (!migrated.ok) throw new Error(migrated.message);
    expect(migrated.value).toMatchObject({ schemaVersion:10,currencies:old.currencies,activityModes:{ receipts:[],challengeBits:{} } });
    expect(normalizeActivityProgress({ receipts:['r','r'],challengeBits:{} })).toBeNull();
    expect(normalizeActivityProgress({ receipts:[],challengeBits:{ 'extreme:0':2 } })).toBeNull();
  });
});
