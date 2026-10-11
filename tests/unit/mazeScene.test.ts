// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MazeScene } from '../../src/scenes/MazeScene';
import { mazeEventCards, mazeShopStock } from '../../src/scenes/mazeFlow';
import { generateMaze, mazeRngFor, newMazeRun, withShopState, mazeBossBattleId } from '../../src/domain/progression/maze';
import { fixedClock } from '../../src/domain/progression/clock';
import type { ProfileState } from '../../src/domain/progression/types';
import { ProfileStore } from '../../src/state/createProfileStore';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';

vi.mock('../../src/ui/DesignStage', () => ({
  DesignStage: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));
vi.mock('../../src/ui/PlayerStatus', () => ({ PlayerStatus: () => null }));

const map = generateMaze(mazeRngFor('floor1', 1));
const supply = map.nodes.find(node => node.type === 'supply')!;
let host: HTMLDivElement, root: Root, store: ProfileStore;
let frames: Map<number, FrameRequestCallback>, frameId: number;
const launch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frames = new Map(); frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback); return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  launch.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  store?.dispose(); host.remove(); vi.unstubAllGlobals();
});

async function setup(nodeId = 0, cleared = false, explorationCount = 0, failEnter = false): Promise<MemorySaveRepository> {
  store = new ProfileStore({
    repository: new MemorySaveRepository(), clock: fixedClock(new Date('2026-10-11T12:00:00Z')),
    seedSource: () => 123, contentVersion: 'test', starterCardIds: ['test-card'], debounceMs: 0,
  });
  await store.load();
  const base = store.getSnapshot().profile!;
  const initial = { ...newMazeRun(map, 'floor1', 1), playerNodeId: nodeId, exploredNodeIds: [...new Set([0, nodeId])] };
  const run = map.nodes[nodeId]!.type === 'supply' ? withShopState(initial, nodeId) : initial;
  const profile: ProfileState = {
    ...base, mazeRun: run, mazeProgress: { ...base.mazeProgress, explorationCount },
    currencies: { gold: 1000000, crystal: 1000000, badge: 1000000 },
    settledBattleIds: cleared ? [mazeBossBattleId('floor1', 1)] : [],
  };
  store.dispose();
  const repository = new MemorySaveRepository(profile);
  store = new ProfileStore({
    repository, clock: fixedClock(new Date('2026-10-11T12:00:00Z')),
    seedSource: () => 123, contentVersion: 'test', starterCardIds: ['test-card'], debounceMs: 0,
  });
  await store.load();
  if (failEnter) vi.spyOn(repository, 'commit').mockRejectedValueOnce(new Error('磁盘不可写'));
  await render();
  return repository;
}
async function render(): Promise<void> {
  await act(async () => root.render(createElement(MazeScene, {
    profile: store.getSnapshot().profile!, store, onNavigate: vi.fn(), onLaunch: launch,
  })));
}
function button(selector: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(selector);
  if (!found) throw new Error(`找不到 ${selector}`);
  return found;
}
async function click(selector: string): Promise<void> {
  await act(async () => button(selector).click());
}
async function arrive(): Promise<void> {
  await act(async () => {
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(callback => callback(performance.now() + 1000));
  });
}
function expectClosed(): void {
  expect(button('.maze__sidebar-toggle').getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.maze__detail')).toBeNull();
  expect(host.querySelector<HTMLElement>('#maze-sidebar')!.hidden).toBe(true);
}

describe('世界树迷宫场景', () => {
  it('左栏依次放玩家、图例和活动卡；0–100保底条独立常驻', async () => {
    await setup();
    const rail = host.querySelector('.maze__left-rail')!;
    expect([...rail.children].map(child => child.className)).toEqual(['maze__status', 'maze__legend', 'maze__showcase']);
    expect(rail.querySelector('.maze__showcase h2')!.textContent).toBe('当期活动卡牌');
    const bar = host.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.closest('#maze-sidebar')).toBeNull();
    expectClosed();
    await click('.maze__sidebar-toggle'); await click('.maze__sidebar-toggle');
    expect(host.querySelector('[role="progressbar"]')).toBe(bar);
    expect(button('.maze__reset').textContent).toContain('1/1');
  });

  it('首探+1、往返不计，清空保留累计且本周不能再次清空', async () => {
    const neighbor = supply.neighbors[0]!;
    await setup(neighbor, false, 17);
    const target = `.maze__tile[data-node-id="${supply.id}"]`;
    const back = `.maze__tile[data-node-id="${neighbor}"]`;
    await click(target); await click(target); await arrive();
    expect(host.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('18');
    await click(back); await click(back); await arrive();
    await click(target); await click(target); await arrive();
    expect(store.getSnapshot().profile!.mazeProgress.explorationCount).toBe(18);
    await click('.maze__reset');
    expect(button('.maze__reset').textContent).toContain('0/1');
    expect(button('.maze__reset').disabled).toBe(true);
    expect(store.getSnapshot().profile!.mazeProgress.explorationCount).toBe(18);
    expect(store.getSnapshot().profile!.mazeRun!.version).toBe(2);
    await click('.maze__reset');
    expect(store.getSnapshot().profile!.mazeRun!.version).toBe(2);
    await act(async () => root.unmount()); root = createRoot(host);
    await render();
    expect(button('.maze__reset').disabled).toBe(true);
    expect(host.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('18');
  });

  it('99次后首探自动发活动卡，归零且不展开提示栏', async () => {
    const repository = await setup(supply.neighbors[0]!, false, 99);
    const inventory = { ...store.getSnapshot().profile!.inventory };
    const target = `.maze__tile[data-node-id="${supply.id}"]`;
    await click(target); await click(target); await arrive();
    const after = store.getSnapshot().profile!;
    const cardId = after.mazeProgress.lastRewardCardId!;
    expect(mazeEventCards()).toContain(cardId);
    expect(after.inventory[cardId]).toBe((inventory[cardId] ?? 0) + 1);
    expect(after.mazeProgress.awardedCount).toBe(1);
    expect(repository.peek()!.mazeProgress).toEqual(after.mazeProgress);
    expect(host.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('0');
    expect(host.querySelector('.maze__pity-reward')).not.toBeNull();
    expectClosed();
  });

  it('移动保存失败镜头回位、不计数不启动战斗，重开失败不消耗次数', async () => {
    const repository = await setup(0, false, 99);
    const before = store.getSnapshot().profile!;
    const camera = (host.querySelector('.maze__plane') as HTMLElement).style.transform;
    vi.spyOn(repository, 'commit').mockRejectedValueOnce(new Error('磁盘不可写'));
    const target = `.maze__tile[data-node-id="${map.nodes[0]!.neighbors[0]}"]`;
    await click(target); await click(target); await arrive();
    expect(store.getSnapshot().profile).toBe(before);
    expect((host.querySelector('.maze__plane') as HTMLElement).style.transform).toBe(camera);
    expect(button('.maze__tile[data-current="true"]').dataset.nodeId).toBe('0');
    expect(launch).not.toHaveBeenCalled();
    vi.mocked(repository.commit).mockRejectedValueOnce(new Error('磁盘不可写'));
    await click('.maze__reset');
    expect(store.getSnapshot().profile).toBe(before);
    expect(button('.maze__reset').textContent).toContain('1/1');
    expect(button('.maze__reset').disabled).toBe(false);
  });

  it('初始化保存失败可以重试或退出，未就绪时禁止走格', async () => {
    await setup(0, false, 0, true);
    expect(button('.maze__tile').disabled).toBe(true);
    expect(button('.maze__back').disabled).toBe(false);
    await click('.maze__retry');
    expect(host.querySelector('.maze__retry')).toBeNull();
    expect(button('.maze__tile').disabled).toBe(false);
    expectClosed();
  });

  it('五类地块带图标，入口有探索勾；默认整栏收起且选格不会展开', async () => {
    await setup();
    expect(host.querySelector('h1')!.textContent).toBe('世界树迷宫·第一层');
    for (const type of ['entry', 'normal', 'elite', 'boss', 'supply']) {
      expect(host.querySelector(`.maze__tile[data-node-type="${type}"] [data-maze-icon="${type}"]`)).not.toBeNull();
    }
    expect(host.querySelector('.maze__tile[data-current="true"] [data-maze-icon="complete"]')).not.toBeNull();
    expect(host.querySelector('.maze__tile[data-explored="false"] .maze__tile-complete')).toBeNull();
    expectClosed();
    await click('.maze__tile[data-reachable="true"]');
    expectClosed();
    await click('.maze__sidebar-toggle');
    expect(host.querySelector('.maze__detail-title')).not.toBeNull();
    await click('.maze__sidebar-toggle'); expectClosed();
  });

  it('到达补给仅准备商店，手动开关；优惠状态按权威商品展示', async () => {
    const neighbor = supply.neighbors[0]!;
    await setup(neighbor);
    const selector = `.maze__tile[data-node-id="${supply.id}"]`;
    await click(selector); await click(selector); await arrive();
    expectClosed();
    expect(button('.maze__sidebar-toggle').textContent).toContain('打开商店');
    await click('.maze__sidebar-toggle');
    const stock = mazeShopStock(withShopState({
      ...newMazeRun(map, 'floor1', 1), playerNodeId: supply.id,
    }, supply.id), supply.id);
    expect(host.querySelectorAll('.maze__shop-item').length).toBe(stock.length);
    expect(stock.length).toBeGreaterThanOrEqual(3); expect(stock.length).toBeLessThanOrEqual(5);
    for (const slot of stock) {
      const item = [...host.querySelectorAll<HTMLElement>('.maze__shop-item')].find(el => el.dataset.entryId === slot.entry.entryId)!;
      expect(item.dataset.discount).toBe(slot.item.discount);
      expect(item.querySelector('.maze__shop-buy')!.textContent).toContain(String(slot.item.price.amount));
      expect(!!item.querySelector('.maze__discount')).toBe(slot.item.discount !== 'none');
      if (slot.item.discount === 'oneGold') {
        expect(item.querySelector('.maze__discount')!.textContent).toBe('-99% · 1金币');
        expect(item.querySelector('.maze__shop-buy')!.textContent).toBe('1 金币');
      }
    }
    await click('.maze__shop-close'); expectClosed();
    await click(selector); expectClosed();
    await click('.maze__sidebar-toggle');
    expect(host.querySelector('.maze__shop')).not.toBeNull();
  });

  it('读档在商店可手动打开，刷新与购买都不改变侧栏收展状态', async () => {
    await setup(supply.id); expectClosed();
    await click('.maze__sidebar-toggle');
    const oldIds = [...host.querySelectorAll<HTMLElement>('.maze__shop-item')].map(el => el.dataset.entryId);
    await click('.maze__shop-refresh');
    const newIds = [...host.querySelectorAll<HTMLElement>('.maze__shop-item')].map(el => el.dataset.entryId);
    expect(newIds).not.toEqual(oldIds);
    expect(button('.maze__sidebar-toggle').getAttribute('aria-expanded')).toBe('true');
    await click('.maze__shop-buy');
    expect(button('.maze__shop-buy').textContent).toBe('已售罄');
    await click('.maze__sidebar-toggle'); expectClosed();
    await render(); expectClosed();
    await click('.maze__sidebar-toggle');
    expect(button('.maze__shop-buy').textContent).toBe('已售罄');
  });

  it('走过Boss不等于通关，返回场景默认收起；只有胜利记录给通关字样', async () => {
    await setup(map.bossId);
    const boss = `.maze__tile[data-node-id="${map.bossId}"]`;
    expect(button(boss).querySelector('.maze__tile-complete')).not.toBeNull();
    expect(button(boss).querySelector('.maze__tile-done')).toBeNull();
    expectClosed();
    await act(async () => root.unmount()); root = createRoot(host); store.dispose();
    await setup(map.bossId, true);
    expect(button(boss).querySelector('.maze__tile-done')!.textContent).toBe('已通关');
    expectClosed();
  });

  it('移动离开补给后不保留远程货架，重开立即换图回入口', async () => {
    await setup(supply.id);
    await click('.maze__sidebar-toggle');
    const neighbor = supply.neighbors[0]!;
    await click(`.maze__tile[data-node-id="${neighbor}"]`);
    await click(`.maze__tile[data-node-id="${neighbor}"]`);
    expect(button('.maze__reset').disabled).toBe(true);
    await arrive();
    if (map.nodes[neighbor]!.type !== 'supply') expect(host.querySelector('.maze__shop')).toBeNull();
    await click('.maze__reset');
    const expected = generateMaze(mazeRngFor('floor1', 2));
    expect(host.querySelectorAll('.maze__tile').length).toBe(expected.nodes.length);
    expect(button('.maze__tile[data-current="true"]').dataset.nodeId).toBe(String(expected.entryId));
    for (const node of expected.nodes) expect(button(`.maze__tile[data-node-id="${node.id}"]`).dataset.nodeType).toBe(node.type);
  });
});
