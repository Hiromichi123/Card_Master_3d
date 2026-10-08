import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Group, MeshStandardMaterial } from 'three';

import type { AttackStatusKind, CardDefinition } from '../../domain/cards/types';
import { isSelfDestructCard } from '../../domain/cards/traits';
import { CARD_BACK_URL, cardFaceUrl } from '../../data/assets';
import { useManagedTexture } from '../../services/useManagedTexture';
import type { TextureTier } from '../../services/AssetManager';
import { useSettingsStore } from '../../state/settingsStore';
import { easeInOutCubic } from '../anim/easings';
import { damp, flipAngle } from '../anim/motion';
import { Timeline } from '../anim/Timeline';
import { effectDirector } from '../effects/effectDirector';
import { ATTACK_OUT_SECONDS, ATTACK_RETURN_SECONDS, attackAdvance, attackDistance } from '../anim/combatMotion';
import {
  CARD_DIMENSIONS,
  CARD_FACE_OFFSET,
  getCardBodyGeometry,
  getCardFaceGeometry,
} from './cardGeometry';
import { CardGlow } from './CardGlow';
import { AttackStatusOverlay } from './AttackStatusOverlay';
import { UnyieldingOverlay } from './UnyieldingOverlay';
import { HoloLayer, holoIntensityForRarity } from './HoloLayer';
import { StatBadges, type StatLayout } from './StatBadges';
import type { StatKind } from './statBadge';

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
  /** Optional display resolution; battle and reveal retain their quality defaults. */
  readonly textureTier?: TextureTier | undefined;
  readonly attackKey?: string | undefined;
  readonly attackStatuses?: readonly AttackStatusKind[] | undefined;
  readonly unyielding?: boolean | undefined;
  readonly position: readonly [number, number, number];
  readonly rotationY?: number | undefined;
  readonly rotationX?: number | undefined;
  /** 是否盖着。变化时会播放翻面动画。 */
  readonly faceDown?: boolean | undefined;
  /**
   * **受控翻面**：外部逐帧写入的进度，0 = 正面朝上，1 = 背面朝上
   * （与 `faceDown` 同一套方向，见 `flipAngle`）。
   *
   * 给了它就不再自己跑 `Timeline`——抽卡演出按编排层的时间表翻，
   * 若每张卡各自跑一条时间轴，错峰时刻就有了两份来源，迟早对不上；
   * 而且「跳过」要求立刻翻到终态，而时间轴得跑满 0.42s。
   *
   * 不传时行为与以前**完全一致**（战斗那边的既有一堆消费者）。
   */
  readonly flipControl?: { readonly current: number } | undefined;
  readonly selected?: boolean | undefined;
  readonly interactive?: boolean | undefined;
  /** 是否叠加全息层。 */
  readonly holo?: boolean | undefined;
  /** Display scenes can keep the same rarity rim as battle cards, with reveal-only emphasis. */
  readonly glow?: boolean | undefined;
  readonly glowScale?: number | undefined;
  readonly glowHighlight?: Readonly<{ current: number }> | undefined;
  /** 全息强度倍数，用于查看器调参。默认 1。 */
  readonly holoScale?: number | undefined;
  /**
   * 动态数值。缺省用卡面定义里的初始值。
   *
   * 传入的是**当前**值而不是卡面上的静态值——祝福、破甲、受伤都会改动它们，
   * 这正是「动态数值与烘焙卡面分离」的意义（`V-CARD-3`）。
   */
  readonly stats?:
    | { readonly atk: number; readonly hp: number; readonly cd: number }
    | undefined;
  /** 刚刚变化过的项，会加白圈高亮。 */
  readonly emphasisedStats?: ReadonlySet<StatKind> | undefined;
  /** 是否显示数值徽标。 */
  readonly showStats?: boolean | undefined;
  /**
   * 这张牌现在在哪个区域。
   *
   * 数值的摆法跟着它变：手牌把冷却放在右上角、等待区放成中央大数字、
   * 战斗区干脆不显示冷却（见 `StatBadges`）。
   */
  readonly statLayout?: StatLayout | undefined;
  /** 卡牌整体缩放（准备区的卡比战斗区小一圈）。 */
  readonly scale?: number | undefined;
  readonly onClick?: ((card: CardDefinition) => void) | undefined;
  /** 悬停状态变化。详情面板据此切换显示内容。 */
  readonly onHoverChange?: ((card: CardDefinition, hovered: boolean) => void) | undefined;
}

const HOVER_LIFT = 0.5;
const SELECTED_LIFT = 0.95;
/** 悬停时朝相机方向倾斜的角度。 */
const HOVER_TILT = 0.26;
/** 悬停/选中时的放大倍数。牌桌视角下卡片本来就不大，放大要看得出来。 */
const HOVER_SCALE = 1.12;
const SELECTED_SCALE = 1.22;
/** 朝向变化的阻尼系数。比抬升略慢一点，翻过去的过程才看得见。 */
const ROT_DAMPING = 9;
const DAMPING = 12;
/** 翻面时长。 */
const FLIP_DURATION = 0.42;

export function CardMesh({
  card,
  textureTier,
  attackKey,
  unyielding = false,
  attackStatuses,
  position,
  rotationY = 0,
  rotationX = -Math.PI / 2,
  faceDown = false,
  flipControl,
  selected = false,
  interactive = true,
  holo,
  glow,
  glowScale,
  glowHighlight,
  holoScale = 1,
  stats,
  emphasisedStats,
  showStats = true,
  statLayout = 'battle',
  scale = 1,
  onClick,
  onHoverChange,
}: CardMeshProps) {
  const groupRef = useRef<Group>(null);
  const attackTimeline = useRef<Timeline | null>(null);
  const attackOffset = useRef(0);
  useEffect(() => {
    const stop = (): void => {
      attackTimeline.current?.skipToEnd();
      attackTimeline.current = null;
      attackOffset.current = 0;
    };
    const unsubscribe = effectDirector.subscribe((request) => {
      if (request.template !== 'normalAttack' || statLayout !== 'battle' ||
          request.sourceInstanceId !== (attackKey ?? card.cardId)) return;
      stop();
      const direction = Math.sign(request.to[2] - request.from[2]) || -1;
      const distance = attackDistance(Math.abs(request.to[2] - request.from[2]), CARD_DIMENSIONS.height * scale);
      const timeline = new Timeline(() => { attackOffset.current = 0; attackTimeline.current = null; });
      timeline.add({ duration: (ATTACK_OUT_SECONDS + ATTACK_RETURN_SECONDS) * Math.max(0.01, request.durationScale ?? 1),
        onUpdate: (t) => { attackOffset.current = direction * distance * attackAdvance(t); } });
      attackTimeline.current = timeline;
    });
    const unregister = effectDirector.registerSkipper(stop);
    return () => { unsubscribe(); unregister(); stop(); };
  }, [attackKey, card.cardId, statLayout, scale]);
  const [hovered, setHovered] = useState(false);

  // 纹理档跟随画质：低档用缩略图，减少核显上的显存与带宽压力
  const cardTier = useSettingsStore((state) => state.profile.cardTier);
  const faceUrl = useMemo(
    () => cardFaceUrl(card.cardId, textureTier ?? cardTier),
    [card.cardId, cardTier, textureTier],
  );
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
  const controlled = flipControl !== undefined;
  const flipRef = useRef(controlled ? flipControl.current : faceDown ? 1 : 0);
  const flipTimelineRef = useRef<Timeline | null>(null);

  /**
   * 全息层只在正面朝上时叠加。
   *
   * 这个开关必须是 state 而不是读 `flipRef.current`：
   * ref 不参与渲染，翻到一半时读它不会让组件重渲染，
   * 结果就是盖着的牌上仍然挂着一层全息。这里用 ref 做去重，
   * 只在布尔值真的翻转时才 setState，避免每帧重渲染。
   */
  /*
    受控模式下初值要按**外部给的进度**算：默认的 `!faceDown` 会让一张盖着
    的牌先闪一帧全息（进度是 1，但 state 说「正面朝上」）。
  */
  const [holoVisible, setHoloVisible] = useState(
    controlled ? flipControl.current < 0.5 : !faceDown,
  );
  const holoVisibleRef = useRef(controlled ? flipControl.current < 0.5 : !faceDown);

  useEffect(() => {
    // 受控：进度由外面写，这里不建时间轴
    if (controlled) {
      return;
    }
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
      },
    });
    flipTimelineRef.current = timeline;
  }, [faceDown, controlled]);

  // ---- 悬停/选中：追踪目标，用阻尼 ----
  // 悬停与选中**同时**抬高并放大：在实机里试对局时，光靠一点点抬升
  // 根本看不出「鼠标现在停在哪张牌上」，而手牌本来就小。
  const targetLift = (selected ? SELECTED_LIFT : 0) + (hovered ? HOVER_LIFT : 0);
  const targetTilt = hovered ? HOVER_TILT : 0;
  const targetScale = selected ? SELECTED_SCALE : hovered ? HOVER_SCALE : 1;
  const liftRef = useRef(0);
  const tiltRef = useRef(0);
  const scaleRef = useRef(1);
  /**
   * 基础朝向也要阻尼，不能直接跟随 props。
   *
   * 牌在区与区之间移动时朝向是会变的（手牌立着、准备区与战斗区平放），
   * 直接赋值就是「啪」地翻过去；而且手牌会因为张数变化整体重排，
   * 阻尼之后整把牌是滑过去的，不是跳过去的。
   */
  const rotXRef = useRef(rotationX);
  const rotYRef = useRef(rotationY);

  useFrame((_, delta) => {
    attackTimeline.current?.update(Math.min(delta, 0.05));
    if (controlled) {
      flipRef.current = flipControl.current;
    } else {
      const timeline = flipTimelineRef.current;
      if (timeline) {
        timeline.update(Math.min(delta, 0.1) / ANIMATION_DURATION_SCALE);
      }
    }

    /*
      全息层只在正面朝上时叠加。两种模式共用这一处开关：
      用 ref 去重，只在布尔值真的翻转时才 setState。
      写在 `useFrame` 里而不是时间轴的 `onUpdate` 里，是为了让受控模式也走同一条路。
    */
    const faceUp = flipRef.current < 0.5;
    if (holoVisibleRef.current !== faceUp) {
      holoVisibleRef.current = faceUp;
      setHoloVisible(faceUp);
    }

    const group = groupRef.current;
    if (!group) {
      return;
    }

    liftRef.current = damp(liftRef.current, targetLift, DAMPING, delta);
    tiltRef.current = damp(tiltRef.current, targetTilt, DAMPING, delta);
    scaleRef.current = damp(scaleRef.current, targetScale, DAMPING, delta);

    rotXRef.current = damp(rotXRef.current, rotationX, ROT_DAMPING, delta);
    rotYRef.current = damp(rotYRef.current, rotationY, ROT_DAMPING, delta);

    group.scale.setScalar(scale * scaleRef.current);
    group.position.y = position[1] + liftRef.current;
    group.position.z = position[2] + attackOffset.current;
    group.rotation.x = rotXRef.current + tiltRef.current;
    // 翻面绕自身长轴，与倾角叠加；欧拉顺序 XYZ 决定它先转、再躺平
    group.rotation.y = rotYRef.current + flipAngle(flipRef.current);
  });

  const handleOver = (event: { stopPropagation: () => void }): void => {
    if (!interactive) {
      return;
    }
    event.stopPropagation();
    setHovered(true);
    onHoverChange?.(card, true);
  };

  const handleOut = (): void => {
    if (!interactive) {
      return;
    }
    setHovered(false);
    onHoverChange?.(card, false);
  };

  const bodyGeometry = getCardBodyGeometry();
  const faceGeometry = getCardFaceGeometry();

  const edgeColor = hovered || selected ? '#c9d4e6' : '#7b869c';
  const holoEnabled = holo ?? true;
  const holoIntensity = holoIntensityForRarity(card.rarity) * holoScale;

  // 只有正面朝上时才叠全息；盖着的牌不显示
  const showHolo = holoEnabled && holoVisible && holoIntensity > 0.001;
  /**
   * 稀有度光晕只在**桌面上的牌**（等待区、战斗区）出现。
   *
   * 手牌不描：那里一摞牌叠在一起，每张都发光会糊成一片，
   * 而且手牌本来就靠悬停抬升在提示，不需要再抢注意力。
   */
  const showGlow = holoVisible && (glow ?? statLayout !== 'hand');
  // 数值徽标只在正面朝上时显示，且与全息无关（关掉全息仍要看得到数值）
  const showStatsNow = showStats && holoVisible;

  return (
    <group
      ref={groupRef}
      position={[position[0], position[1], position[2]]}
      rotation={[rotationX, rotationY, 0]}
      scale={scale}
    >
      <mesh geometry={bodyGeometry} castShadow receiveShadow>
        <meshStandardMaterial color={edgeColor} roughness={0.6} metalness={0.15} />
      </mesh>

      {/* 正面：成品卡面 */}
      <mesh geometry={faceGeometry} position={[0, 0, CARD_FACE_OFFSET]} userData={{ cardFaceSurface: true }}>
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

      {showGlow && <CardGlow rarity={card.rarity} strength={glowScale} highlight={glowHighlight} />}

      {showHolo && <HoloLayer rarity={card.rarity} />}

      {attackStatuses && attackStatuses.length > 0 && holoVisible && <AttackStatusOverlay statuses={attackStatuses} />}
      {unyielding && holoVisible && <UnyieldingOverlay />}

      {showStatsNow && (
        <StatBadges
          atk={stats?.atk ?? card.atk}
          hp={stats?.hp ?? card.hp}
          cd={stats?.cd ?? card.cd}
          emphasised={emphasisedStats}
          showCombatStats={!isSelfDestructCard(card)}
          layout={statLayout}
        />
      )}

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
