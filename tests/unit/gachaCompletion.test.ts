// @vitest-environment jsdom
import { act, createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GachaScene } from '../../src/scenes/GachaScene';
import type { GachaStageProps } from '../../src/rendering/gacha/GachaStage';
import { ProfileStore } from '../../src/state/createProfileStore';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import { useSettingsStore } from '../../src/state/settingsStore';
import { cardDatabase } from '../../src/data';
import { Group } from 'three';
import { GachaDriver } from '../../src/rendering/gacha/GachaDriver';
import { buildChoreography } from '../../src/rendering/gacha/choreography';
const frame = vi.hoisted(() => ({ tick: null as null | ((state: unknown, delta: number) => void) }));
vi.mock('@react-three/fiber', () => ({ useFrame: (tick: (state: unknown, delta: number) => void) => { frame.tick = tick; } }));

// Exercise the real UI/economy flow with a stage stand-in; no WebGL or game instance runs.
vi.mock('../../src/ui/GachaMenu', () => ({ GachaMenu: ({ onPull, onSelectPool }: { onPull: (n: 1 | 10) => void; onSelectPool: (index: number) => void }) =>
  createElement('div', { 'data-testid': 'menu' },
    createElement('button', { 'data-testid': 'pull-1', onClick: () => onPull(1) }, '单抽'),
    createElement('button', { 'data-testid': 'pull-10', onClick: () => onPull(10) }, '十连'),
    createElement('button', { 'data-testid': 'switch-pool', onClick: () => onSelectPool(1) }, '切换卡池')) }));
vi.mock('../../src/rendering/gacha/GachaStage', () => ({ GachaStage: (props: GachaStageProps) =>
  createElement('div', { 'data-testid': 'stage', 'data-completed': String(props.completed), 'data-skip': String(props.skipAnimation), 'data-backdrop': props.backdropUrl },
    createElement('button', { 'data-testid': 'finish', onClick: props.onFinished }, '动画完成'),
    createElement('button', { 'data-testid': 'start-transition', onClick: props.onStarted }, '开始衔接'),
    createElement('button', { 'data-testid': 'hide-ui', onClick: props.onMenuHidden }, '组件退场'),
    ...props.cards.map((card, i) => createElement('button', { key: i, 'data-testid': 'entity-card',
      disabled: !props.completed, onClick: () => props.onPreview(card) }, card.name))) }));
vi.mock('../../src/ui/CardShowcase', () => ({ CardShowcase: ({ onClose }: { onClose: () => void }) =>
  createElement('div', { role: 'dialog', 'aria-label': '卡牌预览' },
    createElement('button', { 'data-testid': 'close-preview', onClick: onClose }, '关闭预览')) }));

let root: Root | null = null;
let store: ProfileStore | null = null;
let host: HTMLDivElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  await act(async () => root?.unmount());
  store?.dispose(); root = null; store = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(speed: 'normal' | 'skip'): Promise<MemorySaveRepository> {
  useSettingsStore.getState().setPresentationSpeed(speed);
  const repository = new MemorySaveRepository();
  const activeStore = new ProfileStore({ repository, clock: () => new Date('2026-10-06T00:00:00Z'),
    seedSource: () => 17, contentVersion: cardDatabase.contentVersion, starterCardIds: ['D_001'] });
  store = activeStore;
  await activeStore.load();
  function Harness() {
    const snapshot = useSyncExternalStore(activeStore.subscribe, activeStore.getSnapshot);
    return createElement(GachaScene, { profile: snapshot.profile!, store: activeStore, busy: snapshot.busy });
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(createElement(Harness)));
  return repository;
}
async function click(selector: string): Promise<void> {
  const element = host.querySelector<HTMLButtonElement>(selector);
  expect(element).not.toBeNull();
  await act(async () => { element!.click(); });
}

describe('physical-card completion flow', () => {
  it('waits for the reveal, previews on click and repeats the pull without a confirmation dialog', async () => {
    const repository = await mount('normal');
    const stage = host.querySelector('[data-testid="stage"]');
    await click('[data-testid="pull-1"]');
    expect(host.querySelector('[data-testid="stage"]')).toBe(stage);
    expect(host.querySelector('.gacha-complete')).toBeNull();
    expect(host.querySelector('[data-testid="entity-card"]')).not.toBeNull();
    await click('[data-testid="finish"]');
    expect(host.querySelector('.gacha-complete')).not.toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await click('[data-testid="entity-card"]');
    expect(host.querySelector('[aria-label="卡牌预览"]')).not.toBeNull();
    await click('[data-testid="close-preview"]');
    const commits = repository.commitCount;
    const gold = store!.getSnapshot().profile!.currencies.gold;
    await click('[data-testid="pull-again"]');
    expect(repository.commitCount).toBe(commits + 1);
    expect(store!.getSnapshot().profile!.currencies.gold).toBe(gold - 500);
    await click('[data-testid="start-transition"]');
    expect(host.querySelector('.gacha-complete--leaving')).not.toBeNull();
    await click('[data-testid="hide-ui"]');
    expect(host.querySelector('.gacha-complete')).toBeNull();
    expect(host.querySelector('[data-testid="stage"]')).toBe(stage);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('skip retains all ten physical cards and a failed repeat leaves the paid result intact', async () => {
    const repository = await mount('skip');
    await click('[data-testid="pull-10"]');
    expect(host.querySelectorAll('[data-testid="entity-card"]')).toHaveLength(10);
    expect(host.querySelector('[data-testid="stage"]')?.getAttribute('data-skip')).toBe('true');
    expect(host.querySelector('.gacha-complete')).not.toBeNull();
    const commits = repository.commitCount;
    await click('[data-testid="pull-again"]');
    expect(repository.commitCount).toBe(commits);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('余额不够');
    expect(host.querySelectorAll('[data-testid="entity-card"]')).toHaveLength(10);
    const leave = [...host.querySelectorAll('button')].find((button) => button.textContent === '离开');
    await act(async () => { leave!.click(); });
    expect(host.querySelector('[data-testid="menu"]')).not.toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});


it('skipping finishes physical card poses once and emits no overdue reveal bursts', async () => {
  useSettingsStore.getState().setPresentationSpeed('normal');
  const group = new Group();
  const flip = { current: 1 };
  const choreo = buildChoreography({ cards: [{ cardId: 'D_001', rarity: 'D' }], rankOf: () => 0,
    isHighRarity: () => false, aspect: 16 / 9 });
  const onBurst = vi.fn(); const onFinished = vi.fn();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(createElement(GachaDriver, { choreo, elapsed: { current: 0 },
    targets: { current: [group] }, flipControls: [flip], onBurst, onFinished, ready: true, instant: true })));
  await act(async () => { frame.tick!(null, 1 / 60); frame.tick!(null, 1 / 60); });
  expect(flip.current).toBe(0);
  expect(group.visible).toBe(true);
  expect(onFinished).toHaveBeenCalledOnce();
  expect(onBurst).not.toHaveBeenCalled();
});


it('updates pool UI immediately without a full-screen fade or delaying another action', async () => {
  const repository = await mount('normal');
  const stage = host.querySelector('[data-testid="stage"]')!;
  const original = stage.getAttribute('data-backdrop');
  const commits = repository.commitCount;
  await click('[data-testid="switch-pool"]');
  expect(stage.getAttribute('data-backdrop')).not.toBe(original);
  expect(host.querySelector('[data-testid="stage"]')).toBe(stage);
  expect(host.querySelector('.fade')).toBeNull();
  expect(repository.commitCount).toBe(commits);
  await click('[data-testid="pull-1"]');
  expect(repository.commitCount).toBe(commits + 1);
});
