import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Group, MeshStandardMaterial } from 'three';

import type { CardDefinition } from '../../domain/cards/types';
import { CARD_BACK_URL, cardFaceUrl } from '../../data/assets';
import { useManagedTexture } from '../../services/useManagedTexture';
import { easeInOutCubic } from '../anim/easings';
import { damp, flipAngle } from '../anim/motion';
import { Timeline } from '../anim/Timeline';
import {
  CARD_DIMENSIONS,
  CARD_FACE_OFFSET,
  getCardBodyGeometry,
  getCardFaceGeometry,
} from './cardGeometry';
import { HoloLayer, holoIntensityForRarity } from './HoloLayer';

/**
 * 实体卡牌。
 *
 * 验收要点：`V-CARD-1` 厚度可见、`V-CARD-2` 用成品卡面、
 * `V-CARD-3` 动态数值与烘焙卡面分离、`V-CARD-5` 阴影、
 * `V-CARD-6` 悬停/选中提示、`V-CARD-7` 正反面、`V-CARD-8` 公共动画工具。
 *
 * **翻面用几何旋转而不是换贴图**：绕卡牌自身长轴转 180°，
 * 中途卡面会侧对相机、宽度趋近 0。换贴图做不到这个效果，
 * 而且会与「背面片法线朝下」的物理事实打架。
 *
 * 悬停/抬升用逐帧阻尼，翻面用 `Timeline`——两者的区别是：
 * 阻尼是「追踪一个目标」，翻面是「一段有始有终的演出」。
 */

/**
 * 可选属性一律写成 `?: T | undefined`。
 * `exactOptionalPropertyTypes` 下「不传」与「传 undefined」是两种类型，
 * 而调用方通常持有 `T | undefined`。
 */
export interface CardMeshProps {
  readonly card: CardDefinition;
  readonly position: readonly [number, number, number];
  readonly rotationY?: number | undefined;
  readonly rotationX?: number | undefined;
  /** 是否盖着。变化时会播放翻面动画。 */
  readonly faceDown?: boolean | undefined;
  readonly selected?: boolean | undefined;
  readonly interactive?: boolean | undefined;
  /** 是否叠加全息层。 */
  readonly holo?: boolean | undefined;
  /** 全息强度倍数，用于查看器调参。默认 1。 */
  readonly holoScale?: number | undefined;
  readonly onClick?: ((card: CardDefinition) => void) | undefined;
}

const HOVER_LIFT = 0.22;
const SELECTED_LIFT = 0.32;
/** 悬停时朝相机方向倾斜的角度。 */
const HOVER_TILT = 0.16;
const DAMPING = 12;
/** 翻面时长。 */
const FLIP_DURATION = 0.42;

export function CardMesh({
  card,
  position,
  rotationY = 0,
  rotationX = -Math.PI / 2,
  faceDown = false,
  selected = false,
  interactive = true,
  holo,
  holoScale = 1,
  onClick,
}: CardMeshProps) {
  const groupRef = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);

  const faceUrl = useMemo(() => cardFaceUrl(card.cardId, 'battle'), [card.cardId]);
  const faceTexture = useManagedTexture(faceUrl);
  const backTexture = useManagedTexture(CARD_BACK_URL);

  const faceMaterialRef = useRef<MeshStandardMaterial>(null);
  const backMaterialRef = useRef<MeshStandardMaterial>(null);

  /**
   * 贴图从「无」变成「有」时必须让材质重编译。
   *
   * three 在 `map === null` 时编译出的着色器里没有 `USE_MAP`，
   * 之后仅仅给 `material.map` 赋值**不会**重新编译，
   * 结果是贴图被静默忽略、卡面渲染成纯白。
   * R3F 只对 shadowMap 处理了 `needsUpdate`（已核对 node_modules）。
   */
  useEffect(() => {
    for (const material of [faceMaterialRef.current, backMaterialRef.current]) {
      if (material) {
        material.needsUpdate = true;
      }
    }
  }, [faceTexture, backTexture]);

  // ---- 翻面：一段有始有终的演出，用 Timeline 而不是阻尼 ----
  const flipRef = useRef(faceDown ? 1 : 0);
  const flipTimelineRef = useRef<Timeline | null>(null);

  /**
   * 全息层只在正面朝上时叠加。
   *
   * 这个开关必须是 state 而不是读 `flipRef.current`：
   * ref 不参与渲染，翻到一半时读它不会让组件重渲染，
   * 结果就是盖着的牌上仍然挂着一层全息。这里用 ref 做去重，
   * 只在布尔值真的翻转时才 setState，避免每帧重渲染。
   */
  const [holoVisible, setHoloVisible] = useState(!faceDown);
  const holoVisibleRef = useRef(!faceDown);

  useEffect(() => {
    const from = flipRef.current;
    const to = faceDown ? 1 : 0;
    if (Math.abs(from - to) < 1e-4) {
      return;
    }

    const timeline = new Timeline(() => {
      flipTimelineRef.current = null;
    });
    timeline.add({
      duration: FLIP_DURATION,
      easing: easeInOutCubic,
      onUpdate: (t) => {
        flipRef.current = from + (to - from) * t;
        const visible = flipRef.current < 0.5;
        if (holoVisibleRef.current !== visible) {
          holoVisibleRef.current = visible;
          setHoloVisible(visible);
        }
      },
    });
    flipTimelineRef.current = timeline;
  }, [faceDown]);

  // ---- 悬停/选中：追踪目标，用阻尼 ----
  const targetLift = (selected ? SELECTED_LIFT : 0) + (hovered ? HOVER_LIFT : 0);
  const targetTilt = hovered ? HOVER_TILT : 0;
  const liftRef = useRef(0);
  const tiltRef = useRef(0);

  useFrame((_, delta) => {
    const timeline = flipTimelineRef.current;
    if (timeline) {
      timeline.update(Math.min(delta, 0.1));
    }

    const group = groupRef.current;
    if (!group) {
      return;
    }

    liftRef.current = damp(liftRef.current, targetLift, DAMPING, delta);
    tiltRef.current = damp(tiltRef.current, targetTilt, DAMPING, delta);

    group.position.y = position[1] + liftRef.current;
    group.rotation.x = rotationX + tiltRef.current;
    // 翻面绕自身长轴，与倾角叠加；欧拉顺序 XYZ 决定它先转、再躺平
    group.rotation.y = rotationY + flipAngle(flipRef.current);
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

  const edgeColor = hovered || selected ? '#c9d4e6' : '#7b869c';
  const holoEnabled = holo ?? true;
  const holoIntensity = holoIntensityForRarity(card.rarity) * holoScale;

  // 只有正面朝上时才叠全息；盖着的牌不显示
  const showHolo = holoEnabled && holoVisible && holoIntensity > 0.001;

  return (
    <group
      ref={groupRef}
      position={[position[0], position[1], position[2]]}
      rotation={[rotationX, rotationY, 0]}
    >
      <mesh geometry={bodyGeometry} castShadow receiveShadow>
        <meshStandardMaterial color={edgeColor} roughness={0.6} metalness={0.15} />
      </mesh>

      {/* 正面：成品卡面 */}
      <mesh geometry={faceGeometry} position={[0, 0, CARD_FACE_OFFSET]}>
        <meshStandardMaterial
          ref={faceMaterialRef}
          map={faceTexture}
          color={faceTexture ? '#ffffff' : '#2f3644'}
          roughness={0.55}
          metalness={0.05}
        />
      </mesh>

      {/* 背面：卡背。翻面靠的是整体旋转，两面始终都在 */}
      <mesh
        geometry={faceGeometry}
        position={[0, 0, -CARD_FACE_OFFSET]}
        rotation={[0, Math.PI, 0]}
      >
        <meshStandardMaterial
          ref={backMaterialRef}
          map={backTexture}
          color={backTexture ? '#ffffff' : '#3a3f52'}
          roughness={0.6}
          metalness={0.05}
        />
      </mesh>

      {showHolo && <HoloLayer intensity={holoIntensity} />}

      {/* 命中盒：单独的不可见薄盒，避免挤出几何的面片与侧面分别触发指针事件 */}
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
