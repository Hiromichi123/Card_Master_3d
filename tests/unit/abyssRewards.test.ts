import { describe, expect, it } from 'vitest';
import { cardById, cardDatabase } from '../../src/data';
import { RARITY_TO_LEVEL } from '../../src/domain/cards/types';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import { abyssWeekKey, ABYSS_WEEKLY_TIERS, abyssPendingPacks } from '../../src/domain/progression/abyssRewards';
import { normalizeProfile } from '../../src/domain/progression/saveTransfer';
import { validateAbyssState } from '../../src/domain/progression/abyssValidation';
import type { AbyssAction } from '../../src/domain/progression/abyssTypes';
import type { ProfileState } from '../../src/domain/progression/types';

const now = new Date('2026-10-13T10:00:00Z');
type Action = AbyssAction extends infer T ? T extends AbyssAction ? Omit<T, 'expectedToken' | 'operationId'> : never : never;
const fresh = () => createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261013', starterCardIds: [], now });
function move(profile: ProfileState, action: Action, date = now): ProfileState {
  const planned = planAbyssAction(profile, { ...action, expectedToken: abyssStateToken(profile) }, date);
  if ('rejected' in planned) throw new Error(planned.rejected);
  const folded = applyEconomyTransaction(profile, planned.transaction);
  expect(folded.applied).toBe(true); expect(validateAbyssState(folded.profile.abyss)).toBe(true);
  return folded.profile;
}
function start(profile = fresh()): ProfileState {
  return move(move(profile, { kind: 'start' }), { kind: 'chooseStarter', index: 0 });
}
function enter(profile: ProfileState): ProfileState {
  return move(move(profile, { kind: 'chooseBoon', index: 0 }), { kind: 'beginBattle' });
}
function win(profile: ProfileState): ProfileState {
  const stage = profile.abyss.run!.stage;
  if (stage.kind !== 'inBattle') throw new Error('not in battle');
  return move(move(profile, { kind: 'settle', battleId: stage.battle.battleId, outcome: { kind: 'win', winner: 'player', reason: 'hpDepleted' } }), { kind: 'skipFree' });
}
function campAt(ordinal: number, profile = start()): ProfileState {
  let current = profile;
  for (;;) {
    const run = current.abyss.run!;
    if ((run.floor - 1) * 10 + run.encounter === ordinal && run.stage.kind === 'camp') return current;
    if (run.stage.kind === 'camp' || run.stage.kind === 'bossDecision') current = move(current, { kind: 'next' });
    else current = win(enter(current));
  }
}

describe('深渊永久奖励与独立周账本', () => {
  it('第一个节点原子发钱，候选五张平均C；刷新后手选五选三只入库一次', () => {
    const before = campAt(10), settled = move(before, { kind: 'finish' });
    const claim = settled.abyss.completionClaims![0]!;
    expect(settled.abyss.run).toBeNull();
    expect(claim.gold).toBeGreaterThanOrEqual(2000); expect(claim.gold).toBeLessThanOrEqual(2500);
    expect(claim.crystal).toBeGreaterThanOrEqual(100); expect(claim.crystal).toBeLessThanOrEqual(150);
    expect(settled.currencies.gold).toBe(before.currencies.gold + claim.gold);
    expect(settled.currencies.crystal).toBe(before.currencies.crystal + claim.crystal);
    expect(settled.inventory).toBe(before.inventory);
    expect(claim.candidates.reduce((sum, id) => sum + RARITY_TO_LEVEL[cardById.get(id)!.rarity], 0) / 5).toBe(5);
    const restored = normalizeProfile(JSON.parse(JSON.stringify(settled)), { contentVersion: cardDatabase.contentVersion, dayKey: '20261013', now, knownCardIds: new Set(cardById.keys()) });
    expect(restored.ok).toBe(true); if (!restored.ok) throw new Error('not restored');
    expect(restored.profile.abyss.completionClaims).toEqual(settled.abyss.completionClaims);
    const action: Action = { kind: 'chooseRewardPack', claimId: claim.id, indices: [4, 1, 0] };
    const planned = planAbyssAction(restored.profile, { ...action, expectedToken: abyssStateToken(restored.profile) }, now);
    if ('rejected' in planned) throw new Error(planned.rejected);
    const received = applyEconomyTransaction(restored.profile, planned.transaction).profile;
    expect(abyssPendingPacks(received.abyss)).toHaveLength(0);
    for (const i of [4, 1, 0]) expect(received.inventory[claim.candidates[i]!]).toBe((settled.inventory[claim.candidates[i]!] ?? 0) + 1);
    expect(received.currencies).toBe(restored.profile.currencies);
    expect(applyEconomyTransaction(received, planned.transaction).applied).toBe(false);
    expect(planAbyssAction(received, { ...action, expectedToken: abyssStateToken(received) }, now)).toHaveProperty('rejected');
    expect(planAbyssAction(settled, { ...action, indices: [0, 0, 1], expectedToken: abyssStateToken(settled) }, now)).toHaveProperty('rejected');
  });

  it('中途放弃取最近通过节点，低于1-10没有奖励；Boss失败也取上个节点', () => {
    expect(move(campAt(9), { kind: 'abandon' }).abyss.completionClaims ?? []).toHaveLength(0);
    const middle = move(campAt(15), { kind: 'abandon' });
    expect(middle.abyss.completionClaims![0]!.tier).toBe(1);
    const secondBoss = enter(move(campAt(19), { kind: 'next' }));
    const stage = secondBoss.abyss.run!.stage; if (stage.kind !== 'inBattle') throw new Error('not battle');
    const failed = move(secondBoss, { kind: 'settle', battleId: stage.battle.battleId, outcome: { kind: 'win', winner: 'enemy', reason: 'hpDepleted' } });
    expect(failed.abyss.run).toBeNull(); expect(failed.abyss.completionClaims![0]!.tier).toBe(1);
  });

  it('通关结算每周两轮，额度用尽仍可结束；新周重新获得额度', () => {
    let current = fresh();
    for (let i = 0; i < 3; i += 1) current = move(campAt(10, start(current)), { kind: 'finish' });
    expect(current.abyss.completionClaims).toHaveLength(2);
    const weekLater = new Date('2026-10-19T20:00:00Z');
    const fourth = campAt(10, start(current));
    const settled = move(fourth, { kind: 'finish' }, weekLater);
    expect(settled.abyss.completionClaims).toHaveLength(3);
    expect(settled.abyss.completionClaims![2]!.weekKey).not.toBe(settled.abyss.completionClaims![0]!.weekKey);
  });

  it('进入无尽立即第三档结算；同轮继续与退出不重复支付', () => {
    const thirdBoss = campAt(30), decision = move(thirdBoss, { kind: 'next' });
    expect(decision.abyss.completionClaims ?? []).toHaveLength(0);
    const endless = move(decision, { kind: 'next' });
    expect(endless.abyss.run).toMatchObject({ floor: 4, encounter: 1 });
    expect(endless.abyss.completionClaims).toHaveLength(1);
    expect(endless.abyss.completionClaims![0]!.tier).toBe(3);
    const finished = move(endless, { kind: 'abandon' });
    expect(finished.abyss.completionClaims).toEqual(endless.abyss.completionClaims);
    expect(finished.currencies).toBe(endless.currencies);
  });

  it('本周抵达9-10可累计五档，领取不改变通关奖励次数，指定卡跨新周重置', () => {
    const progressed = campAt(90), beforeQuota = progressed.abyss.completionClaims?.length ?? 0;
    const week = progressed.abyss.weeks![0]!;
    expect(week.highestReached).toBe(90);
    let current = progressed;
    for (const tier of ABYSS_WEEKLY_TIERS) current = move(current, { kind: 'claimWeekly', weekKey: week.weekKey, milestone: tier.reached });
    expect(current.abyss.weeks![0]!.claimedMilestones).toEqual([20, 30, 40, 60, 90]);
    expect(current.abyss.completionClaims?.length ?? 0).toBe(beforeQuota);
    for (const id of week.designatedCardIds) expect(current.inventory[id]).toBe((progressed.inventory[id] ?? 0) + 1);
    expect(planAbyssAction(current, { kind: 'claimWeekly', weekKey: week.weekKey, milestone: 20, expectedToken: abyssStateToken(current) }, now)).toHaveProperty('rejected');
    const newWeek = move(current, { kind: 'prepareWeek' }, new Date('2026-10-18T20:00:00Z'));
    expect(newWeek.abyss.weeks![1]).toMatchObject({ highestReached: 0, claimedMilestones: [] });
    expect(newWeek.abyss.weeks![0]).toEqual(current.abyss.weeks![0]);
    expect(newWeek.abyss.run?.stage).toEqual(current.abyss.run?.stage);
    expect(abyssWeekKey(Date.parse('2026-10-18T19:59:59.999Z'))).not.toBe(abyssWeekKey(Date.parse('2026-10-18T20:00:00Z')));
  });

  it('篡改奖励金额、额外库存和选择记录都不能混入普通深渊事务', () => {
    const before = campAt(10);
    const plan = planAbyssAction(before, { kind: 'finish', expectedToken: abyssStateToken(before) }, now);
    if ('rejected' in plan) throw new Error(plan.rejected);
    expect(applyEconomyTransaction(before, { ...plan.transaction, currencyDelta: { gold: 999999 } }).applied).toBe(false);
    expect(applyEconomyTransaction(before, { ...plan.transaction, inventoryDelta: { SSS_001: 1 } }).applied).toBe(false);
    const { abyssReward: _marker, ...withoutMarker } = plan.transaction;
    expect(_marker?.kind).toBe('completion');
    expect(applyEconomyTransaction(before, withoutMarker).applied).toBe(false);
    const claim = plan.view.completionClaims![0]!;
    expect(validateAbyssState({ ...plan.view, completionClaims: [{ ...claim, selected: [1, 1, 2] }] })).toBe(false);
  });
});
