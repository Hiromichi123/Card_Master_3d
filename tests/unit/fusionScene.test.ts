// @vitest-environment jsdom
import { act, createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { FusionScene } from '../../src/scenes/FusionScene';
import { HubScene } from '../../src/scenes/HubScene';
import { BattleMenuScene } from '../../src/scenes/BattleMenuScene';
import { cardDatabase } from '../../src/data';
import { buildCardPool } from '../../src/domain/progression/gacha';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { ProfileStore } from '../../src/state/createProfileStore';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import { FailingSaveRepository } from '../../src/services/save/FailingSaveRepository';
import type { SaveRepository } from '../../src/services/save/SaveRepository';
import type { FusionAltarProps } from '../../src/rendering/fusion/FusionAltarStage';

vi.mock('../../src/rendering/fusion/FusionAltarStage', () => ({ FusionAltarStage: (props: FusionAltarProps) =>
  createElement('div', { 'data-testid': 'altar', 'data-run': props.run?.operationId ?? '', 'data-slots': props.cards.filter(Boolean).length },
    createElement('button', { 'data-testid': 'finish', onClick: props.onFinished }, '完成演出'),
    props.run && createElement('button', { 'data-testid': 'result-card', disabled: !props.completed,
      onClick: () => props.onPreview(props.run!.result) }, props.run.result.name)) }));
vi.mock('../../src/ui/CardShowcase', () => ({ CardShowcase: ({ onClose }: { onClose: () => void }) =>
  createElement('div', { role: 'dialog', 'aria-label': '卡牌预览' }, createElement('button', { onClick: onClose }, '关闭预览')) }));
vi.mock('../../src/ui/PosterCarousel', () => ({ PosterCarousel: () => null }));

const material = buildCardPool(cardDatabase.definitions).get('D')![0]!;
const initial = (copies = 5) => createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261006',
  now: new Date('2026-10-06T00:00:00Z'), starterCardIds: [], ownedCardIds: Array.from({ length: copies }, () => material) });
let root: Root | null = null;
let store: ProfileStore | null = null;
let host: HTMLDivElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  await act(async () => root?.unmount());
  store?.dispose(); root = null; store = null;
  document.body.replaceChildren(); vi.restoreAllMocks();
});

async function mount(repository: SaveRepository): Promise<void> {
  const active = new ProfileStore({ repository, clock: () => new Date('2026-10-06T00:00:00Z'), seedSource: () => 71,
    contentVersion: cardDatabase.contentVersion, starterCardIds: [] });
  store = active; await active.load();
  function Harness() {
    const snapshot = useSyncExternalStore(active.subscribe, active.getSnapshot);
    return createElement(FusionScene, { profile: snapshot.profile!, store: active, busy: snapshot.busy, onReturn: () => {} });
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(createElement(Harness)));
}
async function click(selector: string): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>(selector)!;
  expect(button).not.toBeNull(); await act(async () => { button.click(); });
}
const materialButton = () => `button[data-card-id="${material}"]`;
async function fill(): Promise<void> { for (let i = 0; i < 5; i++) await click(materialButton()); }

it('adds and returns exact copies, previews odds, and never changes inventory before fusion', async () => {
  const repository = new MemorySaveRepository(initial(3)); await mount(repository);
  for (let i = 0; i < 3; i++) await click(materialButton());
  expect(host.querySelector('[data-testid="altar"]')!.getAttribute('data-slots')).toBe('3');
  expect(host.querySelector<HTMLButtonElement>(materialButton())!.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('[data-testid="fuse"]')!.disabled).toBe(true);
  expect(host.querySelectorAll('.fusion__probabilities li').length).toBeGreaterThan(0);
  await click('.fusion__slots button');
  expect(host.querySelector('[data-testid="altar"]')!.getAttribute('data-slots')).toBe('2');
  expect(host.querySelector<HTMLButtonElement>(materialButton())!.disabled).toBe(false);
  expect(repository.commitCount).toBe(0); expect(store!.getSnapshot().profile!.inventory[material]).toBe(3);
});

it('writes once on a double click, then allows result preview and the next fusion', async () => {
  const repository = new MemorySaveRepository(initial(10)); await mount(repository); await fill();
  const gold = store!.getSnapshot().profile!.currencies.gold;
  await act(async () => {
    const button = host.querySelector<HTMLButtonElement>('[data-testid="fuse"]')!;
    button.click(); button.click();
  });
  expect(repository.commitCount).toBe(1);
  expect(store!.getSnapshot().profile!.currencies.gold).toBe(gold);
  expect(Object.values(store!.getSnapshot().profile!.inventory).reduce((sum, count) => sum + count, 0)).toBe(6);
  expect(host.querySelector('[data-testid="altar"]')!.getAttribute('data-slots')).toBe('0');
  expect(host.querySelector<HTMLButtonElement>('[data-testid="result-card"]')!.disabled).toBe(true);
  await click('[data-testid="skip-fusion"]'); await click('[data-testid="result-card"]');
  expect(repository.commitCount).toBe(1);
  expect(host.querySelector('[aria-label="卡牌预览"]')).not.toBeNull();
  await click('[role="dialog"] button');
  expect(host.querySelector('.fusion__latest')!.textContent).toContain('已加入收藏');
  await fill(); await click('[data-testid="fuse"]');
  expect(repository.commitCount).toBe(2);
  expect(Object.values(store!.getSnapshot().profile!.inventory).reduce((sum, count) => sum + count, 0)).toBe(2);
});

it('retains all selected slots and never starts an animation if saving fails', async () => {
  const inner = new MemorySaveRepository(initial()); await mount(new FailingSaveRepository(inner)); await fill();
  await click('[data-testid="fuse"]');
  expect(host.querySelector('[data-testid="altar"]')!.getAttribute('data-slots')).toBe('5');
  expect(host.querySelector('[data-testid="altar"]')!.getAttribute('data-run')).toBe('');
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('写入');
  expect(host.querySelector<HTMLButtonElement>('[data-testid="fuse"]')!.disabled).toBe(false);
  expect(inner.peek()!.inventory[material]).toBe(5); expect(inner.commitCount).toBe(0);
});

it('exposes fusion, keeps lobby Draft and maze entries hidden and restores local battle selection', () => {
  const profile = initial(); const onNavigate = vi.fn();
  const hub = renderToStaticMarkup(createElement(HubScene, { profile, onNavigate, onReset: () => {} }));
  expect(hub).toContain('menu--hub'); expect(hub).toContain('融合');
  expect(hub).not.toContain('Draft'); expect(hub).not.toContain('迷宫'); expect(hub).not.toContain('待开发');
  const battle = renderToStaticMarkup(createElement(BattleMenuScene, { profile, onNavigate }));
  expect(battle).toContain('本地 任选对战（双人）');
});
