import { describe, expect, it } from 'vitest';
import { cardDatabase } from '../../src/data';
import { fixedClock } from '../../src/domain/progression/clock';
import { abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import { validateAbyssState } from '../../src/domain/progression/abyssValidation';
import type { AbyssAction } from '../../src/domain/progression/abyssTypes';
import type { ProfileState } from '../../src/domain/progression/types';
import { ProfileStore } from '../../src/state/createProfileStore';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import type { SaveRepository } from '../../src/services/save/SaveRepository';

const now = new Date('2026-10-11T20:00:00Z');
function makeStore(repository: SaveRepository) {
  return new ProfileStore({ repository, clock: fixedClock(now), seedSource: () => 81, contentVersion: cardDatabase.contentVersion, starterCardIds: [] });
}
function profile(store: ProfileStore) { return store.getSnapshot().profile!; }
function action(store: ProfileStore, body: Omit<AbyssAction, 'expectedToken'>) {
  const request = { ...body, expectedToken: abyssStateToken(profile(store)) } as AbyssAction;
  return store.commitEconomic(current => planAbyssAction(current, request, now));
}

it('深渊事务写盘失败不展示新run，重试成功后可从同一候选恢复', async () => {
  const inner = new MemorySaveRepository();
  let fail = true;
  const repository: SaveRepository = { kind: 'memory', load: () => inner.load(), clear: () => inner.clear(), close: () => inner.close(), commit: async value => {
    if (fail) throw new Error('模拟写盘失败');
    await inner.commit(value);
  } };
  const store = makeStore(repository); await store.load();
  const original = profile(store);
  expect((await action(store, { kind: 'start' })).ok).toBe(false);
  expect(profile(store)).toBe(original); expect(profile(store).abyss.run).toBeNull();
  fail = false;
  expect((await action(store, { kind: 'start' })).ok).toBe(true);
  const saved = structuredClone(profile(store).abyss);
  const reloaded = makeStore(repository); await reloaded.load();
  expect(reloaded.getSnapshot().status).toBe('ready');
  expect(profile(reloaded).abyss).toEqual(saved);
});

it('并发点击与旧token均不能重复开始或覆盖新的选择', async () => {
  const repository = new MemorySaveRepository();
  const store = makeStore(repository); await store.load();
  const token = abyssStateToken(profile(store));
  const request = { kind: 'start' as const, expectedToken: token };
  const results = await Promise.all([1, 2].map(() => store.commitEconomic(current => planAbyssAction(current, request, now))));
  expect(results.filter(result => result.ok)).toHaveLength(1);
  expect(repository.commitCount).toBe(1);
  const saved = profile(store);
  expect((await store.commitEconomic(current => planAbyssAction(current, { ...request, operationId: 'different' }, now))).ok).toBe(false);
  expect(profile(store)).toBe(saved);
});

describe('深渊自动加载校验', () => {
  it('新版坏进度拒绝读取，不把候选重置成新run', async () => {
    const repository = new MemorySaveRepository();
    const store = makeStore(repository); await store.load(); await action(store, { kind: 'start' });
    const malformed = structuredClone(profile(store));
    const bad = { ...malformed, abyss: { ...malformed.abyss, run: { ...malformed.abyss.run, lives: -1 } } } as unknown as ProfileState;
    await repository.commit(bad);
    const reloaded = makeStore(repository); await reloaded.load();
    expect(reloaded.getSnapshot().status).toBe('error');
    expect(reloaded.getSnapshot().error).toContain('深渊');
    expect(await repository.load()).toEqual(bad);
  });
  it('卡库版本更新后，在途 run 按「放弃挑战」归档，照常进游戏', async () => {
    const repository = new MemorySaveRepository();
    const store = makeStore(repository); await store.load();
    expect((await action(store, { kind: 'start' })).ok).toBe(true);
    const started = profile(store).abyss;
    const run = started.run!;
    // 加卡会改 contentVersion：等于「存档写在旧卡库下，现在拿新卡库读」
    const reloaded = new ProfileStore({ repository, clock: fixedClock(now), seedSource: () => 81,
      contentVersion: 'next-library', starterCardIds: [] });
    await reloaded.load();
    const snapshot = reloaded.getSnapshot();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.abyssNotice).toContain('深渊');
    const state = profile(reloaded).abyss;
    expect(state.run).toBeNull();
    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toMatchObject({ runId: run.id, reason: 'abandoned', floor: 1, encounter: 1 });
    // 归档出来的必须还是合法存档，否则下一版又会把它判成坏进度
    expect(validateAbyssState(state, 'next-library')).toBe(true);
    // 播报读一次就清，不会重复弹
    expect(reloaded.takeAbyssNotice()).toBe(snapshot.abyssNotice);
    expect(reloaded.getSnapshot().abyssNotice).toBeNull();
    expect(reloaded.takeAbyssNotice()).toBeNull();
  });
  it('版本不兼容但本身已经坏掉的 run，不借着降级混进来', async () => {
    const repository = new MemorySaveRepository();
    const store = makeStore(repository); await store.load(); await action(store, { kind: 'start' });
    const broken = structuredClone(profile(store)) as unknown as ProfileState;
    const run = { ...broken.abyss.run!, lives: -1, losses: 4 };
    await repository.commit({ ...broken, abyss: { ...broken.abyss, run } });
    const reloaded = new ProfileStore({ repository, clock: fixedClock(now), seedSource: () => 81,
      contentVersion: 'next-library', starterCardIds: [] });
    await reloaded.load();
    expect(reloaded.getSnapshot().status).toBe('error');
  });
  it('周切不清候选，主货币/库存/天梯/迷宫保持不变', async () => {
    const repository = new MemorySaveRepository();
    const store = makeStore(repository); await store.load();
    const before = structuredClone(profile(store));
    await action(store, { kind: 'start' });
    const reloaded = new ProfileStore({ repository, clock: fixedClock(new Date('2026-10-19T01:00:00Z')), seedSource: () => 99,
      contentVersion: cardDatabase.contentVersion, starterCardIds: [] });
    await reloaded.load();
    expect(profile(reloaded).abyss).toEqual(profile(store).abyss);
    for (const key of ['inventory', 'decks', 'ladder', 'mazeRun', 'mazeProgress'] as const) expect(profile(reloaded)[key]).toEqual(before[key]);
  });
});
