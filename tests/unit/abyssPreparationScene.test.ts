// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbyssPreparationScene } from '../../src/scenes/AbyssPreparationScene';
import { useSettingsStore } from '../../src/state/settingsStore';
import { cardDatabase } from '../../src/data';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import type { ProfileState } from '../../src/domain/progression/types';
import type { AbyssDispatch } from '../../src/ui/AbyssRunPanel';
import { useCardTipStore } from '../../src/state/cardTipStore';

const gpu = vi.hoisted(() => ({
  supported: true,
  frame: null as (() => void) | null,
  board: { piles: [] as readonly { side: string; count: number }[], dragActive: false },
}));
vi.mock('@react-three/fiber', async () => {
  const { PerspectiveCamera } = await import('three');
  const camera = new PerspectiveCamera(45, 16 / 9, .1, 120);
  camera.position.set(0, 11, 9); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  return {
    useFrame: (callback: () => void) => { gpu.frame = callback; },
    useThree: () => ({ camera, gl: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }) } } }),
  };
});
vi.mock('../../src/rendering/battle/BattleCanvas', () => ({
  BattleCanvas: ({ children }: { children: ReactNode }) => createElement('div', { 'data-testid': 'battle-canvas' }, children),
}));
vi.mock('../../src/rendering/battle/BattleBoard', () => ({
  BattleBoard: (props: typeof gpu.board) => { gpu.board = props; return createElement('div', { 'data-testid': 'battle-board' }); },
}));
vi.mock('../../src/scenes/WebGLGuard', () => ({
  WebGLGuard: ({ children, fallback }: { children: ReactNode; fallback: ReactNode }) => gpu.supported ? children : fallback,
}));
vi.mock('../../src/ui/AbyssCard', () => ({ AbyssCard: () => createElement('span', { 'data-testid': 'detail-card' }) }));

const now = new Date('2026-10-12T10:00:00Z');
type Action = Parameters<AbyssDispatch>[0];
function advance(profile: ProfileState, action: Action): ProfileState {
  const plan = planAbyssAction(profile, { ...action, expectedToken: abyssStateToken(profile) }, now);
  if ('rejected' in plan) throw new Error(plan.rejected);
  const result = applyEconomyTransaction(profile, plan.transaction);
  if (!result.applied) throw new Error('transaction not applied');
  return result.profile;
}
let host: HTMLDivElement, root: Root, profile: ProfileState;
let busy = false, hidden = false, notice = '', memory = false;
let dispatch: ReturnType<typeof vi.fn<AbyssDispatch>>;
let frames: Map<number, FrameRequestCallback>, nextFrame: number, clock: number;
const home = vi.fn(), battle = vi.fn();
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;
const deck = (index: number) => host.querySelector<HTMLButtonElement>(`[data-deck-index="${index}"]`)!;
const playerCount = () => gpu.board.piles.find(pile => pile.side === 'player')?.count;
function draw() {
  root.render(createElement(AbyssPreparationScene, {
    run: profile.abyss.run!, busy, dispatch, onBattle: battle, onHome: home, notice, memory,
  }));
}
async function render() { await act(async () => draw()); }
async function click(node: HTMLElement) { await act(async () => node.click()); }
async function escape() {
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
}
async function step(count: number) {
  await act(async () => {
    for (let index = 0; index < count; index++) {
      clock += 16;
      const callbacks = [...frames.values()]; frames.clear();
      for (const callback of callbacks) callback(clock);
    }
  });
}
function deferredSave() {
  let resolve!: (ok: boolean) => void;
  const pending = new Promise<boolean>(done => { resolve = done; });
  dispatch.mockImplementation(async action => {
    const ok = await pending;
    if (ok) { profile = advance(profile, action); draw(); }
    return ok;
  });
  return resolve;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  busy = false; hidden = false; notice = ''; memory = false;
  gpu.supported = true; gpu.frame = null; gpu.board = { piles: [], dragActive: false };
  frames = new Map(); nextFrame = 1; clock = 100;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 120, 60, 78));
  useSettingsStore.setState({ reduceMotion: false });
  profile = advance(createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261012', starterCardIds: [], now }), { kind: 'start' });
  home.mockClear(); battle.mockClear();
  dispatch = vi.fn<AbyssDispatch>(async action => { profile = advance(profile, action); draw(); return true; });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('深渊战前选组与收牌', () => {
  it('先呈现空盘，同页三套各六张小图，仅卡组1/2/3，选中才能确认', async () => {
    await render();
    expect(host.querySelector('[data-testid="battle-board"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="battle-canvas"]')).not.toBeNull();
    expect(playerCount()).toBe(0);
    expect([...host.querySelectorAll('.abyss-draft__choice > strong')].map(node => node.textContent)).toEqual(['卡组1', '卡组2', '卡组3']);
    expect(host.querySelectorAll('.abyss-draft__choice')).toHaveLength(3);
    for (const node of host.querySelectorAll('.abyss-draft__cards')) expect(node.querySelectorAll('img')).toHaveLength(6);
    expect(host.querySelectorAll('.abyss-draft__cards img')).toHaveLength(18);
    expect(host.textContent).not.toMatch(/均衡之始|进攻之始|生存之始|ATK|HP|CD/);
    expect(button('确认').disabled).toBe(true);
    await click(deck(1));
    expect(deck(1).getAttribute('aria-pressed')).toBe('true');
    expect(button('确认').disabled).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(battle).not.toHaveBeenCalled();
  });

  it('选组的每张小卡面都挂简介，取本轮定义而不是卡图上的烘焙文字', async () => {
    await render();
    const stage = profile.abyss.run!.stage;
    if (stage.kind !== 'starterDraft') throw new Error('not draft');
    const faces = [...host.querySelectorAll<HTMLImageElement>('.abyss-draft__cards img')];
    expect(faces).toHaveLength(18);
    const first = stage.choices[0]!.cards[0]!;
    const pointer = (type: string, node: HTMLElement) => act(async () => {
      node.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: document.body }));
    });
    await pointer('pointerover', faces[0]!);
    const target = useCardTipStore.getState().target;
    expect(target?.cardId).toBe(first.instanceId);
    expect(target?.card).toEqual(first.definition);
    // 停留期间指针在图内移动不收起
    await act(async () => faces[0]!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 12, clientY: 34 })));
    expect(useCardTipStore.getState().target?.pointer).toEqual({ x: 12, y: 34 });
    await pointer('pointerout', faces[0]!);
    expect(useCardTipStore.getState().target).toBeNull();
  });

  it('busy禁选；同一批连续确认只提交一次，保存期间不能Escape或返回', async () => {
    busy = true; await render();
    expect(deck(0).disabled).toBe(true);
    await click(deck(0)); expect(dispatch).not.toHaveBeenCalled();
    busy = false; await render(); await click(deck(0));
    const resolve = deferredSave();
    const confirm = button('确认');
    await act(async () => { confirm.click(); confirm.click(); });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ kind: 'chooseStarter', index: 0 });
    expect(button('保存中…').disabled).toBe(true);
    expect(button('返回深渊大厅').disabled).toBe(true);
    await escape(); expect(home).not.toHaveBeenCalled();
    await act(async () => resolve(false));
    expect(button('确认').disabled).toBe(false);
  });

  it('保存失败不飞牌不推进，保留选择与错误，并可重试', async () => {
    dispatch.mockResolvedValue(false);
    await render(); await click(deck(2)); await click(button('确认'));
    notice = '写盘失败，请重试'; memory = true; await render();
    expect(profile.abyss.run!.stage.kind).toBe('starterDraft');
    expect(playerCount()).toBe(0);
    expect(host.querySelector('.abyss-collect')).toBeNull();
    expect(deck(2).getAttribute('aria-pressed')).toBe('true');
    expect(button('确认').disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('写盘失败');
    expect(host.querySelector('.abyss-storage-warning')?.textContent).toContain('内存存档');
    await click(button('确认')); expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('原子保存后冻结六卡，收牌锁退出；落完后才显示契约且不自动开战', async () => {
    await render(); gpu.frame?.(); await click(deck(1));
    const stage = profile.abyss.run!.stage;
    if (stage.kind !== 'starterDraft') throw new Error('not draft');
    const selected = stage.choices[1]!.cards;
    await click(button('确认'));
    expect(profile.abyss.run!.cards).toEqual(selected);
    expect(profile.abyss.run!.stage.kind).toBe('boonChoice');
    expect(host.querySelector('.abyss-preparation')?.getAttribute('data-collecting')).toBe('true');
    expect(host.querySelectorAll('.abyss-collect__card')).toHaveLength(6);
    expect(host.querySelector('.abyss-run')).toBeNull();
    expect(playerCount()).toBe(0);
    expect(gpu.board.dragActive).toBe(true);
    await escape(); expect(home).not.toHaveBeenCalled();
    await step(40);
    expect(playerCount()).toBe(1);
    expect(host.querySelector('.abyss-collect__card')?.getAttribute('style')).toContain('visibility: hidden');
    await step(25);
    expect(host.querySelector('.abyss-collect')).toBeNull();
    expect(playerCount()).toBe(6);
    expect(host.querySelectorAll('.abyss-boon')).toHaveLength(3);
    expect(host.querySelector('.abyss-run__deck')).toBeNull();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(battle).not.toHaveBeenCalled();
    await escape(); expect(home).toHaveBeenCalledOnce();
  });

  it('后台期间不推进收牌；返回前台续播，减少动态中途切换直接完成', async () => {
    await render(); gpu.frame?.(); await click(deck(0)); await click(button('确认'));
    await step(10);
    const before = host.querySelector('.abyss-collect__card')?.getAttribute('style');
    hidden = true; await step(100);
    expect(host.querySelector('.abyss-collect__card')?.getAttribute('style')).toBe(before);
    expect(playerCount()).toBe(0);
    hidden = false; await step(1);
    expect(host.querySelector('.abyss-collect__card')?.getAttribute('style')).toBe(before);
    await step(2);
    expect(host.querySelector('.abyss-collect__card')?.getAttribute('style')).not.toBe(before);
    await act(async () => useSettingsStore.setState({ reduceMotion: true }));
    expect(host.querySelector('.abyss-collect')).toBeNull();
    expect(playerCount()).toBe(6);
    expect(host.querySelectorAll('.abyss-boon')).toHaveLength(3);
    expect(frames.size).toBe(0);
  });

  it('WebGL不可用或尚无投影时跳过收牌，不把已保存的选组卡死', async () => {
    gpu.supported = false;
    await render();
    expect(host.textContent).toContain('3D盘面不可用');
    await click(deck(0)); await click(button('确认'));
    expect(profile.abyss.run!.stage.kind).toBe('boonChoice');
    expect(profile.abyss.run!.cards).toHaveLength(6);
    expect(host.querySelector('.abyss-collect')).toBeNull();
    expect(host.querySelectorAll('.abyss-boon')).toHaveLength(3);
    expect(host.textContent).toContain('选中卡组已保存');
    await escape(); expect(home).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it('恢复已保存契约直接显示六张牌堆，不重选、不补播、不重抽候选', async () => {
    profile = advance(profile, { kind: 'chooseStarter', index: 2 });
    const saved = JSON.stringify(profile.abyss.run);
    await render(); gpu.frame?.();
    expect(playerCount()).toBe(6);
    expect(host.querySelector('.abyss-draft')).toBeNull();
    expect(host.querySelector('.abyss-collect')).toBeNull();
    expect(host.querySelectorAll('.abyss-boon')).toHaveLength(3);
    expect(dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(profile.abyss.run)).toBe(saved);
    expect(frames.size).toBe(0);
  });

  it('收牌卸载取消rAF，迟到保存完成不会重挂弹层或调用退出', async () => {
    await render(); gpu.frame?.(); await click(deck(0)); await click(button('确认'));
    expect(frames.size).toBe(1);
    await act(async () => root.render(null));
    expect(frames.size).toBe(0);
    profile = advance(profile, { kind: 'start', confirmAbandon: true });
    await render(); await click(deck(0));
    let resolve!: (ok: boolean) => void;
    dispatch.mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
    await click(button('确认'));
    await act(async () => root.render(null));
    await act(async () => resolve(true));
    expect(host.childElementCount).toBe(0);
    expect(frames.size).toBe(0);
    expect(home).not.toHaveBeenCalled(); expect(battle).not.toHaveBeenCalled();
  });
});
