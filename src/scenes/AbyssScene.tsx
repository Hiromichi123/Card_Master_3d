import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useForegroundTimeout } from '../ui/useForegroundTimeout';
import type { RouteId } from '../app/routes';
import { backgroundUrl } from '../data/assets';
import { AbyssWorld } from '../ui/AbyssWorld';
import { AbyssHome, useAbyssHomePresentation } from '../ui/AbyssHome';
import { AbyssPreparationScene } from './AbyssPreparationScene';
import { isAbyssPreparation } from './abyssPreparation';
import { useSettingsStore } from '../state/settingsStore';
import { AbyssCountdown } from '../ui/AbyssCountdown';
import type { ProfileStore } from '../state/createProfileStore';
import { useProfileStore } from '../state/useProfileStore';
import { abyssStateToken, planAbyssAction } from '../domain/progression/abyssRun';
import type { AbyssEncounter, AbyssRun } from '../domain/progression/abyssTypes';
import { AbyssRunPanel, type AbyssDispatch } from '../ui/AbyssRunPanel';
import { AbyssHistoryDialog, AbyssTraitsDialog } from '../ui/AbyssRecords';
import { AbyssBattleScene } from './AbyssBattleScene';
import { CardTipHost } from '../ui/CardTipHost';
import { ToastHost } from '../ui/ToastHost';
import { hideCardTip } from '../state/cardTipStore';
import { useBackgroundMemory } from '../ui/SceneBackground';
import {
  ABYSS_BLACK_MS, ABYSS_DARKEN_MS, ABYSS_FLASH_MS, ABYSS_LIGHTNING_INTERVAL_MS,
  ABYSS_LOAD_TIMEOUT_MS, ABYSS_REVEAL_MS, ABYSS_HUD_DELAY_MS, abyssFlashIntensity,
  ABYSS_REVEAL_FLASH_DELAY_MS, ABYSS_STILL_DARKEN_MS, ABYSS_STILL_REVEAL_MS,
} from './abyssPresentation';
import '../ui/abyss.css';

type Phase = 'darkening' | 'black' | 'reveal' | 'active' | 'error';

export function AbyssScene({ onNavigate, store = null, preDarkened = false }: {
  readonly onNavigate: (route: RouteId) => void;
  readonly store?: ProfileStore | null;
  readonly preDarkened?: boolean;
}) {
  const snapshot = useProfileStore(store);
  const profile = snapshot.profile;
  const [hudReady, setHudReady] = useState(false);
  const [panel, setPanel] = useState<'home' | 'run' | 'traits' | 'history'>('home');
  const [notice, setNotice] = useState('');
  const [battleView, setBattleView] = useState<{ run: AbyssRun; battle: AbyssEncounter } | null>(null);
  const preparing = panel === 'run' && isAbyssPreparation(profile?.abyss.run);
  const exiting = useRef<() => void>(() => {});
  const dispatch: AbyssDispatch = async action => {
    if (!store || !profile) return false;
    const expectedToken = abyssStateToken(profile);
    const now = Date.now();
    const result = await store.commitEconomic(current => planAbyssAction(current, { ...action, expectedToken }, now));
    setNotice(result.ok ? '' : result.message);
    if (result.ok && !result.view.run) setPanel('history');
    return result.ok;
  };
  const start = async () => {
    const confirmAbandon = !!profile?.abyss.run;
    if (confirmAbandon && !window.confirm('已有进行中的挑战。开启新一轮会放弃旧进度并记录到游玩历史，确定继续？')) return;
    if (await dispatch({ kind: 'start', confirmAbandon })) setPanel('run');
  };
  const enterBattle = async () => {
    if (!store) return;
    const run = store.getSnapshot().profile?.abyss.run;
    if (!run) return;
    if (run.stage.kind === 'battleReady' && !await dispatch({ kind: 'beginBattle' })) return;
    const latest = store.getSnapshot().profile?.abyss.run;
    if (latest?.stage.kind === 'inBattle') { hideCardTip(); setBattleView({ run: latest, battle: latest.stage.battle }); }
  };
  exiting.current = () => {
    if (battleView || preparing || snapshot.busy) return;
    if (panel !== 'home') { hideCardTip(); setPanel('home'); }
    else onNavigate('activity');
  };
  const memory = useBackgroundMemory();
  const previous = useRef(memory.current ?? backgroundUrl('bg/activity_abyss'));
  const target = backgroundUrl('bg/activity_abyss_bg2');
  // 深渊只服从游戏内的手动设置，不让Windows动画偏好静默停掉演出。
  const still = useSettingsStore(state => state.reduceMotion);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [phase, setPhase] = useState<Phase>(preDarkened ? 'black' : 'darkening');
  const [loaded, setLoaded] = useState(false);
  const [blackHeld, setBlackHeld] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const lightning = useRef<HTMLDivElement>(null);
  const flash = useRef(0);
  useForegroundTimeout(phase === 'active', ABYSS_HUD_DELAY_MS, () => setHudReady(true));

  useEffect(() => {
    const visibility = () => setVisible(!document.hidden);
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { exiting.current(); }
    };
    root.current?.focus({ preventScroll: true });
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('keydown', keyboard);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let settled = false;
    const image = new Image();
    const fail = () => {
      if (cancelled || settled) return;
      settled = true;
      window.clearTimeout(timeout);
      setError('深渊背景暂时无法载入，请重试。'); setPhase('error');
    };
    const timeout = window.setTimeout(fail, ABYSS_LOAD_TIMEOUT_MS);
    const ready = async () => {
      try {
        if (typeof image.decode === 'function') await image.decode();
        if (cancelled || settled) return;
        if (!image.naturalWidth) { fail(); return; }
        settled = true;
        window.clearTimeout(timeout);
        setLoaded(true);
      } catch { fail(); }
    };
    image.onload = () => { void ready(); };
    image.onerror = fail;
    if (target) {
      image.src = target;
      if (image.complete && image.naturalWidth > 0) void ready();
    } else fail();
    return () => {
      cancelled = true; window.clearTimeout(timeout);
      image.onload = image.onerror = null;
    };
  }, [attempt, target]);

  useForegroundTimeout(phase === 'darkening', still ? ABYSS_STILL_DARKEN_MS : ABYSS_DARKEN_MS, () => setPhase('black'));
  useForegroundTimeout(phase === 'black', still ? 0 : ABYSS_BLACK_MS, () => setBlackHeld(true), attempt);
  useEffect(() => {
    if (phase === 'black' && blackHeld && loaded && visible) setPhase('reveal');
  }, [phase, blackHeld, loaded, visible]);
  useForegroundTimeout(phase === 'reveal', still ? ABYSS_STILL_REVEAL_MS : ABYSS_REVEAL_MS, () => {
    memory.current = target;
    setPhase('active');
  });
  const [revealFlashReady, setRevealFlashReady] = useState(false);
  const revealFlashed = useRef(false);
  useForegroundTimeout(phase === 'reveal' && !still, ABYSS_REVEAL_FLASH_DELAY_MS, () => setRevealFlashReady(true));

  // 闪电层与云雾读同一个强度；空闲15秒不跑本段rAF，后台不累积补闪。
  useEffect(() => {
    if (battleView || preparing || still || !visible || (phase !== 'active' && phase !== 'reveal')) {
      flash.current = 0;
      lightning.current?.style.setProperty('--flash', '0');
      return;
    }
    let timer = 0, frame = 0;
    const pulse = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const elapsed = now - start;
        flash.current = abyssFlashIntensity(elapsed);
        lightning.current?.style.setProperty('--flash', String(flash.current));
        if (elapsed < ABYSS_FLASH_MS) frame = requestAnimationFrame(tick);
        else if (phase === 'active') timer = window.setTimeout(pulse, ABYSS_LIGHTNING_INTERVAL_MS - ABYSS_FLASH_MS);
      };
      frame = requestAnimationFrame(tick);
    };
    if (phase === 'reveal') {
      if (revealFlashReady && !revealFlashed.current) { revealFlashed.current = true; pulse(); }
    } else timer = window.setTimeout(pulse, ABYSS_LIGHTNING_INTERVAL_MS);
    return () => {
      window.clearTimeout(timer); cancelAnimationFrame(frame);
      flash.current = 0; lightning.current?.style.setProperty('--flash', '0');
    };
  }, [phase, still, visible, battleView, preparing, revealFlashReady]);

  const homePresentation = useAbyssHomePresentation(still, phase === 'active' && hudReady && panel !== 'run' && !battleView);
  const revealed = phase === 'reveal' || phase === 'active';
  const retry = () => {
    setLoaded(false); setBlackHeld(false); setError('');
    setRevealFlashReady(false); revealFlashed.current = false;
    setPhase('black'); setAttempt(value => value + 1);
  };
  if (battleView && store) return <><AbyssBattleScene key={battleView.battle.battleId} {...battleView} store={store}
    onReturn={() => { hideCardTip(); setBattleView(null); setPanel(store.getSnapshot().profile?.abyss.run ? 'run' : 'history'); }} />
    <ToastHost /><CardTipHost /></>;
  if (preparing && profile?.abyss.run) return <><AbyssPreparationScene key={profile.abyss.run.id}
    run={profile.abyss.run} busy={snapshot.busy} dispatch={dispatch} notice={notice} memory={snapshot.storage === 'memory'}
    onBattle={() => { void enterBattle(); }} onHome={() => { hideCardTip(); setPanel('home'); }} />
    <ToastHost /><CardTipHost /></>;
  return <div ref={root} className="abyss-scene" data-phase={phase} data-still={still} data-visible={visible} tabIndex={-1} aria-label="深渊模式"
    style={{ '--abyss-darken-ms': `${still ? ABYSS_STILL_DARKEN_MS : ABYSS_DARKEN_MS}ms`,
      '--abyss-reveal-ms': `${still ? ABYSS_STILL_REVEAL_MS : ABYSS_REVEAL_MS}ms` } as CSSProperties}>
    {!preDarkened && <div className="abyss-scene__previous" aria-hidden="true" style={{ backgroundImage: previous.current ? `url("${previous.current}")` : undefined }} />}
    {loaded && target && <AbyssWorld backgroundUrl={target} revealed={revealed} active={visible} still={still} flash={flash} />}
    <div className="abyss-scene__black" aria-hidden="true" />
    <div ref={lightning} className="abyss-scene__lightning" aria-hidden="true">
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="none"><g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M190-10 245 105 208 150 330 255 283 310 466 395 438 452 610 470M245 105l93 19 30 86M330 255l-108 28-19 86" />
        <path d="m1430-10-107 160 42 47-122 109 39 49-167 73 27 54-139 43m240-219 116 15 47 82m-190 69 106 73-4 91" />
        <path d="m175 1020 115-163-23-66 130-82-18-54 184-57m-273 259-94-20-22-64" />
      </g></svg>
    </div>
    {phase === 'active' && hudReady && <div className="abyss-scene__hud">
      {panel === 'run' ? <div className="abyss-scene__countdown"><AbyssCountdown /></div> : <AbyssHome
        presentation={homePresentation} still={still} busy={snapshot.busy} available={!!profile} run={profile?.abyss.run ?? null}
        onStart={() => { void start(); }} onContinue={() => setPanel('run')} onTraits={() => setPanel('traits')} onHistory={() => setPanel('history')} />}
      {panel === 'run' && profile?.abyss.run && <AbyssRunPanel run={profile.abyss.run} busy={snapshot.busy} dispatch={dispatch}
        onBattle={() => { void enterBattle(); }} onHome={() => { hideCardTip(); setPanel('home'); }} />}
      {panel !== 'run' && <nav className="abyss-scene__back" aria-label="深渊导航">
        <button type="button" disabled={snapshot.busy} onClick={() => onNavigate('activity')}>返回活动</button>
        <button type="button" disabled={snapshot.busy} onClick={() => onNavigate('hub')}>主界面</button>
      </nav>}
      {snapshot.storage === 'memory' && profile && <p className="abyss-storage-warning" role="status">当前使用内存存档，刷新或关闭页面会丢失深渊进度。</p>}
      {notice && <p className="abyss-notice" role="alert">{notice}</p>}
      {profile && panel === 'traits' && <AbyssTraitsDialog state={profile.abyss} onClose={() => { hideCardTip(); setPanel('home'); }} />}
      {profile && panel === 'history' && <AbyssHistoryDialog state={profile.abyss} onClose={() => { hideCardTip(); setPanel('home'); }} />}
      <ToastHost /><CardTipHost />
    </div>}
    {phase === 'error' && <section className="abyss-scene__error" role="alert">
      <h1>深渊之门未能开启</h1><p>{error}</p>
      <button type="button" onClick={retry}>重试</button>
      <button type="button" onClick={() => onNavigate('activity')}>返回活动</button>
    </section>}
    <span className="abyss-scene__sr" role="status">{phase === 'active' ? '已进入深渊' : phase === 'error' ? '背景加载失败' : '正在进入深渊，按Escape返回活动'}</span>
  </div>;
}
