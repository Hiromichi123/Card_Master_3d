import { cardDatabase } from '../data';
import { AiWorkerClient } from '../services/ai/AiWorkerClient';
import { useAiModelStore } from '../state/aiModelStore';
import { normalizeAiSettings } from '../domain/battle/ai/types';
import type { ThreeEvent } from '@react-three/fiber';
import { BattleActorExit } from '../rendering/battle/BattleActorExit';
import { BattleCanvas } from '../rendering/battle/BattleCanvas';
import { BattleVisualContext, useBattleVisuals } from '../rendering/battle/battleVisuals';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { CardDefinition, SideId } from '../domain/cards/types';
import { BattleBoard } from '../rendering/battle/BattleBoard';
import { DealAnimation } from '../rendering/battle/DealAnimation';
import { DepartingCard } from '../rendering/battle/DepartingCard';
import { PresentationDriver } from '../rendering/battle/PresentationDriver';
import { buildBoard, slotPosition, slotKeyFor } from '../rendering/battle/placements';
import { DeploymentDragController, type DeploymentDrag } from '../rendering/battle/DeploymentDragController';
import { BATTLE_CARD_SCALE, type SlotZone } from '../rendering/battle/layout';
import { effectDirector } from '../rendering/effects/effectDirector';
import { audioEngine } from '../services/audio/AudioEngine';
import { backgroundMusic } from '../services/audio/BackgroundMusic';
import { EffectSystem } from '../rendering/effects/EffectSystem';
import { PerfSampler } from '../rendering/PerfSampler';
import { DEMO_CONFIG, demoDefinitions } from '../rendering/presentation/demoBattle';
import type { DefinitionTable } from '../rendering/presentation/demoBattle';
import type { BattleConfig, BattleOutcome } from '../domain/battle/types';
import type { ActivityBattleReport } from '../domain/progression/activityModes';
import type { SettlementView } from '../domain/progression/campaign';
import { BattleSession } from '../rendering/presentation/session';
import { useBattleSession } from '../rendering/presentation/useBattleSession';
import { useSettingsStore } from '../state/settingsStore';
import { BattleHud } from '../ui/BattleHud';
import { BattleMenu } from '../ui/BattleMenu';
import { BattleResultPanel } from '../ui/BattleResultPanel';
import { PerfOverlay } from '../ui/PerfOverlay';

import { WebGLGuard } from './WebGLGuard';

/**
 * 战斗场景。
 *
 * 规则层（`domain/`）与演出层（`rendering/presentation/`）之间只剩这一层粘合：
 * 会话吐出一个显示状态，这里把它铺成桌面与 HUD；输入原样交回会话。
 *
 * **会话活在这个组件之外的对象里**（`useState` 只用来把它挂住一次）。
 * 切到「数据自检」时本组件会卸载，但那一局的权威状态已经由 `applyCommand`
 * 同步算完，所以卸载只丢掉播放位置，丢不掉规则
 * （PLAN 第 4.1 节：切换场景不依赖动画回调完成结算）。
 *
 * 卡牌详情的唯一出口是**全局悬停信息框**（`CardTipHost` + `CardMesh` 的 `hoverTip`）：
 * 鼠标移到牌上就出，移开就收，跟着指针走。
 * 这里**没有**「点一下把详情固定到右上角」那套——战斗桌面上点击已经被
 * 「选牌 / 部署 / 拖拽插入」占满了，再往右上角钉一个面板只会挡住对手那一排牌，
 * 而且和悬停框显示的是同一份内容（`V-CARD-6` 的悬停那一半仍然成立）。
 */
export interface BattleSceneProps {
  readonly clearing?: boolean;
  /** 独立模式只覆盖本次战斗的台面，退出后恢复玩家设置。 */
  readonly tableThemeId?: string | undefined;
  /**
   * 这一局的配置。缺省是 P3 的固定演示对局（主菜单的「演示战斗」）。
   * 战役进来的每一关给的是 `planStageLaunch` 算出来的配置。
   */
  readonly config?: BattleConfig;
  readonly definitions?: DefinitionTable;
  /** 这一关的奖励（战役才有）；结果面板上多显示一段结算明细。 */
  readonly settlement?: SettlementView | null;
  /** 首次进入结果态时回调一次——**结算的提交时机就在这一刻**。 */
  readonly onFinished?: ((outcome: BattleOutcome) => void) | undefined;
  /** 规则终局同步报告，不等待结果演出；独立模式在这里提交存档。 */
  readonly onOutcome?: ((outcome: BattleOutcome) => void) | undefined;
  readonly onReport?: ((report: ActivityBattleReport) => void) | undefined;
  readonly allowRematch?: boolean | undefined;
  /** Local match owner can assign a new persistent identity when replaying. */
  readonly onRematchRequested?: (() => void) | undefined;
  /** 提供时替换默认战役/演示结果面板，仍等演出完成后显示。 */
  readonly resultPanel?: ReactNode;
  readonly exitDisabled?: boolean | undefined;
  readonly leaveLabel?: string | undefined;
  /** 结果面板上的「返回」。缺省回演示菜单。 */
  readonly onExit?: (() => void) | undefined;
  /**
   * 结果面板上那个返回按钮的文案。
   *
   * 缺省按 `onExit` 有没有来猜（战役 / 菜单）——迷宫接进来之后这条猜法不够用：
   * 它也需要 `onExit`，但回去的是地图屏而不是战役。
   */
  readonly exitLabel?: string | undefined;
  readonly localMultiplayer?: boolean | undefined;
  readonly autoEnemy?: boolean | undefined;
  readonly autoStart?: boolean | undefined;
  readonly onLeave?: (() => void) | undefined;
}

export function BattleScene({
  tableThemeId,
  clearing = false,
  config = DEMO_CONFIG,
  definitions,
  settlement = null,
  onFinished,
  onOutcome,
  onReport,
  allowRematch = true,
  onRematchRequested,
  resultPanel,
  exitDisabled = false,
  leaveLabel,
  onExit,
  exitLabel,
  localMultiplayer = false,
  autoEnemy = true,
  autoStart = false,
  onLeave,
}: BattleSceneProps = {}) {
  const visuals = useBattleVisuals(tableThemeId);
  const {profile} = visuals;
  const showPerf = useSettingsStore((state) => state.showPerf);

  const reportCallback = useRef(onReport);
  reportCallback.current = onReport;
  const outcomeCallback = useRef(onOutcome);
  outcomeCallback.current = onOutcome;
  const [session] = useState(
    () =>
      new BattleSession(config, definitions ?? demoDefinitions(), () => useSettingsStore.getState().presentationSpeed, {
        play: (request) => {
          effectDirector.play(request);
        },
        skipAll: () => {
          effectDirector.skipAll();
        },
        // 命中/死亡的音效由导演在演出节点回调；这里只把出口接上
        sound: (cue) => audioEngine.play(cue),
      }, { localMultiplayer, autoEnemy, onReport: (report) => reportCallback.current?.(report), onOutcome: (outcome) => outcomeCallback.current?.(outcome),
        aiDriver:new AiWorkerClient(), aiCatalogue:cardDatabase.definitions,
        readAiSettings:()=>{const s=useSettingsStore.getState();return normalizeAiSettings({difficulty:s.aiDifficulty,style:s.aiStyle,policy:s.aiPolicy});},
        readAiModel:()=>useAiModelStore.getState().model,
        readSkipTurnEnd:()=>useSettingsStore.getState().skipTurnEnd,
      }),
  );
  const snapshot = useBattleSession(session);
  const musicOwner = useRef({});
  useEffect(() => {
    backgroundMusic.beginBattle(musicOwner.current, snapshot.runId);
  }, [snapshot.runId]);
  useEffect(() => {
    const owner = musicOwner.current;
    return () => backgroundMusic.endBattle(owner);
  }, []);
  useEffect(()=>{
    const settings=useSettingsStore.subscribe((next,prev)=>{
      if(next.skipTurnEnd!==prev.skipTurnEnd)session.refreshTurnPreferences();
      if(next.aiDifficulty!==prev.aiDifficulty||next.aiStyle!==prev.aiStyle||next.aiPolicy!==prev.aiPolicy)session.refreshAiPreferences();
    });
    const model=useAiModelStore.subscribe((next,prev)=>{if(next.model!==prev.model)session.refreshAiPreferences();});
    return ()=>{settings();model();};
  },[session]);
  const [deckTotals] = useState(() => ({ player: config.playerDeck.length, enemy: config.enemyDeck.length }));
  useEffect(() => {
    if (autoStart && session.getSnapshot().runId === 0) session.start();
  }, [autoStart, session]);

  /*
    战果上报：**进入结果态的那一刻报一次**，由 `App` 去提交结算事务。
    用 ref 挡住重复上报——结果面板在整个结果态里都是同一个 `outcome`，
    而 React 会因为这个组件里任何其它状态变化重渲染。
  */
  const reportedRef = useRef(false);
  useEffect(() => {
    if (reportedRef.current || !onFinished) {
      return;
    }
    if (snapshot.mode === 'result' && snapshot.outcome) {
      reportedRef.current = true;
      onFinished(snapshot.outcome);
    }
  }, [snapshot.mode, snapshot.outcome, onFinished]);

  useEffect(() => {session.resume();return () => session.dispose();}, [session]);

  /** 开一场新局就播一次发牌动画；播完自己收掉。 */
  const [dealing, setDealing] = useState(false);
  useEffect(() => {
    if (snapshot.runId > 0 && snapshot.mode === 'battle') {
      setDealing(true);
      // 发牌音与发牌动画同一时刻：丢了对规则毫无影响（发牌动画本就纯装饰）
      audioEngine.play('deal');
    }
  }, [snapshot.runId, snapshot.mode]);

  const [drag, setDrag] = useState<DeploymentDrag | null>(null);
  const ignoreClickUntil = useRef(0);
  useEffect(() => { if (!snapshot.inputOpen) setDrag(null); }, [snapshot.inputOpen]);
  const handleDragStart = useCallback((instanceId: string, event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0 || !session.canDragDeploy(instanceId)) return;
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    event.nativeEvent.stopImmediatePropagation();
    session.select(instanceId);
    setDrag({ instanceId, pointerId: event.pointerId, side: session.getSnapshot().inputSide,
      position: [event.point.x, 0.24, event.point.z], insertIndex: null,
      startClient: [event.clientX, event.clientY], moved: false });
  }, [session]);
  const handleDragDrop = useCallback((active: DeploymentDrag, cancel: boolean) => {
    ignoreClickUntil.current = Date.now() + 300;
    setDrag(null);
    if (!cancel && active.insertIndex !== null) session.deployAt(active.instanceId, active.insertIndex);
    else session.select(!cancel && !active.moved ? active.instanceId : null);
  }, [session]);
  const handleDragMove = useCallback((active: DeploymentDrag) => setDrag(active), []);
  const canPlay = snapshot.inputOpen;

  const view = useMemo(
    () => {
      const board = buildBoard(snapshot.display, {
        definitions: session.authoritative.definitions,
        deckTotals,
        selectedInstanceId: snapshot.selectedInstanceId,
        playerCanPlay: canPlay,
        inputSide: snapshot.inputSide,
        handPlayable: snapshot.phase === 'awaitingPlay',
        placeableBattleSlots: snapshot.playableBattleSlots,
        deployableInstanceIds: snapshot.deployableInstanceIds,
        localHands: localMultiplayer,
        placeablePrepSlots: snapshot.playablePrepSlots,
      });
      if (!drag) return board;
      const ownRow = snapshot.display.zones[drag.side].battle;
      return { ...board,
        targeted: drag.insertIndex === null ? board.targeted : new Set([slotKeyFor(drag.side, 'battle', drag.insertIndex)]),
        entries: board.entries.map((entry) => {
          if (entry.instanceId === drag.instanceId) return { ...entry, position: drag.position,
            scale: BATTLE_CARD_SCALE, statLayout: 'battle' as const, dragging: true, flying: false, selected: false };
          const index = ownRow.indexOf(entry.instanceId);
          if (drag.insertIndex !== null && index >= drag.insertIndex) return { ...entry, position: slotPosition(drag.side, 'battle', index + 1) };
          return entry;
        }),
      };
    },
    [snapshot.display, snapshot.selectedInstanceId, canPlay, snapshot.playablePrepSlots, snapshot.playableBattleSlots,
      snapshot.inputSide, snapshot.phase, snapshot.deployableInstanceIds, localMultiplayer, drag, deckTotals, session],
  );

  const handleCardClick = useCallback(
    (_card: CardDefinition, instanceId: string) => {
      if (Date.now() < ignoreClickUntil.current) return;
      const current = session.getSnapshot();
      const index = current.display.zones[current.inputSide].battle.indexOf(instanceId);
      if (current.selectedKind === 'ready' && index >= 0) { session.deploySelectedAt(index); return; }
      // 只有手牌会被会话接受为「待打出的牌」；点场上的卡等于取消选牌。
      // 详情不在这里出：全局悬停信息框已经负责（见类注释）。
      session.select(instanceId);
    },
    [session],
  );

  const handleSlotClick = useCallback(
    (side: SideId, zone: SlotZone, index: number) => {
      if (Date.now() < ignoreClickUntil.current) return;
      if (side !== session.getSnapshot().inputSide) return;
      if (zone === 'battle') { session.deploySelectedAt(index); return; }
      if (zone === 'prep') {
        session.playSelectedAt(index);
      }
    },
    [session],
  );

  return (
    <BattleVisualContext.Provider value={visuals}>
    <WebGLGuard>
      <div className="scene-viewport">
        <BattleCanvas
          onPointerMissed={() => {
            if (drag || Date.now() < ignoreClickUntil.current) return;
            // 点空白处取消选中
            session.select(null);
          }}
        >
          <BattleActorExit clearing={clearing}>
          {/*
            所有靠 useFrame 跑的系统组件都必须排在 <PostEffects> **之前**。
            实测：@react-three/postprocessing 的 EffectComposer 一旦挂载，
            声明在它之后的兄弟组件的 useFrame 订阅不会被注册——
            组件挂载了、画面正常，但回调一次都不触发。
            演出的表现就是「点了结束回合，画面永远停在原地，且零报错」。
          */}
          {/* 开场的发牌动画。key 用 runId，开新局会重新播一遍 */}
          {dealing && (
            <DealAnimation key={snapshot.runId} onDone={() => setDealing(false)} />
          )}

          <PresentationDriver session={session} />
          <DeploymentDragController drag={drag} session={session} onMove={handleDragMove} onDrop={handleDragDrop} />
          <EffectSystem
            capacity={profile.particleCapacity}
            // 战斗区放大到 1.5 倍，特效按同一比例放大才不会显得又小又碎
            worldScale={BATTLE_CARD_SCALE}
          />
          <PerfSampler />

          <BattleBoard
            placements={view.entries}
            piles={view.piles}
            placeable={view.placeable}
            targeted={view.targeted}
            selectedInstanceId={snapshot.selectedInstanceId}
            onCardClick={handleCardClick}
            onSlotClick={handleSlotClick}
            dragActive={drag !== null}
            onCardPointerDown={handleDragStart}
          />

          {snapshot.display.proxies.map((proxy) => (
            <DepartingCard key={proxy.instanceId} proxy={proxy} definitions={session.authoritative.definitions} />
          ))}

          </BattleActorExit>
        </BattleCanvas>

        {snapshot.mode === 'battle' && (
          <BattleHud
            snapshot={snapshot}
            onEndTurn={() => session.endTurn()}
            onConcede={(side) => session.concede(side)}
            onSkipPerformance={() => session.skipPerformance()}
            onAutoEnemyChange={(on) => session.setAutoEnemy(on)}
            exitDisabled={exitDisabled}
            leaveLabel={leaveLabel}
            {...(localMultiplayer && onExit ? { onExit: () => { if (!exitDisabled) onExit(); } } : {})}
            {...(onLeave ? { onLeave: () => { if (!exitDisabled) onLeave(); } } : {})}
          />
        )}

        <PerfOverlay visible={showPerf} />

        {snapshot.mode === 'menu' && !autoStart && (
          <BattleMenu
            label={config.label ?? '对战'}
            playerDeck={config.playerDeck}
            definitions={session.authoritative.definitions}
            autoPlayer={snapshot.autoPlayer}
            onAutoPlayerChange={(on) => session.setAutoPlayer(on)}
            onStart={() => session.start()}
          />
        )}

        {snapshot.mode === 'result' && snapshot.outcome && (resultPanel !== undefined ? resultPanel : (
          <BattleResultPanel
            outcome={snapshot.outcome}
            playerHp={snapshot.display.playerHp.player}
            enemyHp={snapshot.display.playerHp.enemy}
            settlement={settlement}
            localMultiplayer={localMultiplayer}
            backLabel={exitLabel ?? (onExit ? '返回战役' : '返回菜单')}
            exitDisabled={exitDisabled}
            onRematch={allowRematch ? () => { if (!exitDisabled) { if (onRematchRequested) onRematchRequested(); else session.start(); } } : undefined}
            onBackToMenu={() => {
              if (exitDisabled) return;
              if (onExit) {
                onExit();
                return;
              }
              session.toMenu();
            }}
          />
        ))}
      </div>
    </WebGLGuard>
    </BattleVisualContext.Provider>
  );
}
