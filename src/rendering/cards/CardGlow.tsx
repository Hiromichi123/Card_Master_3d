import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, MeshBasicMaterial } from 'three';

import type { CardRarity } from '../../domain/cards/types';
import { CARD_FACE_OFFSET, getCardGlowGeometry } from './cardGeometry';

/**
 * 卡牌边缘的稀有度光晕。
 *
 * **做法参照**象棋项目的圣地描边
 * （`D:\\Github\\Chessboard-three.js\\src\\render\\realtime\\sanctuaryBorder.js`）：
 * 三层由外向内变亮的光带叠在一起——一层很宽很淡的晕、一层收窄的中环、
 * 一条几乎不透明的亮芯。三层用加色混合叠出来才是「发光」，
 * 只画一条亮线那叫描边。
 *
 * 与圣地描边的两点不同：
 * - 它的三层是三个 mesh，这里是**一个几何 + 顶点色**，每张牌只占一次 draw call；
 * - 光晕跟着卡牌走（是卡牌的子节点），所以牌在桌面上移动时光晕一起走。
 *
 * `S` 及以上带一点呼吸；其余稀有度是恒定的弱光，免得满桌都在闪。
 */

/**
 * 稀有度 → 光晕颜色与强度。
 *
 * **颜色直接取旧版 2D 项目的稀有度配色**（`D:\Github\card_maker\config.py`
 * 的 `COLORS`，那份表也就是卡牌上等级字样的颜色）。
 * 自己另配一套的话，同一张牌在旧版和这里会是两种颜色，对照起来对不上。
 *
 * **强度不是「稀有度越高越亮」。** 加色混合下颜色本身的亮度差异很大：
 * `SSS` 是纯红 (255,0,0)，`A+` 是深紫 (75,0,130)——同样一层光，
 * 深紫几乎看不见、纯红直接过曝。所以按颜色亮度反着补：
 * 越暗的颜色给越高的强度，纯红反而压低（实机反馈正是「SSS 边缘太强烈」）。
 *
 * 整体强度压在 0.5 以下也是同一个原因：加色混合叠在**已经很亮的卡面**上，
 * 强度稍高就从「发光」变成「一圈实心色框」。
 */
const RARITY_GLOW: Record<CardRarity, { color: string; intensity: number; pulse: boolean }> = {
  D: { color: '#808080', intensity: 0.2, pulse: false },
  C: { color: '#00ff00', intensity: 0.18, pulse: false },
  'C+': { color: '#008000', intensity: 0.3, pulse: false },
  B: { color: '#00bfff', intensity: 0.24, pulse: false },
  'B+': { color: '#0000a0', intensity: 0.46, pulse: false },
  A: { color: '#8a2be2', intensity: 0.34, pulse: false },
  'A+': { color: '#4b0082', intensity: 0.5, pulse: false },
  S: { color: '#ffd700', intensity: 0.5, pulse: true },
  'S+': { color: '#a0522d', intensity: 0.42, pulse: true },
  SS: { color: '#ff6414', intensity: 0.44, pulse: true },
  'SS+': { color: '#ff8072', intensity: 0.46, pulse: true },
  SSS: { color: '#ff0000', intensity: 0.34, pulse: true },
  '#elna': { color: '#ff1493', intensity: 0.42, pulse: true },
};

export function CardGlow({ rarity }: { rarity: CardRarity }) {
  const spec = RARITY_GLOW[rarity];
  const geometry = useMemo(() => getCardGlowGeometry(), []);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: spec.color,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        // 光晕是自发光的表现，不该被色调映射压暗、也不该被雾冲淡
        toneMapped: false,
        fog: false,
      }),
    [spec.color],
  );

  const base = spec.intensity;
  const pulsing = spec.pulse;
  const elapsed = useRef(0);

  useEffect(
    () => () => {
      material.dispose();
    },
    [material],
  );

  useFrame((_, delta) => {
    if (!pulsing) {
      return;
    }
    // 与圣地描边同一档节奏：慢，只有一点点起伏
    elapsed.current += Math.min(delta, 0.05) * 1000;
    material.opacity = base * (0.88 + 0.12 * Math.sin(elapsed.current / 700));
  });

  // 不呼吸的那几档没有 useFrame 在改它，这里把初值设好
  if (!pulsing) {
    material.opacity = base;
  }

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[0, 0, CARD_FACE_OFFSET - 0.0004]}
      renderOrder={2}
    />
  );
}
