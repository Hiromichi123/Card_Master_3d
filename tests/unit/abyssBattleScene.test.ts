// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AbyssBattleScene } from '../../src/scenes/AbyssBattleScene';
import { cardDatabase } from '../../src/data';
import { ProfileStore } from '../../src/state/createProfileStore';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import type { SaveRepository } from '../../src/services/save/SaveRepository';
import { fixedClock } from '../../src/domain/progression/clock';
import { abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import type { BattleSceneProps } from '../../src/scenes/BattleScene';

const mock = vi.hoisted(() => ({ props: {} as BattleSceneProps }));
vi.mock('../../src/scenes/BattleScene', () => ({ BattleScene: (props: BattleSceneProps) => { mock.props = props; return createElement('div', null, props.resultPanel); } }));
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('权威终局保存失败锁退出，重试只结算一次并保持开场config', async () => {
  const memory = new MemorySaveRepository();
  let fail = false;
  const repository: SaveRepository = { kind: 'memory', load: () => memory.load(), close: () => memory.close(), clear: () => memory.clear(),
    commit: async value => { if (fail) throw new Error('磁盘不可用'); await memory.commit(value); } };
  const store = new ProfileStore({ repository, clock: fixedClock(new Date('2026-10-11')), contentVersion: cardDatabase.contentVersion, starterCardIds: [], seedSource: () => 5 });
  await store.load();
  for (const action of [{ kind: 'start' }, { kind: 'chooseStarter', index: 0 }, { kind: 'chooseBoon', index: 0 }, { kind: 'beginBattle' }] as const) {
    const response = await store.commitEconomic(profile => planAbyssAction(profile, { ...action, expectedToken: abyssStateToken(profile) }, Date.now()));
    expect(response.ok).toBe(true);
  }
  const run = store.getSnapshot().profile!.abyss.run!;
  if (run.stage.kind !== 'inBattle') throw new Error('未开战');
  const onReturn = vi.fn();
  await act(async () => root.render(createElement(AbyssBattleScene, { run, battle: run.stage.kind === 'inBattle' ? run.stage.battle : neverBattle(), store, onReturn })));
  const config = mock.props.config;
  expect(mock.props.allowRematch).toBe(false);
  fail = true;
  await act(async () => mock.props.onOutcome?.({ kind: 'win', winner: 'player', reason: 'noCardsRemaining' }));
  expect(host.textContent).toContain('磁盘不可用'); expect(mock.props.exitDisabled).toBe(true);
  await act(async () => mock.props.onLeave?.()); expect(onReturn).not.toHaveBeenCalled();
  expect(store.getSnapshot().profile!.abyss.run!.stage.kind).toBe('inBattle');
  fail = false;
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '重试保存')!.click());
  expect(store.getSnapshot().profile!.abyss.run!.coins).toBe(30);
  expect(store.getSnapshot().profile!.abyss.run!.stage.kind).toBe('camp');
  expect(mock.props.config).toBe(config);
  await act(async () => mock.props.onOutcome?.({ kind: 'win', winner: 'player', reason: 'noCardsRemaining' }));
  expect(store.getSnapshot().profile!.abyss.run!.coins).toBe(30);
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '返回深渊')!.click());
  expect(onReturn).toHaveBeenCalledOnce();
});

function neverBattle(): never { throw new Error('未开战'); }
