// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AbyssBattleScene, AbyssSettlement } from '../../src/scenes/AbyssBattleScene';
import { cardDatabase } from '../../src/data';
import { ProfileStore } from '../../src/state/createProfileStore';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import type { SaveRepository } from '../../src/services/save/SaveRepository';
import { fixedClock } from '../../src/domain/progression/clock';
import { abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import type { BattleSceneProps } from '../../src/scenes/BattleScene';

const mock = vi.hoisted(() => ({ props: {} as BattleSceneProps }));
vi.mock('../../src/scenes/BattleScene', () => ({ BattleScene: (props: BattleSceneProps) => { mock.props = props; return createElement('div', null, props.resultPanel); } }));
vi.mock('../../src/ui/AbyssTraitCards', () => ({ AbyssTraitCards: () => null }));
let host: HTMLDivElement, root: Root;
let frames: Map<number, FrameRequestCallback>, frameId: number;
const paint = async () => { await act(async () => {
  const ready = [...frames.values()]; frames.clear(); ready.forEach(callback => callback(0));
}); };
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frames = new Map(); frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('freezes the battle result, returns after animation, then saves only over the cleared reward table and retries without duplicate rewards', async () => {
  const memory = new MemorySaveRepository(); let fail = false;
  const repository: SaveRepository = { kind: 'memory', load: () => memory.load(), close: () => memory.close(), clear: () => memory.clear(),
    commit: async value => { if (fail) throw new Error('磁盘不可用'); await memory.commit(value); } };
  const store = new ProfileStore({ repository, clock: fixedClock(new Date('2026-10-12')), contentVersion: cardDatabase.contentVersion, starterCardIds: [], seedSource: () => 5 });
  await store.load();
  for (const action of [{ kind: 'start' }, { kind: 'chooseStarter', index: 0 }, { kind: 'chooseBoon', index: 0 }, { kind: 'beginBattle' }] as const) {
    const response = await store.commitEconomic(profile => planAbyssAction(profile, { ...action, expectedToken: abyssStateToken(profile) }, Date.now()));
    expect(response.ok).toBe(true);
  }
  const run = store.getSnapshot().profile!.abyss.run!;
  if (run.stage.kind !== 'inBattle') throw new Error('not battle');
  const onReturn = vi.fn(), onSaved = vi.fn();
  const outcome = { kind: 'win', winner: 'player', reason: 'hpDepleted' } as const;
  await act(async () => root.render(createElement(AbyssBattleScene, { run, battle: run.stage.kind === 'inBattle' ? run.stage.battle : neverBattle(), store, onReturn })));
  const config = mock.props.config;
  await act(async () => mock.props.onOutcome?.(outcome));
  expect(onReturn).not.toHaveBeenCalled();
  expect(store.getSnapshot().profile!.abyss.run!.stage.kind).toBe('inBattle');
  expect(store.getSnapshot().profile!.abyss.run!.coins).toBe(0);
  expect(mock.props.config).toBe(config);
  await act(async () => mock.props.onFinished?.(outcome));
  expect(mock.props.clearing).toBe(true);
  expect(onReturn).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(449));
  expect(onReturn).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(onReturn).toHaveBeenCalledExactlyOnceWith(outcome);
  await act(async () => mock.props.onFinished?.(outcome)); expect(onReturn).toHaveBeenCalledTimes(1);

  fail = true;
  await act(async () => root.render(createElement(AbyssSettlement, { store, battleId: run.stage.kind === 'inBattle' ? run.stage.battle.battleId : '', outcome, onSaved })));
  expect(host.querySelector('[aria-label="盘面战果结算"]')).not.toBeNull();
  expect(store.getSnapshot().profile!.abyss.run!.stage.kind).toBe('inBattle');
  await paint(); expect(store.getSnapshot().profile!.abyss.run!.stage.kind).toBe('inBattle');
  await paint(); expect(host.textContent).toContain('磁盘不可用'); expect(onSaved).not.toHaveBeenCalled();
  fail = false;
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '重试结算')!.click());
  expect(store.getSnapshot().profile!.abyss.run!.coins).toBe(15);
  expect(store.getSnapshot().profile!.abyss.run!.stage).toMatchObject({ kind: 'camp', freeRemaining: 1 });
  expect(onSaved).toHaveBeenCalledTimes(1);
  await paint(); expect(store.getSnapshot().profile!.abyss.run!.coins).toBe(15);
  await act(async () => root.render(null)); store.dispose();
});

function neverBattle(): never { throw new Error('not battle'); }
