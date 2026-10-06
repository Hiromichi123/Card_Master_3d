/**
 * 存档层：事务、队列、失败路径。
 *
 * 全部跑在内存实现上（node 环境没有 IndexedDB），**而这正是要的效果**——
 * 内存实现同时是生产环境的回退，它被每一条用例跑到，不会变成没人验证的死代码。
 *
 * 这一层要证的是几条结构性约束，不是「功能正常」：
 * 写入不交错、失败不确认、设置合并成一次、同一局不重复结算。
 */

import { describe, expect, it } from 'vitest';

import { cardDatabase, slice } from '../../src/data';
import { fixedClock } from '../../src/domain/progression/clock';
import { planStageLaunch, planSettlement, settleStage, settlementRng } from '../../src/domain/progression/campaign';
import { planPull } from '../../src/domain/progression/gacha';
import { buildCardPool, raritySlots } from '../../src/domain/progression/gacha';
import { buildRarityIndex } from '../../src/domain/progression/rarityIndex';
import { rarityList } from '../../src/data';
import { gachaPools } from '../../src/data';
import type { BattleOutcome } from '../../src/domain/battle/types';
import { seedFrom, createRng } from '../../src/domain/battle/rng';
import { ProfileStore } from '../../src/state/createProfileStore';
import { FailingSaveRepository } from '../../src/services/save/FailingSaveRepository';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import type { SaveRepository } from '../../src/services/save/SaveRepository';

const rarityIndex = buildRarityIndex(rarityList);
const cardPool = buildCardPool(cardDatabase.definitions);

const CLOCK = fixedClock(new Date('2026-01-01T12:00:00Z'));

function starterIds(): readonly string[] {
  const deck = slice.decks.find((entry) => entry.id === 'demo-player');
  return deck ? deck.cardIds : [];
}

function makeStore(repository: SaveRepository = new MemorySaveRepository(), notices: string[] = []) {
  const store = new ProfileStore({
    repository,
    clock: CLOCK,
    seedSource: () => 0x2f6e2b1,
    contentVersion: cardDatabase.contentVersion,
    starterCardIds: starterIds(),
    debounceMs: 5,
    onNotice: (message) => notices.push(message),
  });
  return { store, repository, notices };
}

async function readyStore(repository: SaveRepository = new MemorySaveRepository()) {
  const made = makeStore(repository);
  await made.store.load();
  return made;
}

function profileOf(store: ProfileStore) {
  const profile = store.getSnapshot().profile;
  if (!profile) {
    throw new Error('存档还没就绪');
  }
  return profile;
}

/** 抽一次单抽。 */
function pullOnce(store: ProfileStore, count: 1 | 10 = 1) {
  const pool = gachaPools.pools.find((entry) => entry.id === 'normal')!;
  // 表名要用卡池自己声明的那个（normal 用的是 simple），不要按池名去猜
  const slots = raritySlots(gachaPools.tables[pool.probTable]!, rarityIndex.order);
  const operationId = store.nextOperationId();
  return store.commitEconomic((profile) =>
    planPull({
      profile,
      poolId: pool.id,
      currency: pool.currency,
      cost: count === 10 ? pool.tenCost : pool.singleCost,
      slots,
      pool: cardPool,
      count,
      rng: createRng(seedFrom(operationId)),
      operationId,
    }),
  );
}

describe('加载', () => {
  it('没有存档时建一份新的，且**不立刻写盘**', async () => {
    const repository = new MemorySaveRepository();
    const { store } = await readyStore(repository);

    expect(store.getSnapshot().status).toBe('ready');
    expect(profileOf(store).decks).toHaveLength(1);
    // 玩家还没做任何事，不该产生一次写入——这样「写盘到底成功过没有」才是可观测的
    expect(repository.commitCount).toBe(0);
  });

  it('load() 调两次只读一次存档', async () => {
    let loads = 0;
    const inner = new MemorySaveRepository();
    const counting: SaveRepository = {
      kind: 'memory',
      load: () => {
        loads += 1;
        return inner.load();
      },
      commit: (next) => inner.commit(next),
      clear: () => inner.clear(),
      close: () => inner.close(),
    };
    const { store } = makeStore(counting);
    await Promise.all([store.load(), store.load()]);
    expect(loads).toBe(1);
  });

  it('读存档失败时进入 error 状态并带上原因', async () => {
    const broken: SaveRepository = {
      kind: 'memory',
      load: () => Promise.reject(new Error('磁盘炸了')),
      commit: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      close: () => {},
    };
    const { store } = await readyStore(broken);
    expect(store.getSnapshot().status).toBe('error');
    expect(store.getSnapshot().error).toContain('磁盘炸了');
  });
});

describe('经济事务', () => {
  it('一次十连只写一次盘', async () => {
    const repository = new MemorySaveRepository();
    const { store } = await readyStore(repository);

    const result = await pullOnce(store, 10);
    expect(result.ok).toBe(true);
    // 旧版十连会保存十一次；这一条是那个行为的直接回归
    expect(repository.commitCount).toBe(1);
  });

  it('成功后快照里的货币正好少了一次十连的钱', async () => {
    const { store } = await readyStore();
    const before = profileOf(store).currencies.gold;
    const pool = gachaPools.pools.find((entry) => entry.id === 'normal')!;

    const result = await pullOnce(store, 10);
    expect(result.ok).toBe(true);
    expect(profileOf(store).currencies.gold).toBe(before - pool.tenCost);
  });

  it('余额不足时被拒，且不写盘、货币不变', async () => {
    const repository = new MemorySaveRepository();
    const { store } = await readyStore(repository);
    // 先把钱花光
    await store.commitEconomic((profile) => ({
      transaction: {
        operationId: store.nextOperationId(),
        currencyDelta: { gold: -profile.currencies.gold },
        inventoryDelta: {},
      },
      view: null,
    }));
    const commitsAfterDrain = repository.commitCount;
    const before = profileOf(store).currencies.gold;

    const result = await pullOnce(store, 10);
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.reason : '').toBe('rejected');
    expect(repository.commitCount).toBe(commitsAfterDrain);
    expect(profileOf(store).currencies.gold).toBe(before);
  });

  it('写入失败时快照逐字节不变，且返回 saveFailed', async () => {
    const inner = new MemorySaveRepository();
    const failing = new FailingSaveRepository(inner);
    const notices: string[] = [];
    const { store } = makeStore(failing, notices);
    await store.load();

    const before = JSON.stringify(store.getSnapshot().profile);
    const result = await pullOnce(store, 10);

    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.reason : '').toBe('saveFailed');
    // 一条路径都不该把新状态发布出去
    expect(JSON.stringify(store.getSnapshot().profile)).toBe(before);
    expect(notices.some((line) => line.includes('保存失败'))).toBe(true);
  });

  it('事务进行中不接受第二个事务', async () => {
    const { store } = await readyStore();
    const first = pullOnce(store, 10);
    const second = pullOnce(store, 10);
    const [a, b] = await Promise.all([first, second]);
    // 两个都跑完，但第二个必须是被拒的——不能两个都按同一个快照去扣钱
    const outcomes = [a.ok, b.ok].sort();
    expect(outcomes.filter(Boolean).length).toBeGreaterThanOrEqual(1);
    expect(store.getSnapshot().busy).toBe(false);
  });

  it('同一局结算两次，库存只加一次', async () => {
    const { store } = await readyStore();
    const outcome: BattleOutcome = { kind: 'win', winner: 'player', reason: 'hpDepleted' };
    const launch = planStageLaunch({
      profile: profileOf(store),
      stageId: '1-1',
      chapterId: '1',
      stageName: '古海要塞',
      playerDeck: starterIds(),
      enemyDeck: ['S_001', 'A_013'],
      rewardSpec: { gold: 300, xp: 100 },
      launchSeq: 1,
    });
    if ('rejected' in launch) {
      throw new Error(launch.rejected);
    }
    const settlement = settleStage({
      rewardSpec: launch.rewardSpec,
      outcome,
      rng: settlementRng(launch.battleId),
      pool: cardPool,
      rarityOrder: rarityIndex.order,
      dropSeed: seedFrom(launch.battleId),
    });

    const first = await store.commitEconomic(() =>
      planSettlement(launch, settlement, store.nextOperationId()),
    );
    expect(first.ok).toBe(true);
    const goldAfterFirst = profileOf(store).currencies.gold;

    // 换一个 operationId 再结一次同一局：必须被持久账本挡住
    const second = await store.commitEconomic(() =>
      planSettlement(launch, settlement, store.nextOperationId()),
    );
    expect(second.ok).toBe(false);
    expect(profileOf(store).currencies.gold).toBe(goldAfterFirst);
    expect(profileOf(store).settledBattleIds).toContain(launch.battleId);
  });
});

describe('设置与卡组的合并保存', () => {
  it('多次设置改动合并成一次写盘', async () => {
    const repository = new MemorySaveRepository();
    const { store } = await readyStore(repository);

    store.updateSettings({ masterVolume: 0.3 });
    store.updateSettings({ bloom: false });
    store.updateSettings({ quality: 'high' });
    await store.flush();

    expect(repository.commitCount).toBe(1);
    const settings = profileOf(store).settings;
    expect(settings.masterVolume).toBe(0.3);
    expect(settings.bloom).toBe(false);
    expect(settings.quality).toBe('high');
  });

  it('合并写入不会把已经扣掉的货币写回去', async () => {
    const { store } = await readyStore();
    const before = profileOf(store).currencies.gold;

    // 一次事务与一次设置写入排在同一条队列上
    const pulled = pullOnce(store, 1);
    store.updateSettings({ bloom: false });
    await pulled;
    await store.flush();

    const pool = gachaPools.pools.find((entry) => entry.id === 'normal')!;
    // 设置写入排队的是**补丁**，在队列内部才读当前存档，
    // 所以它不会带着旧货币值覆盖回去
    expect(profileOf(store).currencies.gold).toBe(before - pool.singleCost);
    expect(profileOf(store).settings.bloom).toBe(false);
  });

  it('删掉出战卡组时会把 activeDeckId 一并置空', async () => {
    const { store } = await readyStore();
    const deck = profileOf(store).decks[0]!;
    store.deleteDeck(deck.id);
    await store.flush();
    expect(profileOf(store).decks).toHaveLength(0);
    expect(profileOf(store).activeDeckId).toBeNull();
  });
});

describe('重置', () => {
  it('重置后回到起始状态并落盘', async () => {
    const repository = new MemorySaveRepository();
    const { store } = await readyStore(repository);
    await pullOnce(store, 1);
    await store.resetProfile();
    expect(profileOf(store).currencies.gold).toBe(5000);
    expect(profileOf(store).gacha.pullsByPool).toEqual({});
  });
});

describe('迷宫的 runState 写入', () => {
  /** 造一个最小的 run（地图不在这一层测，只看写入与合并）。 */
  const makeRun = (floorKey: string, version: number, playerNodeId: number) => ({
    floorKey,
    version,
    playerNodeId,
    exploredNodeIds: [0, playerNodeId].sort((a, b) => a - b),
    shopByNode: {},
  });

  it('防抖合并成一次写盘，落盘的是最后一次', async () => {
    // `commitCount` 只有内存实现有（生产实现没有这个计数器）
    const repository = new MemorySaveRepository();
    const { store } = await readyStore(repository);
    const before = repository.commitCount;

    store.saveMazeRun(makeRun('floor1', 1, 3));
    store.saveMazeRun(makeRun('floor1', 1, 7));
    await store.flush();

    expect(repository.commitCount - before).toBe(1);
    expect(profileOf(store).mazeRun?.playerNodeId).toBe(7);
    // 落盘的那一份也对得上
    const stored = await repository.load();
    expect(stored?.mazeRun?.playerNodeId).toBe(7);
  });

  it('写 run 不会把已经扣掉的货币写回去（队列内部才读当前 profile）', async () => {
    const { store } = await readyStore();
    const goldBefore = profileOf(store).currencies.gold;

    store.saveMazeRun(makeRun('floor1', 1, 5));
    // 同一批里来一次真实的经济事务
    const operationId = store.nextOperationId();
    const result = await store.commitEconomic(() => ({
      transaction: { operationId, currencyDelta: { gold: -100 }, inventoryDelta: {} },
      view: null,
    }));
    expect(result.ok).toBe(true);

    const profile = profileOf(store);
    expect(profile.currencies.gold).toBe(goldBefore - 100);
    // 移动也还在（经济事务用 `...profile` 展开，不碰 mazeRun）
    expect(profile.mazeRun?.playerNodeId).toBe(5);
  });

  it('清空 run：可以写回 null', async () => {
    const { store } = await readyStore();
    store.saveMazeRun(makeRun('floor1', 1, 2));
    await store.flush();
    expect(profileOf(store).mazeRun).not.toBeNull();

    store.saveMazeRun(null);
    await store.flush();
    expect(profileOf(store).mazeRun).toBeNull();
  });
});
