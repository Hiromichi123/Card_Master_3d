import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
import { LeaderboardModal } from '../ui/LeaderboardModal';
import { AbyssRulesDialog } from '../ui/AbyssRulesDialog';
import { AbyssHistoryDialog, AbyssTraitsDialog } from '../ui/AbyssRecords';
import { AbyssBattleScene, AbyssSettlement } from './AbyssBattleScene';
import type { BattleOutcome } from '../domain/battle/types';
import { CardTipHost } from '../ui/CardTipHost';
import { ToastHost } from '../ui/ToastHost';
import { hideCardTip } from '../state/cardTipStore';
import { useBackgroundMemory } from '../ui/SceneBackground';
import {
  ABYSS_BLACK_MS, ABYSS_DARKEN_MS, ABYSS_FLASH_MS, ABYSS_LIGHTNING_INTERVAL_MS,
  ABYSS_LOAD_TIMEOUT_MS, ABYSS_REVEAL_MS, ABYSS_HUD_DELAY_MS, abyssFlashIntensity,
  ABYSS_REVEAL_FLASH_DELAY_MS, ABYSS_STILL_DARKEN_MS, ABYSS_STILL_REVEAL_MS,
} from './abyssPresentation';
import { AbyssWeeklyRewards, AbyssRewardPacks } from '../ui/AbyssRewards';
import { abyssPendingPacks, abyssCompletionCount, abyssCompletionTier, ABYSS_COMPLETION_REWARDS } from '../domain/progression/abyssRewards';
import { AbyssTableSurfaceProvider } from './AbyssTableSurface';
import { useSharedBattleSurface } from '../rendering/battle/SharedBattleSurfaceContext';
import '../ui/abyss.css';
import '../ui/abyssButtons.css';
import '../ui/abyssFloating.css';

type Phase = 'darkening' | 'black' | 'reveal' | 'active' | 'error';

export function AbyssScene(props: Parameters<typeof AbyssSceneContent>[0]) {
  return <AbyssTableSurfaceProvider><AbyssSceneContent {...props} /></AbyssTableSurfaceProvider>;
}

function AbyssSceneContent({ onNavigate, store = null, preDarkened = false, playerName = '当前玩家' }: {
  readonly onNavigate: (route: RouteId) => void;
  readonly store?: ProfileStore | null;
  readonly preDarkened?: boolean;
  readonly playerName?: string;
}) {
  const sharedSurface = useSharedBattleSurface();
  const snapshot = useProfileStore(store);
  const profile = snapshot.profile;
  const [hudReady, setHudReady] = useState(false);
  const [panel, setPanel] = useState<'home' | 'run' | 'traits' | 'history'>('home');
  const [notice, setNotice] = useState('');
  const [startingBattle, setStartingBattle] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rankingOpen, setRankingOpen] = useState(false);
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const [packsOpen, setPacksOpen] = useState(false);
  const [battleView, setBattleView] = useState<{ run: AbyssRun; battle: AbyssEncounter } | null>(null);
  const [pendingSettlement, setPendingSettlement] = useState<{ battleId: string; outcome: BattleOutcome; run: AbyssRun } | null>(null);
  // Retain the final table snapshot until settlement finishes, including terminal runs.
  const rememberedRun = useRef<AbyssRun | null>(null);
  if (profile?.abyss.run) rememberedRun.current = profile.abyss.run;
  const preparationRun = profile?.abyss.run ?? pendingSettlement?.run ?? rememberedRun.current;
  const completedRecord = profile?.abyss.history.find(entry => entry.runId === preparationRun?.id);
  const boardRun = useMemo(() => {
    if (!preparationRun || profile?.abyss.run || !completedRecord) return preparationRun;
    return { ...preparationRun, cards: completedRecord.cards, coins: completedRecord.coins,
      earnedCoins: completedRecord.earnedCoins, crystals: completedRecord.crystals ?? 0,
      wins: completedRecord.wins, losses: completedRecord.losses };
  }, [preparationRun, profile?.abyss.run, completedRecord]);
  const preparing = panel === 'run' && (startingBattle || !!pendingSettlement || isAbyssPreparation(boardRun));
  useLayoutEffect(() => { sharedSurface?.setEnabled(panel === 'run'); }, [sharedSurface, panel]);
  const exiting = useRef<() => void>(() => {});
  const dispatch: AbyssDispatch = async action => {
    if (!store || !profile) return false;
    const expectedToken = abyssStateToken(profile);
    const now = Date.now();
    const autoBattle = action.kind === 'chooseBoon';
    if (autoBattle) setStartingBattle(true);
    try {
      const result = await store.commitEconomic(current => planAbyssAction(current, { ...action, expectedToken }, now));
      const claim = result.ok && (result.view.completionClaims?.length ?? 0) > (profile.abyss.completionClaims?.length ?? 0) ? result.view.completionClaims?.at(-1) : null;
      setNotice(result.ok ? claim ? `通关结算：金币+${claim.gold}，水晶+${claim.crystal}，五选三卡包已保存。` : '' : result.message);
      if (autoBattle && !result.ok) setStartingBattle(false);
      if (result.ok && profile.abyss.run && !result.view.run) setPanel('run');
      return result.ok;
    } catch (error) {
      if (autoBattle) setStartingBattle(false);
      throw error;
    }
  };
  const start = async () => {
    const confirmAbandon = !!profile?.abyss.run;
    if (confirmAbandon && !window.confirm('已有进行中的挑战。开启新一轮会放弃旧进度并记录到游玩历史，确定继续？')) return;
    if (await dispatch({ kind: 'start', confirmAbandon })) setPanel('run');
  };
  const enterBattle = async () => {
    if (!store) { setStartingBattle(false); return; }
    setStartingBattle(true);
    try {
      const current = store.getSnapshot().profile;
      const run = current?.abyss.run;
      if (!current || !run) return;
      if (run.stage.kind === 'battleReady' || run.stage.kind === 'inBattle') {
        // The boon has just been saved: use its latest token, not a prior render's profile.
        const expectedToken = abyssStateToken(current);
        const result = await store.commitEconomic(profile => planAbyssAction(profile, { kind: run.stage.kind === 'inBattle' ? 'resumeBattle' : 'beginBattle', expectedToken }, Date.now()));
        setNotice(result.ok ? '' : result.message);
        if (!result.ok) return;
      }
      const latest = store.getSnapshot().profile?.abyss.run;
      if (latest?.stage.kind === 'inBattle') { hideCardTip(); setBattleView({ run: latest, battle: latest.stage.battle }); }
    } catch { setNotice('开始战斗保存失败，请重试。'); }
    finally { setStartingBattle(false); }
  };
  exiting.current = () => {
    if (weeklyOpen || packsOpen || rankingOpen || rulesOpen || battleView || pendingSettlement || preparing || snapshot.busy) return;
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

  const homePresentation = useAbyssHomePresentation(still, phase === 'active' && hudReady && panel !== 'run' && !battleView && !pendingSettlement);
  const revealed = phase === 'reveal' || phase === 'active';
  const retry = () => {
    setLoaded(false); setBlackHeld(false); setError('');
    setRevealFlashReady(false); revealFlashed.current = false;
    setPhase('black'); setAttempt(value => value + 1);
  };
  const pendingPackCount = profile ? abyssPendingPacks(profile.abyss).length : 0;
  const openWeekly = async () => { if (await dispatch({ kind: 'prepareWeek' })) setWeeklyOpen(true); };
  const receipt = profile?.abyss.completionClaims?.find(c => c.runId === boardRun?.id);
  const rewardReceipt = receipt ? `通关奖励已到账：金币+${receipt.gold} · 水晶+${receipt.crystal}` :
    profile && boardRun && !profile.abyss.run && completedRecord ? abyssCompletionTier(boardRun) === 0 ? '未通过1-10，本轮没有通关奖励。' :
    '本周两次通关结算额度已用完，本轮成绩已保存。' : undefined;
  const abandon = async () => {
    if (!profile?.abyss.run || snapshot.busy) return;
    const tier = abyssCompletionTier(profile.abyss.run), rule = ABYSS_COMPLETION_REWARDS[tier - 1];
    const paid = profile.abyss.completionClaims?.some(c => c.runId === profile.abyss.run?.id);
    const text = paid ? '本轮已领取通关结算，不重复发奖。' : abyssCompletionCount(profile.abyss, Date.now()) >= 2 ? '本周通关结算额度已用完，不发奖励。' : rule ?
      `按${rule.label}结算：金币${rule.gold[0]}–${rule.gold[1]}、水晶${rule.crystal[0]}–${rule.crystal[1]}和五选三卡包，使用本周一次额度。` : '尚未通过1-10，本次没有通关奖励。';
    if (window.confirm(`放弃本轮并保存成绩？${text}`)) await dispatch({ kind: 'abandon' });
  };
  const rulesDialog = <>
    {weeklyOpen && profile && <AbyssWeeklyRewards state={profile.abyss} busy={snapshot.busy} dispatch={dispatch} onClose={() => setWeeklyOpen(false)} />}
    {packsOpen && profile && <AbyssRewardPacks state={profile.abyss} busy={snapshot.busy} dispatch={dispatch} onClose={() => setPacksOpen(false)} />}{rulesOpen && <AbyssRulesDialog onClose={() => setRulesOpen(false)} />}
    {rankingOpen && profile && <LeaderboardModal profile={profile} playerName={playerName} initialKind="abyss" onClose={() => setRankingOpen(false)} />}</>;
  if (battleView && store) return <><AbyssBattleScene key={battleView.battle.battleId} {...battleView} store={store} onRules={() => setRulesOpen(true)}
    onReturn={(outcome) => {
      hideCardTip();
      if (outcome) setPendingSettlement({ battleId: battleView.battle.battleId, outcome, run: battleView.run });
      setBattleView(null);
      setPanel('run');
    }} />
    {rulesDialog}<ToastHost /><CardTipHost /></>;
  if (preparing && boardRun) return <><AbyssPreparationScene key={boardRun.id}
    run={boardRun} busy={snapshot.busy || startingBattle} dispatch={dispatch} notice={notice} memory={snapshot.storage === 'memory'} settling={!!pendingSettlement}
    onBattle={() => { void enterBattle(); }} onHome={() => { hideCardTip(); setPanel('home'); }} onRules={() => setRulesOpen(true)}
    onRanking={() => setRankingOpen(true)} onRewards={() => setPacksOpen(true)} pendingPacks={pendingPackCount}
    rewardReceipt={rewardReceipt}
    onAbandon={() => { void abandon(); }} ended={!profile?.abyss.run && !pendingSettlement}>
    {pendingSettlement && store && <AbyssSettlement store={store} battleId={pendingSettlement.battleId} outcome={pendingSettlement.outcome} onSaved={() => {
      setPendingSettlement(null);
      setPanel('run');
    }} />}
    </AbyssPreparationScene>
    {rulesDialog}<ToastHost /><CardTipHost /></>;
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
        state={profile?.abyss} onPrepareWeek={() => dispatch({ kind: 'prepareWeek' })} onWeeklyRewards={() => { void openWeekly(); }}
        onStart={() => { void start(); }} onContinue={() => setPanel('run')} onTraits={() => setPanel('traits')} onHistory={() => setPanel('history')} />}
      {pendingSettlement && store && <AbyssSettlement store={store} {...pendingSettlement} onSaved={() => {
        setPendingSettlement(null);
        setPanel('run');
      }} />}
      {!pendingSettlement && panel === 'run' && profile?.abyss.run && <AbyssRunPanel run={profile.abyss.run} busy={snapshot.busy} dispatch={dispatch}
        onBattle={() => { void enterBattle(); }} onHome={() => { hideCardTip(); setPanel('home'); }} onRules={() => setRulesOpen(true)} onRanking={() => setRankingOpen(true)} />}
      {panel !== 'run' && <nav className="abyss-scene__back" aria-label="深渊导航">
        <button type="button" disabled={snapshot.busy} onClick={() => onNavigate('activity')}>返回活动</button>
        <button type="button" disabled={snapshot.busy} onClick={() => onNavigate('hub')}>主界面</button>
        <button type="button" onClick={() => setRulesOpen(true)}>规则讲解</button>
        <button type="button" disabled={!profile} onClick={() => setRankingOpen(true)}>深渊排行</button>
        <button type="button" disabled={!profile || snapshot.busy} onClick={() => { void openWeekly(); }}>本周结算</button>
        <button type="button" disabled={!profile || snapshot.busy || pendingPackCount === 0} onClick={() => setPacksOpen(true)}>奖励卡包（{pendingPackCount}）</button>
      </nav>}
      {snapshot.storage === 'memory' && profile && <p className="abyss-storage-warning" role="status">当前使用内存存档，刷新或关闭页面会丢失深渊进度。</p>}
      {notice && <p className="abyss-notice" role="alert">{notice}</p>}
      {profile && panel === 'traits' && <AbyssTraitsDialog state={profile.abyss} onClose={() => { hideCardTip(); setPanel('home'); }} />}
      {profile && panel === 'history' && <AbyssHistoryDialog state={profile.abyss} onClose={() => { hideCardTip(); setPanel('home'); }} />}
      {rulesDialog}<ToastHost /><CardTipHost />
    </div>}
    {phase === 'error' && <section className="abyss-scene__error" role="alert">
      <h1>深渊之门未能开启</h1><p>{error}</p>
      <button type="button" onClick={retry}>重试</button>
      <button type="button" onClick={() => onNavigate('activity')}>返回活动</button>
    </section>}
    <span className="abyss-scene__sr" role="status">{phase === 'active' ? '已进入深渊' : phase === 'error' ? '背景加载失败' : '正在进入深渊，按Escape返回活动'}</span>
  </div>;
}
