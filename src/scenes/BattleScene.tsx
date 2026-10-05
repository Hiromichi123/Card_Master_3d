import { Canvas } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import { PCFShadowMap } from 'three';

import type { CardDefinition } from '../domain/cards/types';
import { BattleBoard } from '../rendering/battle/BattleBoard';
import { buildDemoArrangement } from '../rendering/battle/demoArrangement';

import { WebGLGuard } from './WebGLGuard';

/**
 * 战斗场景。
 *
 * `V-WORLD-6`：战斗/悬停/展示动画期间连续渲染；动画停止后回到按需渲染。
 * P1 场景内容还少，先按帧渲染；等 P1 的实测帧耗时出来再决定按需策略
 * （`docs/VISUAL_SPEC.md` 第 7 节的预算是按核显定的，不能提前乐观）。
 *
 * 桌面内容暂时来自 `demoArrangement`（静态演示局面），
 * P3 换成 BattleState 的映射。
 */
export function BattleScene() {
  const arrangement = useMemo(() => buildDemoArrangement(), []);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const handleCardClick = (card: CardDefinition): void => {
    setSelectedCardId((current) => (current === card.cardId ? null : card.cardId));
  };

  return (
    <WebGLGuard>
      <Canvas
        // three 0.186 移除了 PCFSoftShadowMap，不显式指定会走「已移除」告警并回退
        shadows={{ type: PCFShadowMap }}
        dpr={[1, 2]}
        camera={{ position: [0, 11, 9], fov: 45, near: 0.1, far: 120 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => setSelectedCardId(null)}
        onCreated={({ gl }) => {
          // 与 CSS 的 --bg 保持一致，避免画布边缘出现色差
          gl.setClearColor('#0d1018');
        }}
      >
        <BattleBoard
          placements={arrangement.placements}
          selectedCardId={selectedCardId}
          onCardClick={handleCardClick}
        />
      </Canvas>
    </WebGLGuard>
  );
}
