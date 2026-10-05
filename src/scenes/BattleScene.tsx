import { Canvas } from '@react-three/fiber';
import { useCallback, useMemo, useState } from 'react';
import { PCFShadowMap } from 'three';

import type { CardDefinition } from '../domain/cards/types';
import { BattleBoard } from '../rendering/battle/BattleBoard';
import { buildDemoArrangement } from '../rendering/battle/demoArrangement';
import { PerfSampler } from '../rendering/PerfSampler';
import { PostEffects } from '../rendering/postprocessing/PostEffects';
import { useSettingsStore } from '../state/settingsStore';
import { CardDetailPanel } from '../ui/CardDetailPanel';
import { PerfOverlay } from '../ui/PerfOverlay';

import { WebGLGuard } from './WebGLGuard';

/**
 * 战斗场景。
 *
 * `V-WORLD-6`：战斗/悬停/展示动画期间连续渲染；动画停止后回到按需渲染。
 * P1 场景内容还少，先按帧渲染；等 P1 的实测帧耗时出来再决定按需策略
 * （`docs/VISUAL_SPEC.md` 第 7 节的预算是按核显定的，不能提前乐观）。
 *
 * 桌面内容暂时来自 `demoArrangement`（静态演示局面），P3 换成 BattleState 的映射。
 *
 * 详情面板的规则（`V-CARD-6`）：
 * - **悬停**显示临时详情，移开即收起；
 * - **点击**固定选中，之后悬停别的卡不再抢走面板；
 * - 点空白处取消固定。面板本身在 DOM 之上，点击不会穿透到场景。
 */
export function BattleScene() {
  const arrangement = useMemo(() => buildDemoArrangement(), []);
  const profile = useSettingsStore((state) => state.profile);
  const theme = useSettingsStore((state) => state.tableTheme);
  const showPerf = useSettingsStore((state) => state.showPerf);
  const [selectedCard, setSelectedCard] = useState<CardDefinition | null>(null);
  const [hoveredCard, setHoveredCard] = useState<CardDefinition | null>(null);
  const [pinned, setPinned] = useState(false);

  const handleCardClick = useCallback((card: CardDefinition) => {
    setSelectedCard((current) => {
      const next = current?.cardId === card.cardId ? null : card;
      setPinned(next !== null);
      return next;
    });
  }, []);

  const handleCardHover = useCallback((card: CardDefinition, hovered: boolean) => {
    setHoveredCard((current) => {
      if (hovered) {
        return card;
      }
      // 只有移开的正是当前悬停的那张才清空，
      // 否则在两张卡之间快速移动时会因为离开事件晚到而闪一下
      return current?.cardId === card.cardId ? null : current;
    });
  }, []);

  // 固定选中优先于悬停
  const detailCard = pinned && selectedCard ? selectedCard : (hoveredCard ?? selectedCard);

  return (
    <WebGLGuard>
      <div className="scene-viewport">
        <Canvas
          // flat = 关闭 tone mapping。
          // R3F 默认用 ACESFilmic，但后处理链不会重复应用它，
          // 于是「开/关后处理」会得到两套色调（实测差 10.9%）。
          // 卡面插画本身就是按 sRGB 画好的，再过一遍 ACES 只会让它变灰。
          flat
          shadows={profile.shadows ? { type: PCFShadowMap } : false}
          dpr={[1, profile.dprCap]}
          camera={{ position: [0, 11, 9], fov: 45, near: 0.1, far: 120 }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onPointerMissed={() => {
            // 点空白处取消固定。面板内的点击不会走到这里（DOM 层已挡住）
            setSelectedCard(null);
            setPinned(false);
          }}
        >
          {/*
            采样器必须排在 <PostEffects> **之前**。
            实测：@react-three/postprocessing 的 EffectComposer 一旦挂载，
            声明在它之后的兄弟组件的 useFrame 订阅不会被注册——
            组件挂载了、画面正常，但回调一次都不触发（本轮排查记录见 P1 验证记录）。
            后续新增的系统组件（P3 的演出层）也要遵守这个顺序。
          */}
          <BattleBoard
            placements={arrangement.placements}
            selectedCardId={selectedCard?.cardId ?? null}
            onCardClick={handleCardClick}
            onCardHover={handleCardHover}
          />
          {/*
            背景与雾来自台面主题：木桌是暖褐的暗、霓虹是紫黑、
            雪原是冷灰蓝。这两项一并换掉，整张桌子的气氛才会跟着主题走，
            而不是「桌子换了、空气没换」。
          */}
          <color attach="background" args={[theme.background]} />
          <fog
            attach="fog"
            args={[theme.fog.color, theme.fog.near, theme.fog.far]}
          />

          <PerfSampler />
          <PostEffects profile={profile} theme={theme} />
        </Canvas>

        <PerfOverlay visible={showPerf} />

        {detailCard && (
          <CardDetailPanel
            card={detailCard}
            pinned={pinned && selectedCard !== null}
            onClose={() => {
              setSelectedCard(null);
              setHoveredCard(null);
              setPinned(false);
            }}
            onTogglePin={() => {
              setSelectedCard(detailCard);
              setPinned((current) => !current);
            }}
          />
        )}
      </div>
    </WebGLGuard>
  );
}
