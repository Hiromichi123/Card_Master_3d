import { describe, expect, it } from 'vitest';
import { cardDatabase } from '../../src/data';
import type { CardDefinition, CardRarity } from '../../src/domain/cards/types';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { LADDER_TIERS } from '../../src/domain/progression/ladder';
import { LADDER_REWARDS, planLadderRewardClaim } from '../../src/domain/progression/ladderRewards';
import type { Planned } from '../../src/domain/progression/plan';
import { createInitialProfile, withActiveDeck, withDeck, withoutDeck } from '../../src/domain/progression/profile';
import type { ProfileState } from '../../src/domain/progression/types';
import { ProfileStore } from '../../src/state/createProfileStore';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import type { SaveRepository } from '../../src/services/save/SaveRepository';

const now = new Date('2026-10-11T12:00:00Z');
const fresh = (points = 0): ProfileState => {
  const profile = createInitialProfile({ contentVersion: 'test', dayKey: '20261011', starterCardIds: [], now });
  return { ...profile, ladder: { ...profile.ladder, points } };
};
const card = (cardId: string, rarity: CardRarity = 'B', status: CardDefinition['status'] = 'complete'): CardDefinition => ({
  ...cardDatabase.definitions[0]!, cardId, rarity, status,
});
function accepted<T>(plan: Planned<T>) {
  if ('rejected' in plan) throw new Error(plan.rejected);
  return plan;
}
function claim(profile: ProfileState, floor = 0, operationId = 'claim', definitions: readonly CardDefinition[] = cardDatabase.definitions) {
  return planLadderRewardClaim({ profile, floor, operationId, definitions });
}
async function storeFor(repository: SaveRepository) {
  const store = new ProfileStore({ repository, clock: () => now, seedSource: () => 7,
    contentVersion: 'test', starterCardIds: [], debounceMs: 100000 });
  await store.load();
  return store;
}

describe('天梯一次性段位奖励', () => {
  it('九档与段位门槛一致，精确稀有度和奖励数量不由界面决定', () => {
    expect(LADDER_REWARDS.map(reward => reward.floor)).toEqual(LADDER_TIERS.map(tier => tier.floor));
    expect(LADDER_REWARDS.map(({ crystals, rarity, count }) => [crystals, rarity, count])).toEqual([
      [100, 'B', 3], [200, 'B+', 3], [350, 'A', 3], [500, 'A+', 3], [800, 'S', 3],
      [1200, 'S+', 3], [1800, 'SS', 3], [2400, 'SS+', 3], [3000, 'SSS', 5],
    ]);
    for (const reward of LADDER_REWARDS) {
      const planned = accepted(claim(fresh(reward.floor), reward.floor));
      expect(planned.view.crystals).toBe(reward.crystals);
      expect(planned.view.cards.reduce((sum, result) => sum + result.count, 0)).toBe(reward.count);
      expect(planned.view.cards.every(result => cardDatabase.definitions.some(definition =>
        definition.cardId === result.cardId && definition.status === 'complete' && definition.rarity === reward.rarity))).toBe(true);
      if (reward.floor > 0) expect(claim(fresh(reward.floor - 1), reward.floor)).toHaveProperty('rejected');
      expect(claim(fresh(reward.floor + 1), reward.floor)).not.toHaveProperty('rejected');
    }
    expect(claim(fresh(), 123)).toHaveProperty('rejected');
  });

  it('0分可手动领，多个高分档独立领取；不同operationId、降分再升分不重领', () => {
    const initial = fresh(2400);
    const first = accepted(claim(initial));
    const outcome = applyEconomyTransaction(initial, first.transaction);
    expect(outcome.applied).toBe(true);
    expect(outcome.profile.currencies.crystal).toBe(initial.currencies.crystal + 100);
    expect(outcome.profile.ladder.claimedTierFloors).toEqual([0]);
    expect(outcome.profile.ladder.points).toBe(2400);
    expect(outcome.profile.decks).toBe(initial.decks);
    expect(applyEconomyTransaction(outcome.profile, { ...first.transaction, operationId: 'new-op' }).reason).toBe('alreadyClaimed');
    const world = accepted(claim(outcome.profile, 2400, 'world'));
    const all = applyEconomyTransaction(outcome.profile, world.transaction).profile;
    expect(all.ladder.claimedTierFloors).toEqual([0, 2400]);
    const fallen = { ...all, ladder: { ...all.ladder, points: 100 } };
    expect(claim(fallen, 2400)).toHaveProperty('rejected');
    expect(claim({ ...fallen, ladder: { ...fallen.ladder, points: 2500 } }, 2400)).toHaveProperty('rejected');
    expect(claim(all, 300)).not.toHaveProperty('rejected');
  });

  it('抽取有放回、按ID去重排序，未知稀有度或不完整卡不进池', () => {
    const p = { ...fresh(), inventory: { only: 2 } };
    const definitions = [card('only'), card('only'), card('other', 'SSS'), card('draft', 'B', 'incomplete')];
    const planned = accepted(claim(p, 0, 'one', definitions));
    expect(planned.view.cards).toEqual([{ cardId: 'only', count: 3 }]);
    expect(applyEconomyTransaction(p, planned.transaction).profile.inventory.only).toBe(5);
    const pool = [card('z'), card('a'), card('k'), card('z')];
    expect(accepted(claim(p, 0, 'first', pool)).view).toEqual(accepted(claim(p, 0, 'retry', [...pool].reverse())).view);
    expect(accepted(claim(p, 0, 'deduped', [card('a'), card('k'), card('z')])).view)
      .toEqual(accepted(claim(p, 0, 'first', pool)).view);
  });

  it('空指定池整笔拒绝，不消耗水晶/库存/资格', () => {
    const p = fresh();
    const before = JSON.stringify(p);
    expect(claim(p, 0, 'empty', [])).toHaveProperty('rejected');
    expect(claim(p, 0, 'wrong-rarity', [card('wrong', 'B+')])).toHaveProperty('rejected');
    expect(JSON.stringify(p)).toBe(before);
  });

  it('旧事务在apply层重验门槛、档位、槽归属与完整发放数量', () => {
    const p = fresh(300);
    const tx = accepted(claim(p, 300)).transaction;
    const below = fresh(299);
    const denied = applyEconomyTransaction(below, tx);
    expect(denied.reason).toBe('rewardUnavailable');
    expect(denied.profile).toBe(below);
    for (const patch of [
      { ladderRewardClaim: { floor: 301, deckId: p.ladder.deckId } },
      { ladderRewardClaim: { floor: 300, deckId: 'other-slot' } },
      { currencyDelta: { crystal: 1 } },
      { inventoryDelta: {} },
      { inventoryDelta: { fake: -3 } },
    ]) expect(applyEconomyTransaction(p, { ...tx, ...patch }).profile).toBe(p);
  });

  it('切普通卡组、编辑天梯和删除固定槽均不改变抽取种子', () => {
    const p = fresh();
    const first = accepted(claim(p));
    const switched = withActiveDeck(p, p.normalDeckIds[1]);
    const edited = withDeck(switched, { ...switched.decks.find(deck => deck.id === p.ladder.deckId)!, cardIds: ['new-card'] });
    const removed = withoutDeck(edited, p.ladder.deckId);
    expect(removed).toBe(edited);
    expect(removed.ladder.deckId).toBe(p.ladder.deckId);
    expect(accepted(claim(removed, 0, 'after-edit')).view).toEqual(first.view);
  });
});

describe('天梯领取存档事务', () => {
  it('写失败不发布部分资源或领取标记，重试卡相同，一次成功整档保存', async () => {
    const initial = fresh();
    const inner = new MemorySaveRepository(initial);
    let fail = true;
    const attempted: ProfileState[] = [];
    const repository: SaveRepository = {
      kind: 'memory', load: () => inner.load(), clear: () => inner.clear(), close: () => {},
      commit: async profile => { attempted.push(profile); if (fail) throw new Error('disk full'); await inner.commit(profile); },
    };
    const store = await storeFor(repository);
    const before = store.getSnapshot().profile!;
    expect((await store.commitEconomic(p => claim(p))).ok).toBe(false);
    expect(store.getSnapshot().profile).toBe(before);
    expect(store.lastResult).toBeNull();
    expect(inner.peek()).toBe(initial);
    fail = false;
    const result = await store.commitEconomic(p => claim(p, 0, 'retry'));
    expect(result.ok).toBe(true);
    expect(attempted[1]!.inventory).toEqual(attempted[0]!.inventory);
    expect(inner.commitCount).toBe(1);
    expect(inner.peek()!.ladder.claimedTierFloors).toEqual([0]);
    expect(inner.peek()!.currencies.crystal).toBe(initial.currencies.crystal + 100);
    store.dispose();
    const reopened = await storeFor(inner);
    expect((await reopened.commitEconomic(p => claim(p, 0, 'new-session'))).ok).toBe(false);
    expect(inner.commitCount).toBe(1);
    reopened.dispose();
  });

  it('同一旧快照的并发请求与保存后旧计划重放都只会落盘一次', async () => {
    const inner = new MemorySaveRepository(fresh());
    let release!: () => void;
    let started!: () => void;
    const begun = new Promise<void>(resolve => { started = resolve; });
    const repository: SaveRepository = {
      kind: 'memory', load: () => inner.load(), clear: () => inner.clear(), close: () => {},
      commit: async p => { started(); await new Promise<void>(resolve => { release = resolve; }); await inner.commit(p); },
    };
    const store = await storeFor(repository);
    const stale = accepted(claim(store.getSnapshot().profile!));
    const saving = store.commitEconomic(() => stale);
    await begun;
    expect((await store.commitEconomic(() => ({ ...stale, transaction: { ...stale.transaction, operationId: 'parallel' } }))).ok).toBe(false);
    release();
    expect((await saving).ok).toBe(true);
    expect((await store.commitEconomic(() => ({ ...stale, transaction: { ...stale.transaction, operationId: 'stale' } }))).ok).toBe(false);
    expect(inner.commitCount).toBe(1);
    store.dispose();
  });

  it('卡组防抖保存先完成，领奖使用队列内最新profile而不覆盖卡组修改', async () => {
    const inner = new MemorySaveRepository(fresh());
    const store = await storeFor(inner);
    const id = store.getSnapshot().profile!.ladder.deckId;
    store.saveDeck({ ...store.getDeckDraft(id)!, name: '刚修改的天梯配置' });
    let latestName = '';
    expect((await store.commitEconomic(p => {
      latestName = p.decks.find(deck => deck.id === id)!.name;
      return claim(p);
    })).ok).toBe(true);
    expect(latestName).toBe('刚修改的天梯配置');
    expect(inner.peek()!.decks.find(deck => deck.id === id)!.name).toBe(latestName);
    expect(inner.peek()!.ladder.claimedTierFloors).toEqual([0]);
    store.dispose();
  });
});
