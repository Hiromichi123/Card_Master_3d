import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { CARD_BACK_URL, cardFaceUrlForDefinition } from '../data/assets';
import type { AbyssCard, AbyssRun } from '../domain/progression/abyssTypes';
import { BattleCanvas } from '../rendering/battle/BattleCanvas';
import { BattleBoard } from '../rendering/battle/BattleBoard';
import { useSettingsStore } from '../state/settingsStore';
import { AbyssRunPanel, type AbyssDispatch } from '../ui/AbyssRunPanel';
import { hideCardTip, moveCardTip, showCardTip } from '../state/cardTipStore';
import { WebGLGuard } from './WebGLGuard';
import { ABYSS_COLLECT_MS, ABYSS_COLLECT_STAGGER_MS, ABYSS_COLLECT_TOTAL_MS, projectAbyssPile } from './abyssPreparation';
import '../ui/abyssPreparation.css';

type Destination = { x: number; y: number };
interface Flight { readonly card: AbyssCard; readonly rect: DOMRect }

function PileProjection({ destination }: { readonly destination: RefObject<Destination | null> }) {
  const { camera, gl } = useThree();
  useFrame(() => {
    const rect = gl.domElement.getBoundingClientRect();
    if (rect.width && rect.height) destination.current = projectAbyssPile(camera, rect);
  });
  useEffect(() => () => { destination.current = null; }, [destination]);
  return null;
}

function CollectCards({ flights, destination, still, onCount, onDone }: {
  readonly flights: readonly Flight[];
  readonly destination: RefObject<Destination | null>;
  readonly still: boolean;
  readonly onCount: (count: number) => void;
  readonly onDone: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onCount, onDone });
  callbacks.current = { onCount, onDone };
  useEffect(() => {
    if (still || !destination.current) { callbacks.current.onCount(6); callbacks.current.onDone(); return; }
    let elapsed = 0, last = 0, arrived = 0, raf = 0;
    const tick = (now: number) => {
      if (document.hidden) { last = 0; raf = requestAnimationFrame(tick); return; }
      if (last) elapsed += Math.min(now - last, 50);
      last = now;
      const target = destination.current;
      if (!target) { callbacks.current.onCount(6); callbacks.current.onDone(); return; }
      let count = 0;
      flights.forEach((flight, index) => {
        const progress = Math.max(0, Math.min(1, (elapsed - index * ABYSS_COLLECT_STAGGER_MS) / ABYSS_COLLECT_MS));
        const ease = progress * progress * (3 - 2 * progress);
        const node = root.current?.children[index] as HTMLElement | undefined;
        if (node) {
          const dx = target.x - (flight.rect.left + flight.rect.width / 2);
          const dy = target.y - (flight.rect.top + flight.rect.height / 2);
          node.style.transform = `translate(${dx * ease}px, ${dy * ease - Math.sin(progress * Math.PI) * 45}px) scale(${1 - .78 * ease}) rotateY(${180 * ease}deg)`;
          node.style.visibility = progress === 1 ? 'hidden' : 'visible';
        }
        if (progress === 1) count++;
      });
      if (count !== arrived) { arrived = count; callbacks.current.onCount(count); }
      if (elapsed >= ABYSS_COLLECT_TOTAL_MS) callbacks.current.onDone();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flights, destination, still]);
  return <div ref={root} className="abyss-collect" aria-hidden="true">{flights.map(({ card, rect }) => <div
    className="abyss-collect__card" key={card.instanceId} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
    <img className="abyss-collect__front" src={cardFaceUrlForDefinition(card.definition, 'battle') ?? undefined} alt="" />
    <img className="abyss-collect__back" src={CARD_BACK_URL} alt="" />
  </div>)}</div>;
}

/**
 * 起始选组的小卡面。
 *
 * **只挂简介，不改版面**：选组是整组按钮（点一下选的是六张），所以卡面自己不带点击，
 * 只把悬停/停留时的简介接到全局那层 `CardTipHost` 上（`AbyssScene` 已经挂了它）。
 * 简介里带的是**本轮定义**（`card.definition`），不是烘焙在卡图上的文字。
 */
function DraftCardFace({ card }: { readonly card: AbyssCard }) {
  const ownerKey = `abyss-draft:${card.instanceId}`;
  useEffect(() => () => hideCardTip(ownerKey), [ownerKey]);
  const tip = (element: HTMLElement) => showCardTip(card.instanceId, element.getBoundingClientRect(), {
    card: card.definition, ownerKey, ownerElement: element,
  });
  return <img src={cardFaceUrlForDefinition(card.definition, 'battle') ?? undefined} alt={card.definition.name}
    draggable={false} onPointerEnter={event => tip(event.currentTarget)}
    onPointerMove={event => moveCardTip(event.clientX, event.clientY)}
    onPointerLeave={() => hideCardTip(ownerKey)} />;
}

/** 同一run跨starterDraft/boonChoice保持挂载；领域落盘与收牌动画互不依赖。 */
export function AbyssPreparationScene({ run, busy, dispatch, onBattle, onHome, notice, memory }: {
  readonly run: AbyssRun;
  readonly busy: boolean;
  readonly dispatch: AbyssDispatch;
  readonly onBattle: () => void;
  readonly onHome: () => void;
  readonly notice: string;
  readonly memory: boolean;
}) {
  const still = useSettingsStore(state => state.reduceMotion);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<'idle' | 'saving' | 'collecting'>('idle');
  const [flights, setFlights] = useState<readonly Flight[]>([]);
  const [collected, setCollected] = useState(0);
  const [degraded, setDegraded] = useState(false);
  const [saveError, setSaveError] = useState('');
  const lock = useRef(false);
  const alive = useRef(true);
  const destination = useRef<Destination | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ busy, onHome });
  latest.current = { busy, onHome };
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const locked = busy || mode !== 'idle';
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (!lock.current && !latest.current.busy) latest.current.onHome();
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, []);
  useEffect(() => {
    if (mode === 'idle') root.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [mode, run.stage.kind]);
  const choose = async () => {
    if (lock.current || busy || selected === null || run.stage.kind !== 'starterDraft') return;
    const choice = run.stage.choices[selected];
    if (!choice) return;
    lock.current = true;
    const nodes = root.current?.querySelectorAll<HTMLElement>(`[data-deck-index="${selected}"] img`);
    const snapshot = choice.cards.map((card, index) => ({ card, rect: nodes?.[index]?.getBoundingClientRect() ?? new DOMRect() }));
    setSaveError(''); setFlights(snapshot); setMode('saving');
    let ok = false;
    try { ok = await dispatch({ kind: 'chooseStarter', index: selected }); }
    catch { if (alive.current) setSaveError('卡组保存失败，请重试。'); }
    finally {
      if (alive.current) {
        if (ok) {
          setDegraded(!destination.current && !still);
          setMode('collecting');
        } else { lock.current = false; setMode('idle'); setFlights([]); }
      }
    }
  };
  const count = mode !== 'idle' ? collected : run.cards.length;
  return <div ref={root} className="abyss-scene abyss-preparation" data-stage={run.stage.kind} data-collecting={mode === 'collecting'}
    aria-label="深渊战前盘面" onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const nodes = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const first = nodes[0], last = nodes.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
    <div className="scene-viewport"><WebGLGuard fallback={<p className="abyss-preparation__fallback" role="status">3D盘面不可用。仍可保存选组，收牌演出将跳过；请启用WebGL2后继续实战。</p>}>
      <BattleCanvas themeId="abyss">
        <BattleBoard dragActive piles={[
          { side: 'player', kind: 'deck', count, topCard: null, totalCount: run.cards.length || 6 },
          { side: 'enemy', kind: 'deck', count: 'battle' in run.stage ? run.stage.battle.enemyCards.length : 0, topCard: null },
        ]} />
        <PileProjection destination={destination} />
      </BattleCanvas>
    </WebGLGuard></div>
    {(run.stage.kind === 'starterDraft' || mode === 'saving') && <section className="abyss-draft" role="dialog" aria-modal="true" aria-label="选择起始卡组" aria-busy={locked}>
      <div className="abyss-draft__choices">{run.stage.kind === 'starterDraft' && run.stage.choices.map((choice, index) => <button
        type="button" key={choice.id} data-deck-index={index} className="abyss-draft__choice"
        aria-label={`卡组${index + 1}`}
        aria-pressed={selected === index} disabled={locked} onClick={() => setSelected(index)}>
        <strong>卡组{index + 1}</strong><span className="abyss-draft__cards">{choice.cards.map(card =>
          <DraftCardFace key={card.instanceId} card={card} />)}</span>
      </button>)}</div>
      <footer><button type="button" disabled={locked} onClick={onHome}>返回深渊大厅</button>
        <button type="button" disabled={locked || selected === null} onClick={() => { void choose(); }}>{mode === 'saving' ? '保存中…' : '确认'}</button></footer>
    </section>}
    {mode === 'collecting' && <><p className="abyss-preparation__collecting" role="status">卡组收入己方卡堆 · {collected}/6</p>
      <CollectCards flights={flights} destination={destination} still={still} onCount={setCollected} onDone={() => {
        lock.current = false; setMode('idle'); setFlights([]);
      }} /></>}
    {mode === 'idle' && run.stage.kind !== 'starterDraft' && <AbyssRunPanel preparation run={run} busy={busy} dispatch={dispatch}
      onBattle={onBattle} onHome={onHome} />}
    {degraded && <span className="abyss-preparation__fallback" role="status">收牌动画已跳过，选中卡组已保存。</span>}
    {memory && <p className="abyss-storage-warning" role="status">当前使用内存存档，刷新或关闭页面会丢失深渊进度。</p>}
    {(saveError || notice) && <p className="abyss-notice" role="alert">{saveError || notice}</p>}
  </div>;
}
