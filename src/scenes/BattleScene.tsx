import type { ThreeEvent } from '@react-three/fiber';
import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PCFShadowMap } from 'three';

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
import { EffectSystem } from '../rendering/effects/EffectSystem';
import { PerfSampler } from '../rendering/PerfSampler';
import { PostEffects } from '../rendering/postprocessing/PostEffects';
import { DEMO_CONFIG, demoDefinitions } from '../rendering/presentation/demoBattle';
import type { DefinitionTable } from '../rendering/presentation/demoBattle';
import type { BattleConfig, BattleOutcome } from '../domain/battle/types';
import type { SettlementView } from '../domain/progression/campaign';
import { BattleSession } from '../rendering/presentation/session';
import { useBattleSession } from '../rendering/presentation/useBattleSession';
import { sceneFogArgs } from '../rendering/table/themes';
import { useSettingsStore } from '../state/settingsStore';
import { BattleHud } from '../ui/BattleHud';
import { BattleMenu } from '../ui/BattleMenu';
import { BattleResultPanel } from '../ui/BattleResultPanel';
import { CardDetailPanel } from '../ui/CardDetailPanel';
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
 * 详情面板的规则（`V-CARD-6`）：
 * - **悬停**显示临时详情，移开即收起；
 * - **点击**固定选中，之后悬停别的卡不再抢走面板；
 * - 点空白处取消固定。面板本身在 DOM 之上，点击不会穿透到场景。
 */
export interface BattleSceneProps {
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
  config = DEMO_CONFIG,
  definitions,
  settlement = null,
  onFinished,
  onExit,
  exitLabel,
  localMultiplayer = false,
  autoEnemy = true,
  autoStart = false,
  onLeave,
}: BattleSceneProps = {}) {
  const profile = useSettingsStore((state) => state.profile);
  const theme = useSettingsStore((state) => state.tableTheme);
  const showPerf = useSettingsStore((state) => state.showPerf);

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
      }, { localMultiplayer, autoEnemy }),
  );
  const snapshot = useBattleSession(session);
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

  useEffect(() => () => session.dispose(), [session]);

  /** 开一场新局就播一次发牌动画；播完自己收掉。 */
  const [dealing, setDealing] = useState(false);
  useEffect(() => {
    if (snapshot.runId > 0 && snapshot.mode === 'battle') {
      setDealing(true);
      // 发牌音与发牌动画同一时刻：丢了对规则毫无影响（发牌动画本就纯装饰）
      audioEngine.play('deal');
    }
  }, [snapshot.runId, snapshot.mode]);

  const [detail, setDetail] = useState<{
    readonly card: CardDefinition;
    readonly instanceId: string;
  } | null>(null);

  const [pinned, setPinned] = useState(false);

  const [drag, setDrag] = useState<DeploymentDrag | null>(null);
  const ignoreClickUntil = useRef(0);
  useEffect(() => { if (!snapshot.inputOpen) setDrag(null); }, [snapshot.inputOpen]);
  const handleDragStart = useCallback((instanceId: string, event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0 || !session.canDragDeploy(instanceId)) return;
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    event.nativeEvent.stopImmediatePropagation();
    session.select(instanceId);
    setPinned(false);
    setDetail(null);
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
      snapshot.inputSide, snapshot.phase, snapshot.deployableInstanceIds, localMultiplayer, drag],
  );

  const handleCardClick = useCallback(
    (card: CardDefinition, instanceId: string) => {
      if (Date.now() < ignoreClickUntil.current) return;
      const current = session.getSnapshot();
      const index = current.display.zones[current.inputSide].battle.indexOf(instanceId);
      if (current.selectedKind === 'ready' && index >= 0) { session.deploySelectedAt(index); return; }
      setDetail({ card, instanceId });
      setPinned(true);
      // 只有手牌会被会话接受为「待打出的牌」；点场上的卡等于取消选牌
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

  const detailCard = pinned && detail ? detail.card : null;
  const detailStats = useMemo(() => {
    const instanceId = detail?.instanceId;
    if (!instanceId) {
      return undefined;
    }
    const identity = snapshot.display.instances[instanceId];
    const group = identity ? snapshot.display.groups[identity.stateGroupId] : undefined;
    if (!group) {
      return undefined;
    }
    return { atk: group.atk, hp: group.hp, cd: snapshot.display.cd[instanceId] ?? 0 };
  }, [detail, snapshot.display]);

  return (
    <WebGLGuard>
      <div className="scene-viewport">
        <Canvas
          // flat = 关闭渲染器自带的色调映射。
          // three 在渲染到屏幕时才应用色调映射，而挂了后处理链之后场景先渲到贴图上；
          // 于是「开不开后处理」会得到两套影调——实测差 10.9%。
          // 试过把 ACES 挂到后处理链尾，反而变成重复应用，反向差 23%。
          // 目前的取舍是关掉它，两条路径一致（差 1.4%）。
          flat
          shadows={profile.shadows ? { type: PCFShadowMap } : false}
          dpr={[1, profile.dprCap]}
          camera={{ position: [0, 11, 9], fov: 45, near: 0.1, far: 120 }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onPointerMissed={() => {
            if (drag || Date.now() < ignoreClickUntil.current) return;
            // 点空白处取消固定。面板内的点击不会走到这里（DOM 层已挡住）
            setPinned(false);
            setDetail(null);
            session.select(null);
          }}
        >
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
            <DepartingCard key={proxy.instanceId} proxy={proxy} />
          ))}

          {/*
            背景与雾来自台面主题：木桌是暖褐的暗、霓虹是紫黑、
            雪原是冷灰蓝。这两项一并换掉，整张桌子的气氛才会跟着主题走，
            而不是「桌子换了、空气没换」。
          */}
          <color attach="background" args={[theme.background]} />
          {/* 雾距离按本场景尺度换算，理由见 `sceneFogArgs` 的注释。 */}
          <fog attach="fog" args={sceneFogArgs(theme.fog)} />

          <PostEffects profile={profile} theme={theme} />
        </Canvas>

        {snapshot.mode === 'battle' && (
          <BattleHud
            snapshot={snapshot}
            onEndTurn={() => session.endTurn()}
            onChoosePriority={(order) => session.choosePriority(order)}
            onSkipPerformance={() => session.skipPerformance()}
            onAutoEnemyChange={(on) => session.setAutoEnemy(on)}
            {...(localMultiplayer && onExit ? { onExit } : {})}
            {...(localMultiplayer && onLeave ? { onLeave } : {})}
          />
        )}

        <PerfOverlay visible={showPerf} />

        {detailCard && (
          <CardDetailPanel
            card={detailCard}
            stats={detailStats}
            pinned={pinned && detail !== null}
            onClose={() => {
              setDetail(null);
              setPinned(false);
              session.select(null);
            }}
            onTogglePin={() => {
              if (detail) {
                setPinned((current) => !current);
              }
            }}
          />
        )}

        {snapshot.mode === 'menu' && !autoStart && (
          <BattleMenu
            label={config.label ?? '对战'}
            playerDeck={config.playerDeck}
            autoPlayer={snapshot.autoPlayer}
            onAutoPlayerChange={(on) => session.setAutoPlayer(on)}
            onStart={() => session.start()}
          />
        )}

        {snapshot.mode === 'result' && snapshot.outcome && (
          <BattleResultPanel
            outcome={snapshot.outcome}
            playerHp={snapshot.display.playerHp.player}
            enemyHp={snapshot.display.playerHp.enemy}
            settlement={settlement}
            localMultiplayer={localMultiplayer}
            backLabel={exitLabel ?? (onExit ? '返回战役' : '返回菜单')}
            onRematch={() => session.start()}
            onBackToMenu={() => {
              if (onExit) {
                onExit();
                return;
              }
              session.toMenu();
            }}
          />
        )}
      </div>
    </WebGLGuard>
  );
}
