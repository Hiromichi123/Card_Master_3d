// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbyssPreparationScene } from '../../src/scenes/AbyssPreparationScene';
import type { AbyssChoiceDragController } from '../../src/scenes/AbyssChoiceDrag';
import type { CardMeshProps } from '../../src/rendering/cards/CardMesh';
import { cardDatabase } from '../../src/data';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import { ABYSS_GROWTH_TRAITS } from '../../src/domain/progression/abyssRules';
import type { AbyssGrowthOption } from '../../src/domain/progression/abyssTypes';
import type { ProfileState } from '../../src/domain/progression/types';
import type { AbyssDispatch } from '../../src/ui/AbyssRunPanel';

type DragProps = Parameters<typeof AbyssChoiceDragController>[0];
const gpu = vi.hoisted(() => ({ board: {} as Record<string, unknown>, drag: null as DragProps | null }));
vi.mock('@react-three/fiber', async () => {
  const { PerspectiveCamera } = await import('three');
  const camera = new PerspectiveCamera();
  return { useFrame: () => {}, useThree: () => ({ camera, size: { width: 960, height: 540 } }) };
});
vi.mock('@react-three/drei', () => ({ Html: ({ children }: { children: ReactNode }) => createElement('div', null, children) }));
vi.mock('../../src/rendering/battle/BattleCanvas', () => ({ BattleCanvas: ({ children }: { children: ReactNode }) => createElement('div', null, children) }));
vi.mock('../../src/rendering/battle/BattleBoard', () => ({ BattleBoard: (props: Record<string, unknown>) => { gpu.board = props; return null; } }));
vi.mock('../../src/rendering/cards/CardMesh', () => ({ CardMesh: ({ card }: CardMeshProps) => createElement('span', { 'data-card-id': card.cardId }, card.name) }));
vi.mock('../../src/ui/AbyssTraitCards', () => ({ AbyssTraitCards: () => null, AbyssTraitBody: ({ item }: { item: { name: string } }) => createElement('span', null, item.name) }));
vi.mock('../../src/scenes/WebGLGuard', () => ({ WebGLGuard: ({ children }: { children: ReactNode }) => children }));
vi.mock('../../src/ui/AbyssHomeCrystals', () => ({ AbyssHomeCrystals: () => null }));
vi.mock('../../src/scenes/AbyssChoiceDrag', () => ({ AbyssChoiceDragController: (props: DragProps) => { gpu.drag = props; return null; } }));
vi.mock('../../src/ui/AbyssDialog', () => ({ AbyssDialog: ({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) =>
  createElement('div', { role: 'dialog' }, createElement('h2', null, title), children, createElement('button', { onClick: onClose }, '关闭')) }));
vi.mock('../../src/ui/AbyssCountdown', () => ({ AbyssCountdown: () => null }));
vi.mock('../../src/scenes/AbyssUpgradeGlow', () => ({ AbyssUpgradeGlow: ({ upgrade }: { upgrade: { from: string; to: string } }) =>
  createElement('span', { 'data-upgrade': `${upgrade.from}:${upgrade.to}` }) }));

const now = new Date('2026-10-12T10:00:00Z');
type Action = Parameters<AbyssDispatch>[0];
function advance(profile: ProfileState, action: Action): ProfileState {
  const plan = planAbyssAction(profile, { ...action, expectedToken: abyssStateToken(profile) }, now);
  if ('rejected' in plan) throw new Error(plan.rejected);
  return applyEconomyTransaction(profile, plan.transaction).profile;
}
let host: HTMLDivElement, root: Root, profile: ProfileState, dispatch: ReturnType<typeof vi.fn<AbyssDispatch>>;
let busy = false, settling = false;
const home = vi.fn(), battle = vi.fn();
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label || node.querySelector('strong')?.textContent === label)!;
const hit = (id: string) => [...host.querySelectorAll<HTMLElement>('mesh')].find(node => node.getAttribute('name') === `hit:${id}`)!;
function draw() {
  root.render(createElement(AbyssPreparationScene, { run: profile.abyss.run!, busy, settling, dispatch, onBattle: battle, onHome: home, notice: '', memory: false,
    children: settling ? createElement('p', null, '结算中') : null }));
}
async function render() { await act(async () => draw()); }
async function click(node: HTMLElement) { await act(async () => node.click()); }
function camp(option: AbyssGrowthOption) {
  for (const action of [{ kind: 'chooseStarter', index: 0 }, { kind: 'chooseBoon', index: 0 }, { kind: 'beginBattle' }] as const) profile = advance(profile, action);
  const current = profile.abyss.run!.stage;
  if (current.kind !== 'inBattle') throw new Error('not battle');
  profile = advance(profile, { kind: 'settle', battleId: current.battle.battleId, outcome: { kind: 'win', winner: 'player', reason: 'hpDepleted' } });
  const run = profile.abyss.run!, stage = run.stage;
  if (stage.kind !== 'camp' || !stage.offer) throw new Error('not camp');
  profile = { ...profile, abyss: { ...profile.abyss, run: { ...run, stage: { ...stage, offer: { ...stage.offer, options: [option] } } } } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  busy = false; settling = false; gpu.drag = null; home.mockClear(); battle.mockClear();
  profile = advance(createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261012', starterCardIds: [], now }), { kind: 'start' });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  dispatch = vi.fn<AbyssDispatch>(async action => { profile = advance(profile, action); draw(); return true; });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('深渊实体选择盘面', () => {
  it('三组共18张实体卡，各自有选择按钮，相机锁定并保留战斗槽；保存后进入契约', async () => {
    await render();
    expect(host.querySelectorAll('[data-card-id]')).toHaveLength(18);
    expect(gpu.board).toMatchObject({ cameraRig: false, showSlotMarkers: true });
    for (const n of [1, 2, 3]) expect(button(`选择卡组 ${n}`)).toBeDefined();
    await click(button('选择卡组 2'));
    expect(profile.abyss.run!.stage.kind).toBe('boonChoice');
    expect(host.querySelectorAll('[data-card-id]')).toHaveLength(6);
    expect(button('接受契约 1')).toBeDefined();
    expect(battle).not.toHaveBeenCalled();
    await click(button('接受契约 1'));
    expect(profile.abyss.run!.stage.kind).toBe('battleReady');
    expect(battle).toHaveBeenCalledTimes(1);
  });
  it('保存失败停留原选择，重复点击只提交一次，允许重试', async () => {
    let resolve!: (value: boolean) => void;
    dispatch.mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
    await render();
    const select = button('选择卡组 1');
    await act(async () => { select.click(); select.click(); });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(button('保存退出').disabled).toBe(true);
    await act(async () => resolve(false));
    expect(profile.abyss.run!.stage.kind).toBe('starterDraft');
    expect(host.textContent).toContain('选择未保存');
    expect(button('选择卡组 1').disabled).toBe(false);
  });
  it('点击加成再点击己方卡，保留其余卡并完成属性升级', async () => {
    camp({ kind: 'hp', amount: 2, label: '生命+2' });
    const run = profile.abyss.run!, target = run.cards[0]!, oldHp = target.definition.hp;
    if (run.stage.kind !== 'camp') throw new Error('not camp');
    await render(); await click(hit(`${run.stage.offer!.id}:0`)); await click(hit(target.instanceId));
    expect(profile.abyss.run!.cards[0]!.definition.hp).toBe(oldHp + 2);
    expect(profile.abyss.run!.cards.slice(1)).toEqual(run.cards.slice(1));
    expect(profile.abyss.run!.stage).toMatchObject({ kind: 'camp', offer: null, freeRemaining: 0 });
    expect(host.querySelector('[data-upgrade]')).not.toBeNull();
    expect(button('进入下一局').disabled).toBe(true);
    expect(button('保存退出').disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(1999));
    expect(button('进入下一局').disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(1));
    expect(host.querySelector('[data-upgrade]')).toBeNull();
    expect(button('进入下一局').disabled).toBe(false);
    expect(home).not.toHaveBeenCalled();
  });
  it('有效拖放升级；拖出盘面或取消不消耗奖励', async () => {
    camp({ kind: 'atk', amount: 1, label: '攻击+1' });
    await render();
    const target = profile.abyss.run!.cards[0]!, oldAtk = target.definition.atk;
    const drag = { index: 0, pointerId: 1, startClient: [0, 0] as const, position: [0, .65, 4.45] as const, targetId: target.instanceId, moved: true };
    await act(async () => gpu.drag!.onDrop({ ...drag, targetId: null }, false));
    await act(async () => gpu.drag!.onDrop(drag, true));
    expect(dispatch).not.toHaveBeenCalled();
    await act(async () => gpu.drag!.onDrop(drag, false));
    expect(profile.abyss.run!.cards[0]!.definition.atk).toBe(oldAtk + 1);
  });
  it('覆盖特性先提示；取消不扣资源，确认仅扣一枚结晶', async () => {
    const old = ABYSS_GROWTH_TRAITS[0]!, next = ABYSS_GROWTH_TRAITS.find(trait => trait.family !== old.family)!;
    camp({ kind: 'trait', label: next.raw, trait: next });
    const run = profile.abyss.run!, index = run.cards.findIndex(card => !card.baseDefinition.skills.some(trait => trait.family === old.family || trait.family === next.family));
    expect(index).toBeGreaterThanOrEqual(0);
    const target = run.cards[index]!;
    profile = { ...profile, abyss: { ...profile.abyss, run: { ...run, crystals: 1, cards: run.cards.map(card => card.instanceId !== target.instanceId ? card : {
      ...card, addedTraits: [old], definition: { ...card.definition, rawTraits: [...card.baseDefinition.rawTraits, old.raw], skills: [...card.baseDefinition.skills, old] },
    }) } } };
    if (run.stage.kind !== 'camp') throw new Error('not camp');
    await render();
    expect(host.querySelector('.abyss-party-badge')?.textContent).toContain(old.raw);
    await click(hit(`${run.stage.offer!.id}:0`)); await click(hit(target.instanceId));
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('花费1枚');
    expect(dispatch).not.toHaveBeenCalled();
    await click(button('取消')); expect(profile.abyss.run!.crystals).toBe(1);
    await click(hit(target.instanceId)); await click(button('确认消耗1结晶并覆盖'));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ confirmReplace: true }));
    expect(profile.abyss.run!.crystals).toBe(0);
    expect(profile.abyss.run!.cards[index]!.addedTraits).toEqual([next]);
  });
  it('下一局先淡出整备，再显示普通到困难的实际关卡，标题结束才开放三组接受按钮', async () => {
    camp({ kind: 'atk', amount: 1, label: '攻击+1' });
    for (const action of [{ kind: 'skipFree' }, { kind: 'next' }, { kind: 'chooseBoon', index: 0 }, { kind: 'beginBattle' }] as const) profile = advance(profile, action);
    const stage = profile.abyss.run!.stage;
    if (stage.kind !== 'inBattle') throw new Error('not battle');
    profile = advance(profile, { kind: 'settle', battleId: stage.battle.battleId, outcome: { kind: 'win', winner: 'player', reason: 'hpDepleted' } });
    profile = advance(profile, { kind: 'skipFree' });
    await render(); await click(button('进入下一局'));
    expect(host.querySelector('.abyss-choice-scene')?.getAttribute('data-transition')).toBe('out');
    await act(async () => vi.advanceTimersByTime(450));
    expect(host.querySelector('.abyss-encounter-banner')?.textContent).toContain('普通 1-2');
    expect(host.querySelector('.abyss-encounter-banner')?.textContent).toContain('困难 1-3');
    expect(host.querySelector('.abyss-contract-actions')).toBeNull();
    await act(async () => vi.advanceTimersByTime(1700));
    expect(host.querySelector('.abyss-contract-actions')?.querySelectorAll('button')).toHaveLength(3);
    for (const index of [1, 2, 3]) expect(button(`接受契约 ${index}`).disabled).toBe(false);
    expect(home).not.toHaveBeenCalled();
  });

  it('结算阶段清空所有卡牌，仅保留盘面和结算提示', async () => {
    settling = true; await render();
    expect(host.querySelectorAll('[data-card-id]')).toHaveLength(0);
    expect(host.querySelectorAll('mesh')).toHaveLength(0);
    expect(host.textContent).toContain('结算中');
    expect(button('保存退出').disabled).toBe(true);
  });
});
