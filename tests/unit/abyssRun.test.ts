import { describe, expect, it } from 'vitest';
import { cardDatabase } from '../../src/data';
import { RARITY_TO_LEVEL } from '../../src/domain/cards/types';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import { abyssDifficulty, abyssGrowthTargets, makeAbyssCard, makeAbyssGrowthOffer } from '../../src/domain/progression/abyssRules';
import { validateAbyssState } from '../../src/domain/progression/abyssValidation';
import type { AbyssAction, AbyssRun } from '../../src/domain/progression/abyssTypes';
import type { ProfileState } from '../../src/domain/progression/types';

const now = new Date('2026-10-11T10:00:00Z');
const fresh = () => createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261011', starterCardIds: ['D_002'], now });
type Action = AbyssAction extends infer T ? T extends AbyssAction ? Omit<T, 'expectedToken' | 'operationId'> : never : never;
function move(profile: ProfileState, action: Action): ProfileState {
  const plan = planAbyssAction(profile, { ...action, expectedToken: abyssStateToken(profile) }, now);
  if ('rejected' in plan) throw new Error(plan.rejected);
  const result = applyEconomyTransaction(profile, plan.transaction);
  expect(result.applied).toBe(true);
  expect(validateAbyssState(result.profile.abyss)).toBe(true);
  return result.profile;
}
function startBattle(profile = fresh()): ProfileState {
  let current = profile.abyss.run ? profile : move(profile, { kind: 'start' });
  if (current.abyss.run!.stage.kind === 'starterDraft') current = move(current, { kind: 'chooseStarter', index: 0 });
  current = move(current, { kind: 'chooseBoon', index: 0 });
  return move(current, { kind: 'beginBattle' });
}
function settle(profile: ProfileState, won = true): ProfileState {
  const stage = profile.abyss.run!.stage;
  if (stage.kind !== 'inBattle') throw new Error('not battle');
  return move(profile, { kind: 'settle', battleId: stage.battle.battleId, outcome: { kind: 'win', winner: won ? 'player' : 'enemy', reason: 'hpDepleted' } });
}

describe('深渊独立run状态机', () => {
  it('三套起始牌均6张、D～C+平均C，候选稳定且主库存不参与', () => {
    const base = fresh();
    const first = move(base, { kind: 'start' });
    const again = move(base, { kind: 'start' });
    expect(first.abyss).toEqual(again.abyss);
    const stage = first.abyss.run!.stage;
    if (stage.kind !== 'starterDraft') throw new Error('not draft');
    expect(first.abyss.run!.cards).toEqual([]);
    expect(stage.choices).toHaveLength(3);
    for (const choice of stage.choices) {
      expect(choice.cards).toHaveLength(6);
      expect(choice.cards.reduce((sum, card) => sum + RARITY_TO_LEVEL[card.definition.rarity], 0) / 6).toBe(5);
      expect(choice.cards.every(card => ['D', 'C', 'C+'].includes(card.definition.rarity))).toBe(true);
    }
    expect(new Set(stage.choices.flatMap(choice => choice.cards.map(card => card.instanceId))).size).toBe(18);
    expect(first.inventory).toBe(base.inventory);
    expect(first.currencies).toBe(base.currencies);
    expect(first.decks).toBe(base.decks);
    expect(first.ladder).toBe(base.ladder);
  });

  it('节奏3/6/9紫色高难，第10优先Boss；绑定正负一次选择，固定seed恢复', () => {
    expect(Array.from({ length: 10 }, (_, index) => abyssDifficulty(index + 1))).toEqual(['normal', 'normal', 'hard', 'normal', 'normal', 'hard', 'normal', 'normal', 'hard', 'nightmare']);
    const started = startBattle();
    const stage = started.abyss.run!.stage;
    if (stage.kind !== 'inBattle') throw new Error('not battle');
    expect(stage.battle.selectedBoon).toBe(0);
    expect(stage.battle.boonChoices).toHaveLength(3);
    const pair = stage.battle.boonChoices[0]!;
    expect(started.abyss.knownEffectIds).toEqual(expect.arrayContaining([pair.positive.id, pair.negative.id, stage.battle.enemyEffect.id]));
    expect(JSON.parse(JSON.stringify(started)).abyss.run.stage.battle).toEqual(stage.battle);
    const rejected = planAbyssAction(started, { kind: 'chooseBoon', index: 1, expectedToken: abyssStateToken(started) }, now);
    expect('rejected' in rejected).toBe(true);
  });

  it('普通完成给1免费并加15币，免费逐选后可付费，扣币/候选一体', () => {
    let current = settle(startBattle());
    expect(current.abyss.run!.coins).toBe(15);
    for (let remaining = 1; remaining > 0; remaining -= 1) {
      const run = current.abyss.run!;
      const stage = run.stage;
      if (stage.kind !== 'camp' || !stage.offer) throw new Error('not camp');
      expect(stage.freeRemaining).toBe(remaining);
      expect(stage.offer.options).toHaveLength(3);
      const option = stage.offer.options[0]!;
      const target = abyssGrowthTargets(run.cards, option)[0];
      current = move(current, { kind: 'chooseGrowth', offerId: stage.offer.id, index: 0, ...(target ? { targetId: target.instanceId } : {}) });
    }
    current = move(current, { kind: 'buy', purchase: 'training' });
    expect(current.abyss.run!.coins).toBe(10);
    const stage = current.abyss.run!.stage;
    if (stage.kind !== 'camp') throw new Error('not camp');
    expect(stage.offer?.source).toBe('trait');
    expect(stage.offer?.paidPrice).toBe(5);
    expect(JSON.parse(JSON.stringify(current)).abyss.run.stage.offer).toEqual(stage.offer);
    expect('rejected' in planAbyssAction(current, { kind: 'buy', purchase: 'training', expectedToken: abyssStateToken(current) }, now)).toBe(true);
    expect('rejected' in planAbyssAction(current, { kind: 'next', expectedToken: abyssStateToken(current) }, now)).toBe(true);
  });

  it('非Boss失败/平局按等级发奖励并扣心，第三次失败归档', () => {
    let current = startBattle();
    for (let loss = 1; loss <= 3; loss += 1) {
      const stage = current.abyss.run!.stage;
      if (stage.kind !== 'inBattle') throw new Error('not battle');
      current = move(current, { kind: 'settle', battleId: stage.battle.battleId, outcome: { kind: 'draw', reason: 'turnLimit' } });
      if (loss === 3) break;
      const camp = current.abyss.run!.stage;
      expect(camp.kind).toBe('camp');
      if (camp.kind === 'camp') expect(camp.freeRemaining).toBe(1);
      expect(current.abyss.run!.lives).toBe(3 - loss);
      expect(current.abyss.run!.coins).toBe(loss * 15);
      current = move(current, { kind: 'skipFree' });
      current = startBattle(move(current, { kind: 'next' }));
    }
    expect(current.abyss.run).toBeNull();
    expect(current.abyss.history[0]).toMatchObject({ reason: 'defeated', losses: 3, coins: 60, encounter: 3 });
  });

  it('Boss胜利营地后可进2-1，Boss失败3心也立即结束', () => {
    let current = startBattle();
    for (let encounter = 1; encounter <= 9; encounter += 1) {
      current = settle(current);
      current = move(current, { kind: 'skipFree' });
      current = startBattle(move(current, { kind: 'next' }));
    }
    expect(current.abyss.run!.encounter).toBe(10);
    const failed = settle(current, false);
    expect(failed.abyss.run).toBeNull();
    expect(failed.abyss.history[0]).toMatchObject({ reason: 'defeated', losses: 1, encounter: 10 });
    current = move(settle(current), { kind: 'skipFree' });
    current = move(current, { kind: 'next' });
    expect(current.abyss.run!.stage.kind).toBe('boonChoice');
    expect(planAbyssAction(current, { kind: 'finish', expectedToken: abyssStateToken(current) }, now)).toHaveProperty('rejected');
    expect(current.abyss.run).toMatchObject({ floor: 2, encounter: 1, lives: 3 });
  });

  it('持久token阻止旧回调/重复结算/混装主奖励，跨周不改变run', () => {
    const before = startBattle();
    const stage = before.abyss.run!.stage;
    if (stage.kind !== 'inBattle') throw new Error('not battle');
    const action: AbyssAction = { kind: 'settle', battleId: stage.battle.battleId, outcome: { kind: 'win', winner: 'player', reason: 'hpDepleted' }, expectedToken: abyssStateToken(before) };
    const plan = planAbyssAction(before, action, now);
    if ('rejected' in plan) throw new Error(plan.rejected);
    const after = applyEconomyTransaction(before, plan.transaction).profile;
    expect(applyEconomyTransaction(after, { ...plan.transaction, operationId: 'different' }).applied).toBe(false);
    expect(applyEconomyTransaction(before, { ...plan.transaction, currencyDelta: { gold: 1 } }).applied).toBe(false);
    expect(planAbyssAction(after, action, now)).toHaveProperty('rejected');
    const nextWeek = planAbyssAction(before, action, new Date('2026-10-12T20:00:00Z'));
    if ('rejected' in nextWeek) throw new Error(nextWeek.rejected);
    expect(nextWeek.view.run).toEqual(plan.view.run);
    expect(nextWeek.view.weeks).toHaveLength(2);
    expect(after.currencies).toBe(before.currencies);
    expect(after.settledBattleIds).toBe(before.settledBattleIds);
  });

  it('同模板独立实例，合法目标过滤上限、同族与最后一张，满组新卡需替换', () => {
    const run = startBattle().abyss.run!;
    const base = run.cards[0]!.baseDefinition;
    const first = makeAbyssCard(base, `${run.id}/starter/test/0`);
    const second = makeAbyssCard(base, `${run.id}/starter/test/1`);
    expect(first.definition).not.toBe(second.definition);
    expect(abyssGrowthTargets([first], { kind: 'remove', label: '' })).toEqual([]);
    const maxed = { ...first, definition: { ...first.definition, atk: 999, cd: 0 } };
    expect(abyssGrowthTargets([maxed], { kind: 'atk', label: '' })).toEqual([]);
    expect(abyssGrowthTargets([maxed], { kind: 'cd', label: '' })).toEqual([]);
    const full = Array.from({ length: 12 }, (_, index) => makeAbyssCard(base, `${run.id}/starter/test/${index}`));
    const fullRun: AbyssRun = { ...run, cards: full };
    const offer = makeAbyssGrowthOffer(fullRun, 'recruit', 1, cardDatabase.definitions);
    expect(offer.options).toHaveLength(3);
    expect(abyssGrowthTargets(full, offer.options[0]!)).toHaveLength(12);
  });

  it('新开始需确认，近10条完整快照保留，迟到旧run回调无效', () => {
    let current = startBattle();
    const oldToken = abyssStateToken(current);
    expect(planAbyssAction(current, { kind: 'start', expectedToken: oldToken }, now)).toHaveProperty('rejected');
    const oldCards = current.abyss.run!.cards;
    current = move(current, { kind: 'start', confirmAbandon: true });
    expect(current.abyss.history[0]!.cards).toEqual(oldCards);
    expect(current.abyss.history[0]!.cards).not.toBe(oldCards);
    for (let index = 0; index < 12; index += 1) current = move(current, { kind: 'start', confirmAbandon: true });
    expect(current.abyss.history).toHaveLength(10);
    expect(planAbyssAction(current, { kind: 'abandon', expectedToken: oldToken }, now)).toHaveProperty('rejected');
  });
});
