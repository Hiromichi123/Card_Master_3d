// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BattleHud } from '../../src/ui/BattleHud';
import { BattleSession } from '../../src/rendering/presentation/session';
import { DEMO_CONFIG, demoDefinitions } from '../../src/rendering/presentation/demoBattle';
import { battleAiSettings, battleAiModel, useAdminAiStore } from '../../src/state/adminAiStore';
import { useSettingsStore } from '../../src/state/settingsStore';
import { DEFAULT_AI } from '../../src/domain/battle/ai/types';
let host: HTMLDivElement, root: Root, session: BattleSession;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  session = new BattleSession(DEMO_CONFIG, demoDefinitions(), () => 'normal', { play: () => {}, skipAll: () => {} }); session.start();
});
afterEach(async () => { await act(async () => root.unmount()); session.dispose(); host.remove(); useAdminAiStore.setState({ enabled: false }); useSettingsStore.getState().setAi(DEFAULT_AI); vi.unstubAllGlobals(); });
it('only exposes the menu trigger in the action corner, Escape toggles it, and no AI settings are player-visible', async () => {
  const paused = vi.fn();
  await act(async () => root.render(createElement(BattleHud, { snapshot: session.getSnapshot(), onEndTurn: vi.fn(), onSkipPerformance: vi.fn(), onPauseChange: paused, onRetry: vi.fn() })));
  expect(host.querySelectorAll('.hud__actions button')).toHaveLength(1);
  expect(host.querySelector('.hud__actions')!.textContent).toBe('Esc 呼出菜单');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  const menu = host.querySelector('[role="dialog"]')!;
  expect(menu).not.toBeNull(); expect(paused).toHaveBeenLastCalledWith(true);
  expect(menu.textContent).toContain('继续对战'); expect(menu.textContent).toContain('再试一次'); expect(menu.textContent).toContain('退出');
  expect(menu.querySelector('[aria-label="人机难度"]')).toBeNull();
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(paused).toHaveBeenLastCalledWith(false);
});
it('ignores saved AI overrides for ordinary accounts and permits development admin overrides only', () => {
  useSettingsStore.getState().setAi({ difficulty: 'boss', style: 'control', policy: 'hybrid' });
  expect(battleAiSettings()).toEqual(DEFAULT_AI); expect(battleAiModel()).toBeNull();
  useAdminAiStore.setState({ enabled: true });
  expect(battleAiSettings()).toEqual({ difficulty: 'boss', style: 'control', policy: 'hybrid' });
});
it('does not advance the presentation or input while paused and resumes when closed', () => {
  const before = session.getSnapshot(); session.setPaused(true);
  session.tick(100); session.endTurn();
  expect(session.getSnapshot()).toEqual(before);
  session.setPaused(false); session.tick(.01);
  expect(session.getSnapshot().mode).toBe('battle');
});
