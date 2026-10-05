import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { AdditiveBlending, DoubleSide } from 'three';

import type { CardRarity } from '../../domain/cards/types';
import { CARD_FACE_OFFSET, getCardFaceGeometry } from './cardGeometry';
import {
  createHoloUniforms,
  HOLO_FRAGMENT_SHADER,
  HOLO_VERTEX_SHADER,
} from './holoShader';

/**
 * 卡面上的全息叠加层（`V-HOLO-1..4`）。
 *
 * 独立于卡面材质：关掉它就是完全原始的插画，不会因为混合公式被改色。
 *
 * 用与卡面**同一个圆角几何**（`getCardFaceGeometry`）而不是矩形平面：
 * 矩形平面的四个直角会盖到卡牌圆角之外，全息可见时露出四块尖角。
 */

/**
 * 按稀有度给强度。
 *
 * 低稀有度也要有一点点，但必须弱到不影响读图——
 * `V-HOLO-2` 的验收标准是「名称与插画不被过亮色带淹没」，
 * 所以上限刻意压低，宁可不够闪也不要糊掉卡面。
 */
export function holoIntensityForRarity(rarity: CardRarity): number {
  switch (rarity) {
    case 'SSS':
    case 'SS+':
      return 0.95;
    case 'SS':
    case 'S+':
      return 0.8;
    case 'S':
    case 'A+':
      return 0.62;
    case 'A':
    case '#elna':
      return 0.5;
    case 'B+':
    case 'B':
      return 0.26;
    case 'C+':
    case 'C':
    case 'D':
      return 0.1;
    default:
      return 0.1;
  }
}

interface Props {
  readonly intensity: number;
}

/** 罩在卡面正上方的一层片，紧贴但略高于卡面，避免与卡面 z-fighting。 */
const HOLO_OFFSET = CARD_FACE_OFFSET + 0.0014;

export function HoloLayer({ intensity }: Props) {
  const uniforms = useMemo(() => createHoloUniforms(intensity), []);

  // 强度变化时只改 uniform 值，不重建材质（重建会触发着色器重新编译、掉帧）
  useEffect(() => {
    uniforms.uIntensity.value = intensity;
  }, [intensity, uniforms]);

  useFrame((_, delta) => {
    // 色带的缓慢流动。时间只驱动表现，不参与任何规则计算。
    uniforms.uTime.value += delta;
  });

  const geometry = getCardFaceGeometry();

  return (
    <mesh geometry={geometry} position={[0, 0, HOLO_OFFSET]} renderOrder={2}>
      <shaderMaterial
        vertexShader={HOLO_VERTEX_SHADER}
        fragmentShader={HOLO_FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={DoubleSide}
        blending={AdditiveBlending}
      />
    </mesh>
  );
}
