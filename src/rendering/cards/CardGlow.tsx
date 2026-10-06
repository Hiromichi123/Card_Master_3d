import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, Color, MeshBasicMaterial } from 'three';

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
 * 强度按稀有度**单调递增**，`A` / `A+` 是 0.5 的基点：
 *
 * | D | C, C+ | B, B+ | A, A+ | S, S+ | SS, SS+ | SSS |
 * | --- | --- | --- | --- | --- | --- | --- |
 * | 0.20 | 0.30 | 0.40 | **0.50** | 0.55 | 0.60 | 0.65 |
 *
 * **带 `+` 与不带 `+` 同亮度**——它们是同一档，只是同名卡的不同版本。
 *
 * 注意这**不是**「让观感上一样亮」：加色混合下颜色本身的亮度差很大，
 * `A+` 的深紫 (75,0,130) 在 0.5 时就是比 `A` 的紫 (138,43,226) 暗。
 * 这是按稀有度排一条统一刻度的必然结果，不是缺陷。
 * `#elna` 在旧版里与 SSS 同为 level 0，取同一档。
 */
const RARITY_GLOW: Record<CardRarity, { color: string; intensity: number; pulse: boolean }> = {
  D: { color: '#808080', intensity: 0.2, pulse: false },
  C: { color: '#00ff00', intensity: 0.3, pulse: false },
  'C+': { color: '#008000', intensity: 0.3, pulse: false },
  B: { color: '#00bfff', intensity: 0.4, pulse: false },
  'B+': { color: '#0000a0', intensity: 0.4, pulse: false },
  A: { color: '#8a2be2', intensity: 0.5, pulse: false },
  'A+': { color: '#4b0082', intensity: 0.5, pulse: false },
  S: { color: '#ffd700', intensity: 0.55, pulse: true },
  'S+': { color: '#a0522d', intensity: 0.55, pulse: true },
  SS: { color: '#ff6414', intensity: 0.6, pulse: true },
  'SS+': { color: '#ff8072', intensity: 0.6, pulse: true },
  SSS: { color: '#ff0000', intensity: 0.65, pulse: true },
  '#elna': { color: '#ff1493', intensity: 0.65, pulse: true },
};

export function CardGlow({ rarity, strength = 1, highlight }: {
  rarity: CardRarity;
  strength?: number | undefined;
  highlight?: Readonly<{ current: number }> | undefined;
}) {
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
  const white = useMemo(() => new Color('white'), []);

  useEffect(
    () => () => {
      material.dispose();
    },
    [material],
  );

  useFrame((_, delta) => {
    if (pulsing) elapsed.current += Math.min(delta, 0.05) * 1000 / ANIMATION_DURATION_SCALE;
    const flash = Math.max(0, Math.min(1, highlight?.current ?? 0));
    material.color.set(spec.color).lerp(white, flash);
    material.opacity = base * strength * (pulsing ? 0.88 + 0.12 * Math.sin(elapsed.current / 700) : 1) * (1 + flash * 0.5);
  });
  material.opacity = base * strength;

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[0, 0, CARD_FACE_OFFSET - 0.0004]}
      renderOrder={2}
    />
  );
}
