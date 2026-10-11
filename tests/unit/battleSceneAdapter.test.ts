// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleSnapshot, SessionControl } from '../../src/rendering/presentation/session';
import { createBattle } from '../../src/domain/battle/engine';
import { displayFromState } from '../../src/rendering/presentation/displayState';
import { DEMO_CONFIG, demoDefinitions } from '../../src/rendering/presentation/demoBattle';
import { BattleScene, type BattleSceneProps } from '../../src/scenes/BattleScene';

const fixture = vi.hoisted(() => ({ snapshot: null as unknown as BattleSnapshot,
  control: {} as SessionControl, start: vi.fn(), dispose: vi.fn(), toMenu: vi.fn(), board: vi.fn() }));
vi.mock('@react-three/fiber', () => ({ Canvas: () => null }));
vi.mock('../../src/scenes/WebGLGuard', () => ({ WebGLGuard: ({ children }: { children: ReactNode }) => children }));
vi.mock('../../src/rendering/presentation/useBattleSession', () => ({ useBattleSession: () => fixture.snapshot }));
vi.mock('../../src/rendering/presentation/session', () => ({ BattleSession: class {
  authoritative = { definitions: {} };
  constructor(_config: unknown, _definitions: unknown, _speed: unknown, _effects: unknown, control: SessionControl) { fixture.control = control; }
  getSnapshot = () => fixture.snapshot;
  start = fixture.start;
  dispose = fixture.dispose;
  toMenu = fixture.toMenu;
} }));
vi.mock('../../src/rendering/battle/placements', () => ({
  buildBoard: (...args: unknown[]) => { fixture.board(...args); return { entries: [], piles: [], placeable: new Set(), targeted: new Set() }; },
  slotPosition: () => [0, 0, 0], slotKeyFor: () => '',
}));
vi.mock('../../src/rendering/battle/BattleBoard', () => ({ BattleBoard: () => null }));
vi.mock('../../src/rendering/battle/DealAnimation', () => ({ DealAnimation: () => null }));
vi.mock('../../src/rendering/battle/DepartingCard', () => ({ DepartingCard: () => null }));
vi.mock('../../src/rendering/battle/PresentationDriver', () => ({ PresentationDriver: () => null }));
vi.mock('../../src/rendering/battle/DeploymentDragController', () => ({ DeploymentDragController: () => null }));
vi.mock('../../src/rendering/effects/EffectSystem', () => ({ EffectSystem: () => null }));
vi.mock('../../src/rendering/PerfSampler', () => ({ PerfSampler: () => null }));
vi.mock('../../src/rendering/postprocessing/PostEffects', () => ({ PostEffects: () => null }));
vi.mock('../../src/ui/PerfOverlay', () => ({ PerfOverlay: () => null }));
vi.mock('../../src/ui/BattleSettings', () => ({ BattleSettings: () => null }));
vi.mock('../../src/services/audio/AudioEngine', () => ({ audioEngine: { play: vi.fn() } }));
vi.mock('../../src/rendering/effects/effectDirector', () => ({ effectDirector: { play: vi.fn(), skipAll: vi.fn() } }));

let root: Root, host: HTMLDivElement;
const outcome = { kind: 'win', winner: 'player', reason: 'hpDepleted' } as const;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const state = createBattle(DEMO_CONFIG, demoDefinitions());
  fixture.snapshot = { mode: 'battle', display: displayFromState(state), inputOpen: false, phase: state.phase,
    turnNumber: 1, currentSide: 'player', inputSide: 'player', startingSide: 'player', priority: null,
    selectedKind: null, deployableInstanceIds: [], playableBattleSlots: [], cardsPlayedThisTurn: 0,
    cardLimit: 1, baseHp: state.rules.baseHp, playerHasLegalPlay: true, outcome: null,
    selectedInstanceId: null, playablePrepSlots: [], log: [], autoPlayer: false, runId: 1,
    localMultiplayer: false, autoEnemy: true, currentHasLegalPlay: true };
  fixture.start.mockClear(); fixture.dispose.mockClear(); fixture.board.mockClear();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async (props: BattleSceneProps = {}) => { await act(async () => root.render(createElement<BattleSceneProps>(BattleScene, props))); };
const button = (label: string) => [...host.querySelectorAll('button')].find(node => node.textContent === label);

describe('独立战斗界面适配', () => {
  it('非本地模式显示自定义退出，保存锁定时不调用返回', async () => {
    const onLeave = vi.fn();
    await render({ onLeave, leaveLabel: '返回深渊', exitDisabled: true, allowRematch: false });
    expect(button('返回深渊')?.disabled).toBe(true);
    await act(async () => button('返回深渊')!.click());
    expect(onLeave).not.toHaveBeenCalled();
    await render({ onLeave, leaveLabel: '返回深渊', exitDisabled: false, allowRematch: false });
    await act(async () => button('返回深渊')!.click());
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('同步权威回调使用最新props，旧onFinished仍只在演出结果态触发', async () => {
    const first = vi.fn(), latest = vi.fn(), finished = vi.fn();
    await render({ onOutcome: first, onFinished: finished });
    await render({ onOutcome: latest, onFinished: finished });
    await act(async () => fixture.control.onOutcome?.(outcome));
    expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledWith(outcome);
    expect(finished).not.toHaveBeenCalled();
    fixture.snapshot = { ...fixture.snapshot, mode: 'result', outcome };
    await render({ onOutcome: latest, onFinished: finished });
    expect(finished).toHaveBeenCalledExactlyOnceWith(outcome);
  });

  it('自定义结果面板替代演示奖励，默认面板禁重赛和退出锁均生效', async () => {
    fixture.snapshot = { ...fixture.snapshot, mode: 'result', outcome };
    await render({ allowRematch: false, resultPanel: createElement('section', { 'data-testid': 'abyss-result' }, '保存中') });
    expect(host.querySelector('[data-testid="abyss-result"]')?.textContent).toBe('保存中');
    expect(host.textContent).not.toContain('演示'); expect(button('再来一局')).toBeUndefined();
    const exit = vi.fn();
    await render({ allowRematch: false, onExit: exit, exitLabel: '回营地', exitDisabled: true });
    expect(button('再来一局')).toBeUndefined(); expect(button('回营地')?.disabled).toBe(true);
    await act(async () => button('回营地')!.click()); expect(exit).not.toHaveBeenCalled();
    await render({ onExit: exit });
    expect(button('再来一局')?.disabled).toBe(false);
  });
});
