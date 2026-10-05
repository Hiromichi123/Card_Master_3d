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
 * `S` 及以上更亮，并且带一点呼吸；其余稀有度是恒定的弱光，
 * 免得满桌都在闪。
 */

/** 稀有度 → 光晕颜色。 */
const RARITY_GLOW: Record<CardRarity, string> = {
  D: '#7f8ea8',
  C: '#7f8ea8',
  'C+': '#7f8ea8',
  B: '#4fb0ff',
  'B+': '#4fb0ff',
  A: '#b06bff',
  'A+': '#b06bff',
  S: '#ffc94d',
  'S+': '#ffc94d',
  SS: '#ff9a3c',
  'SS+': '#ff9a3c',
  SSS: '#ffe9a8',
  '#elna': '#59e6c8',
};

/** 整体强度：低稀有度只描一层薄光，S 以上才亮起来。 */
function baseIntensity(rarity: CardRarity): number {
  switch (rarity) {
    case 'SSS':
      return 1.15;
    case 'SS+':
    case 'SS':
      return 1;
    case 'S+':
    case 'S':
      return 0.9;
    case 'A+':
    case 'A':
      return 0.5;
    case 'B+':
    case 'B':
      return 0.38;
    default:
      return 0.26;
  }
}

/** S 及以上带呼吸。 */
function breathes(rarity: CardRarity): boolean {
  return rarity === 'S' || rarity === 'S+' || rarity === 'SS' || rarity === 'SS+' || rarity === 'SSS';
}

export function CardGlow({ rarity }: { rarity: CardRarity }) {
  const geometry = useMemo(() => getCardGlowGeometry(), []);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: RARITY_GLOW[rarity],
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        // 光晕是自发光的表现，不该被色调映射压暗、也不该被雾冲淡
        toneMapped: false,
        fog: false,
      }),
    [rarity],
  );

  const base = baseIntensity(rarity);
  const pulsing = breathes(rarity);
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
