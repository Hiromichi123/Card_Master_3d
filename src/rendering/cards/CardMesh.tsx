import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Group, MeshStandardMaterial } from 'three';

import type { CardDefinition } from '../../domain/cards/types';
import { CARD_BACK_URL, cardFaceUrl } from '../../data/assets';
import { useManagedTexture } from '../../services/useManagedTexture';
import {
  CARD_DIMENSIONS,
  CARD_FACE_OFFSET,
  getCardBodyGeometry,
  getCardFaceGeometry,
} from './cardGeometry';

/**
 * 实体卡牌（施工清单 P1「共享圆角卡体、正面/背面、薄边、阴影」）。
 *
 * 验收要点：
 * - `V-CARD-1` 厚度可见且与卡面成固定比例；
 * - `V-CARD-2` 用成品卡面，不叠加烘焙过的名称；
 * - `V-CARD-5` 有可辨认的阴影，悬停抬升时阴影随之变化；
 * - `V-CARD-6` 悬停有抬起与倾斜，且与选中态区分；
 * - `V-CARD-7` 正面/背面都正确。
 *
 * 悬停用**逐帧阻尼**而不是 CSS/React 过渡：卡牌数量多时逐卡 setState 会掉帧，
 * 且倾斜角度必须与相机相关，交给材质/矩阵处理更直接。
 */

/**
 * 可选属性一律写成 `?: T | undefined`。
 * `exactOptionalPropertyTypes` 下「不传」与「传 undefined」是两种类型，
 * 而调用方通常持有 `T | undefined`（例如从可选字段转发），
 * 不写这一层就得在每个调用点写条件展开。
 */
export interface CardMeshProps {
  readonly card: CardDefinition;
  readonly position: readonly [number, number, number];
  /** 卡牌绕 Y 轴的朝向（弧度）。 */
  readonly rotationY?: number | undefined;
  /** 卡牌绕 X 轴的初始倾角（平放时为 -π/2）。 */
  readonly rotationX?: number | undefined;
  /** 是否显示卡背。 */
  readonly faceDown?: boolean | undefined;
  /** 选中态。与悬停是两种不同提示（`V-CARD-6`）。 */
  readonly selected?: boolean | undefined;
  /** 是否响应指针。敌方手牌与牌堆里的卡不响应。 */
  readonly interactive?: boolean | undefined;
  readonly onClick?: ((card: CardDefinition) => void) | undefined;
}

const HOVER_LIFT = 0.22;
const SELECTED_LIFT = 0.32;
/** 悬停时朝相机方向倾斜的角度。 */
const HOVER_TILT = 0.16;
/** 阻尼速度，越大越跟手。 */
const DAMPING = 12;

export function CardMesh({
  card,
  position,
  rotationY = 0,
  rotationX = -Math.PI / 2,
  faceDown = false,
  selected = false,
  interactive = true,
  onClick,
}: CardMeshProps) {
  const groupRef = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);

  /**
   * 朝上的那一面用哪张贴图。
   *
   * 盖着的牌并不是「把卡转到背面朝上」——那要靠额外的旋转，还得处理镜像。
   * 直接把卡背贴图放到朝上的那一面，视觉结果与翻面完全一致，
   * 也避免了背面板法线朝下、相机看不到的问题。
   * （物理翻面会让卡背图案旋转 180°，卡背是中心对称图形，这里不做额外补偿。）
   */
  const faceUrl = useMemo(
    () => (faceDown ? null : cardFaceUrl(card.cardId, 'battle')),
    [card.cardId, faceDown],
  );
  const faceTexture = useManagedTexture(faceUrl);
  const backTexture = useManagedTexture(CARD_BACK_URL);

  /** 朝上那一面的贴图。 */
  const topTexture = faceDown ? backTexture : faceTexture;
  /** 朝下那一面的贴图：盖着的牌背面是卡面，翻起来的牌背面是卡背。 */
  const bottomTexture = faceDown ? faceTexture : backTexture;

  const faceMaterialRef = useRef<MeshStandardMaterial>(null);
  const backMaterialRef = useRef<MeshStandardMaterial>(null);

  /**
   * 贴图从「无」变成「有」时必须让材质重编译。
   *
   * three 在 `map === null` 时编译出的着色器里没有 `USE_MAP`，
   * 之后仅仅给 `material.map` 赋值**不会**重新编译，
   * 结果是贴图被静默忽略、卡面渲染成纯白。
   * R3F 只对 shadowMap 处理了 `needsUpdate`，贴图属性不会自动触发
   * （已在 node_modules/@react-three/fiber 里核对过）。
   */
  useEffect(() => {
    for (const material of [faceMaterialRef.current, backMaterialRef.current]) {
      if (material) {
        material.needsUpdate = true;
      }
    }
  }, [topTexture, bottomTexture]);

  // 悬停时抬起并略微立起；选中时抬得更高，两者叠加
  const targetLift = (selected ? SELECTED_LIFT : 0) + (hovered ? HOVER_LIFT : 0);
  const targetTilt = hovered ? HOVER_TILT : 0;

  const liftRef = useRef(0);
  const tiltRef = useRef(0);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) {
      return;
    }
    // 指数阻尼，避免逐帧 setState；delta 已由 R3F 做上限保护
    const smoothing = 1 - Math.exp(-DAMPING * delta);
    liftRef.current += (targetLift - liftRef.current) * smoothing;
    tiltRef.current += (targetTilt - tiltRef.current) * smoothing;

    group.position.y = position[1] + liftRef.current;
    group.rotation.x = rotationX + tiltRef.current;
  });

  const handleOver = (event: { stopPropagation: () => void }): void => {
    if (!interactive) {
      return;
    }
    event.stopPropagation();
    setHovered(true);
  };

  const handleOut = (): void => {
    if (!interactive) {
      return;
    }
    setHovered(false);
  };

  const bodyGeometry = getCardBodyGeometry();
  const faceGeometry = getCardFaceGeometry();

  // 边缘颜色按稀有度给一点点差异，便于在牌堆里分辨，但保持低饱和
  const edgeColor = hovered || selected ? '#c9d4e6' : '#7b869c';

  return (
    <group
      ref={groupRef}
      position={[position[0], position[1], position[2]]}
      rotation={[rotationX, rotationY, 0]}
    >
      <mesh geometry={bodyGeometry} castShadow receiveShadow>
        <meshStandardMaterial color={edgeColor} roughness={0.6} metalness={0.15} />
      </mesh>

      {/* 朝上的一面：正面用成品卡面，盖着的牌用卡背 */}
      <mesh geometry={faceGeometry} position={[0, 0, CARD_FACE_OFFSET]}>
        <meshStandardMaterial
          ref={faceMaterialRef}
          map={topTexture}
          color={topTexture ? '#ffffff' : '#2f3644'}
          roughness={0.55}
          metalness={0.05}
        />
      </mesh>

      {/* 朝下的一面：翻起来时才看得到。盖着的牌朝下的是卡面本身 */}
      <mesh
        geometry={faceGeometry}
        position={[0, 0, -CARD_FACE_OFFSET]}
        rotation={[0, Math.PI, 0]}
      >
        <meshStandardMaterial
          ref={backMaterialRef}
          map={bottomTexture}
          color={bottomTexture ? '#ffffff' : '#2f3644'}
          roughness={0.7}
          metalness={0.05}
        />
      </mesh>

      {/* 命中盒：用一个不可见的薄盒承接指针事件。
          直接用挤出几何做 raycast 也能命中，但面片与侧面会分别触发，
          悬停/离开会抖动；单独一层薄盒行为稳定。 */}
      <mesh
        position={[0, 0, 0]}
        visible={false}
        onPointerOver={handleOver}
        onPointerOut={handleOut}
        onClick={(event) => {
          if (!interactive) {
            return;
          }
          event.stopPropagation();
          onClick?.(card);
        }}
      >
        <boxGeometry
          args={[CARD_DIMENSIONS.width, CARD_DIMENSIONS.height, CARD_DIMENSIONS.thickness]}
        />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
}

/** 卡牌正面朝向相机的默认平放角度。 */
export const CARD_FLAT = -Math.PI / 2;
