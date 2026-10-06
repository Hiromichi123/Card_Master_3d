import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Euler,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  NormalBlending,
  PlaneGeometry,
  Points,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';

/**
 * 台面天气层。
 *
 * **移植自** `D:\Github\Chessboard-three.js`（MIT）的
 * `src/render/realtime/mapEffects.js`。原项目的五张战场各有各的天气：
 * 草地会摇、荒原浮尘、火山呼吸着余烬与热气、雪原落雪。
 *
 * 三条设计约束一并保留：
 *
 * 1. **天气不是规则**。它只画「这个台面长什么样」，不影响任何结算。
 * 2. **只用两个图元**：所有空中物体是一个 `Points` 云，草是一个 `InstancedMesh`，
 *    整层只占几次 draw call。
 * 3. **降级不是删除**：低画质档减少数量，开启「减少动态」时**冻结**而不是移除——
 *    静止的画面仍然是玩家选的那张台面。
 */

type QualityTier = 'low' | 'medium' | 'high';

function countFor(table: Record<QualityTier, number>, quality: QualityTier): number {
  return table[quality] ?? table.low;
}

type ParticleKind = 'dust' | 'embers' | 'snow';

interface ParticleSpec {
  readonly kind: ParticleKind;
  readonly count: Record<QualityTier, number>;
  readonly color: number;
  readonly size: number;
  readonly rise: number;
  readonly fall: number;
  readonly drift: number;
  /** 余烬额外带几片大而淡的热气。 */
  readonly haze?: Record<QualityTier, number>;
}

interface GrassSpec {
  readonly kind: 'grass';
  readonly blades: Record<QualityTier, number>;
  readonly tint: number;
  readonly swayRadians: number;
  readonly swaySeconds: number;
}

type WeatherSpec = ParticleSpec | GrassSpec;

/**
 * 每个台面带的天气。
 *
 * 没有条目的台面是**静止**的——那几套材质主题（锦标赛、大理石厅…）本来就是
 * 「同一场对局，没有天气」。这与原项目的划分一致。
 */
export const TABLE_WEATHER: Readonly<Record<string, WeatherSpec>> = Object.freeze({
  grass: {
    kind: 'grass',
    blades: { low: 1, medium: 2, high: 3 },
    tint: 0x7fbf6a,
    swayRadians: 0.014,
    swaySeconds: 5.2,
  },
  wasteland: {
    kind: 'dust',
    count: { low: 40, medium: 90, high: 150 },
    color: 0xd8bd8f,
    size: 0.5,
    rise: 0.12,
    fall: 0,
    drift: 0.5,
  },
  volcano: {
    kind: 'embers',
    count: { low: 40, medium: 90, high: 140 },
    color: 0xff9a4d,
    size: 0.42,
    rise: 1.5,
    fall: 0,
    drift: 0.3,
    haze: { low: 2, medium: 3, high: 4 },
  },
  snow: {
    kind: 'snow',
    count: { low: 60, medium: 130, high: 220 },
    color: 0xffffff,
    size: 0.3,
    rise: 0,
    fall: 0.55,
    drift: 0.25,
  },
});

export function hasWeather(themeId: string): boolean {
  return themeId in TABLE_WEATHER;
}

/** 一张柔边圆形精灵，全层共用。 */
let cachedSprite: CanvasTexture | null = null;
function weatherSprite(): CanvasTexture {
  if (cachedSprite) {
    return cachedSprite;
  }
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D 上下文创建失败，天气层无法生成精灵');
  }
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  cachedSprite = texture;
  return texture;
}

/** 天气层的水平范围与高度，按牌桌尺度给的。 */
const FIELD_HALF = 7.5;
const VISIBLE_HEIGHT = 6;

/**
 * 粒子尺寸的缩放系数。
 *
 * 原项目的棋盘跨度是 16 格 × 2 单位 = **32 单位**，本项目的格子垫是
 * 8 格 × 1.3 = **10.4 单位**，只有它的三分之一。
 * 粒子尺寸是世界单位，直接照搬会让每一颗都相对放大三倍——
 * 火山的「热气」尤其明显：5.5 单位的精灵在这个尺度下会盖住小半个桌面，
 * 把整块棋盘染成橙色（实测就是这样发现的）。
 *
 * 取 0.45 而不是 0.325：略微偏大一点，粒子在小屏幕上才看得见。
 */
const PARTICLE_SCALE = 0.45;

/**
 * 按主题 id 播种的局部随机数。
 *
 * 用局部发生器而不是 `Math.random()`：同一个台面每次进来看起来都一样，
 * 而且这条线**永远不碰**战斗的 RNG（PLAN 第 4.2 节要求两者分开）。
 */
function seededRandom(seedText: string): () => number {
  let state = 0x9e3779b9;
  for (const character of seedText) {
    state = (Math.imul(state, 31) + character.charCodeAt(0)) >>> 0;
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export interface WeatherLayerProps {
  readonly themeId: string;
  readonly quality: QualityTier;
  /** 冻结天气层。不是移除——静止的画面仍然是玩家选的那张台面。 */
  readonly reducedMotion?: boolean | undefined;
}

export function WeatherLayer({
  themeId,
  quality,
  reducedMotion = false,
}: WeatherLayerProps) {
  const spec = TABLE_WEATHER[themeId];
  if (!spec) {
    return null;
  }
  return spec.kind === 'grass' ? (
    <GrassField themeId={themeId} quality={quality} spec={spec} reducedMotion={reducedMotion} />
  ) : (
    <ParticleField themeId={themeId} quality={quality} spec={spec} reducedMotion={reducedMotion} />
  );
}

interface ParticleFieldProps {
  readonly themeId: string;
  readonly quality: QualityTier;
  readonly spec: ParticleSpec;
  readonly reducedMotion: boolean;
}

function ParticleField({ themeId, quality, spec, reducedMotion }: ParticleFieldProps) {
  const count = countFor(spec.count, quality);

  const built = useMemo(() => {
    const random = seededRandom(themeId);
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count * 3);

    for (let index = 0; index < count; index += 1) {
      const at = index * 3;
      positions[at] = (random() - 0.5) * FIELD_HALF * 2;
      positions[at + 1] = random() * VISIBLE_HEIGHT;
      positions[at + 2] = (random() - 0.5) * FIELD_HALF * 2;

      speeds[at] = (random() - 0.5) * spec.drift;
      speeds[at + 1] =
        spec.rise > 0 ? spec.rise * (0.5 + random()) : -spec.fall * (0.5 + random());
      speeds[at + 2] = (random() - 0.5) * spec.drift;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    return { positions, speeds, geometry };
  }, [count, themeId, spec]);

  useEffect(
    () => () => {
      built.geometry.dispose();
    },
    [built],
  );

  const pointsRef = useRef<Points>(null);
  const elapsedRef = useRef(0);

  useFrame((_, delta) => {
    // 冻结：位置不再推进，但粒子仍然渲染——画面静止，台面还是这张台面
    if (reducedMotion) {
      return;
    }
    const step = Math.min(delta, 0.05) / ANIMATION_DURATION_SCALE;
    elapsedRef.current += step;
    const { positions, speeds, geometry } = built;

    for (let index = 0; index < count; index += 1) {
      const at = index * 3;
      const x = (positions[at] ?? 0) + (speeds[at] ?? 0) * step;
      const y = (positions[at + 1] ?? 0) + (speeds[at + 1] ?? 0) * step;
      const z = (positions[at + 2] ?? 0) + (speeds[at + 2] ?? 0) * step;

      // 出了盒子就回收。位置在 JS 里循环而不是写着色器里，
      // 这样低画质档不需要自定义材质也能跑同一套逻辑。
      positions[at] = x > FIELD_HALF ? -FIELD_HALF : x < -FIELD_HALF ? FIELD_HALF : x;
      positions[at + 1] = y > VISIBLE_HEIGHT ? 0 : y < 0 ? VISIBLE_HEIGHT : y;
      positions[at + 2] = z > FIELD_HALF ? -FIELD_HALF : z < -FIELD_HALF ? FIELD_HALF : z;
    }
    geometry.getAttribute('position').needsUpdate = true;
    void pointsRef.current;
  });

  const additive = spec.kind === 'embers';

  return (
    <>
      <points ref={pointsRef} geometry={built.geometry} frustumCulled={false}>
        <pointsMaterial
          color={spec.color}
          size={spec.size * PARTICLE_SCALE}
          map={weatherSprite()}
          transparent
          opacity={spec.kind === 'snow' ? 0.85 : 0.7}
          depthWrite={false}
          blending={additive ? AdditiveBlending : NormalBlending}
          sizeAttenuation
        />
      </points>

      {spec.haze && (
        <HazeField themeId={themeId} count={countFor(spec.haze, quality)} />
      )}
    </>
  );
}

/** 余烬theme 的热气：几片大而淡的加色精灵,给火堆一点体积感。 */
function HazeField({ themeId, count }: { themeId: string; count: number }) {
  const built = useMemo(() => {
    const random = seededRandom(`${themeId}-haze`);
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const at = index * 3;
      positions[at] = (random() - 0.5) * FIELD_HALF * 1.5;
      positions[at + 1] = 0.3 + random() * 2.2;
      positions[at + 2] = (random() - 0.5) * FIELD_HALF * 1.5;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    return geometry;
  }, [count, themeId]);

  useEffect(() => () => built.dispose(), [built]);

  return (
    <points geometry={built} frustumCulled={false}>
      <pointsMaterial
        color={0xff6a2a}
        size={5.5 * PARTICLE_SCALE}
        map={weatherSprite()}
        transparent
        opacity={0.07}
        depthWrite={false}
        blending={AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
}

interface GrassFieldProps {
  readonly themeId: string;
  readonly quality: QualityTier;
  readonly spec: GrassSpec;
  readonly reducedMotion: boolean;
}

function GrassField({ themeId, quality, spec, reducedMotion }: GrassFieldProps) {
  const perCell = countFor(spec.blades, quality);

  const built = useMemo(() => {
    const random = seededRandom(themeId);
    const cells: [number, number][] = [];
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        cells.push([(col - 3.5) * 1.3, (row - 3.5) * 1.3]);
      }
    }

    const bladeCount = cells.length * perCell;
    const matrices: Matrix4[] = [];
    const lean: number[] = [];

    const place = new Matrix4();
    const euler = new Euler();
    const quaternion = new Quaternion();
    const scale = new Vector3(1, 1, 1);
    const position = new Vector3();

    for (const [cellX, cellZ] of cells) {
      for (let blade = 0; blade < perCell; blade += 1) {
        position.set(
          cellX + (random() - 0.5) * 1.3 * 0.7,
          0,
          cellZ + (random() - 0.5) * 1.3 * 0.7,
        );
        const tilt = 0.25 + random() * 0.5;
        euler.set(0, random() * Math.PI, tilt * 0.3);
        quaternion.setFromEuler(euler);
        scale.set(0.8 + random() * 0.5, 0.7 + random() * 0.7, 1);
        place.compose(position, quaternion, scale);
        matrices.push(place.clone());
        lean.push(tilt);
      }
    }
    return { matrices, lean, bladeCount };
  }, [perCell, themeId]);

  const geometry = useMemo(() => {
    const blade = new PlaneGeometry(0.1, 0.34);
    blade.translate(0, 0.17, 0);
    return blade;
  }, []);

  const meshRef = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    built.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
  }, [built]);

  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );

  /**
   * 草浪。
   *
   * 整片一起轻微倾斜，而不是逐根更新实例矩阵——后者每帧要写几千个矩阵，
   * 而 0.014 弧度这种幅度的摆动，整体倾斜与逐根摆动在画面上看不出差别。
   * 频率也取得很低（一个周期 5.2 秒），读起来是风吹过而不是抖动。
   */
  const phaseRef = useRef(0);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh || reducedMotion) {
      return;
    }
    phaseRef.current += Math.min(delta, 0.05) / ANIMATION_DURATION_SCALE;
    const phase = (phaseRef.current / spec.swaySeconds) * Math.PI * 2;
    mesh.rotation.z = Math.sin(phase) * spec.swayRadians;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, built.bladeCount]}
      frustumCulled={false}
      position={[0, 0, 0]}
    >
      <meshBasicMaterial
        color={spec.tint}
        transparent
        opacity={0.5}
        depthWrite={false}
        side={DoubleSide}
      />
    </instancedMesh>
  );
}
