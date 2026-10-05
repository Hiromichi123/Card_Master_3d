import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PCFShadowMap } from 'three';

import type { CardDefinition, SideId } from '../domain/cards/types';
import { BattleBoard } from '../rendering/battle/BattleBoard';
import { DealAnimation } from '../rendering/battle/DealAnimation';
import { DepartingCard } from '../rendering/battle/DepartingCard';
import { PresentationDriver } from '../rendering/battle/PresentationDriver';
import { buildBoard } from '../rendering/battle/placements';
import { BATTLE_CARD_SCALE, type SlotZone } from '../rendering/battle/layout';
import { effectDirector } from '../rendering/effects/effectDirector';
import { EffectSystem } from '../rendering/effects/EffectSystem';
import { PerfSampler } from '../rendering/PerfSampler';
import { PostEffects } from '../rendering/postprocessing/PostEffects';
import { DEMO_CONFIG, demoDefinitions } from '../rendering/presentation/demoBattle';
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
export function BattleScene() {
  const profile = useSettingsStore((state) => state.profile);
  const theme = useSettingsStore((state) => state.tableTheme);
  const showPerf = useSettingsStore((state) => state.showPerf);

  const [session] = useState(
    () =>
      new BattleSession(DEMO_CONFIG, demoDefinitions(), () => useSettingsStore.getState().presentationSpeed, {
        play: (request) => {
          effectDirector.play(request);
        },
        skipAll: () => {
          effectDirector.skipAll();
        },
      }),
  );
  const snapshot = useBattleSession(session);

  useEffect(() => () => session.dispose(), [session]);

  /** 开一场新局就播一次发牌动画；播完自己收掉。 */
  const [dealing, setDealing] = useState(false);
  useEffect(() => {
    if (snapshot.runId > 0 && snapshot.mode === 'battle') {
      setDealing(true);
    }
  }, [snapshot.runId, snapshot.mode]);

  const [detail, setDetail] = useState<{
    readonly card: CardDefinition;
    readonly instanceId: string;
  } | null>(null);
  const [hovered, setHovered] = useState<CardDefinition | null>(null);
  const [pinned, setPinned] = useState(false);

  const canPlay = snapshot.inputOpen && snapshot.currentSide === 'player';

  const view = useMemo(
    () =>
      buildBoard(snapshot.display, {
        selectedInstanceId: snapshot.selectedInstanceId,
        playerCanPlay: canPlay,
        placeablePrepSlots: snapshot.playablePrepSlots,
      }),
    [snapshot.display, snapshot.selectedInstanceId, canPlay, snapshot.playablePrepSlots],
  );

  const handleCardClick = useCallback(
    (card: CardDefinition, instanceId: string) => {
      setDetail({ card, instanceId });
      setPinned(true);
      // 只有手牌会被会话接受为「待打出的牌」；点场上的卡等于取消选牌
      session.select(instanceId);
    },
    [session],
  );

  const handleCardHover = useCallback((card: CardDefinition, hoveredNow: boolean) => {
    setHovered((current) => {
      if (hoveredNow) {
        return card;
      }
      // 只有移开的正是当前悬停的那张才清空，
      // 否则在两张卡之间快速移动时会因为离开事件迟到而闪一下
      return current?.cardId === card.cardId ? null : current;
    });
  }, []);

  const handleSlotClick = useCallback(
    (_side: SideId, zone: SlotZone, index: number) => {
      if (zone === 'prep') {
        session.playSelectedAt(index);
      }
    },
    [session],
  );

  const detailCard = pinned && detail ? detail.card : (hovered ?? detail?.card ?? null);
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
            onCardHover={handleCardHover}
            onSlotClick={handleSlotClick}
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
            onSkipPerformance={() => session.skipPerformance()}
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
              setHovered(null);
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

        {snapshot.mode === 'menu' && (
          <BattleMenu
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
            onRematch={() => session.start()}
            onBackToMenu={() => session.toMenu()}
          />
        )}
      </div>
    </WebGLGuard>
  );
}
