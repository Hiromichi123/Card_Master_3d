import { Color, Vector3 } from 'three';

/**
 * 固定容量的粒子池（`V-FX-6`）。
 *
 * 设计要点，都是为了避免在 `useFrame` 里制造垃圾：
 *
 * - **结构数组（SoA）**：位置/速度/颜色等各一条 `Float32Array`，
 *   整块传给 GPU，不为每颗粒子建对象、更不建 React 组件。
 * - **环形复用**：容量用满后从最旧的粒子开始覆盖。特效高峰期宁可丢掉最老的，
 *   也不扩容——预算是硬的（低/中/高档分别为 250 / 1000 / 3000）。
 * - **零分配发射**：`emit()` 只写数组；需要的临时向量由调用方传入或复用内部实例。
 *
 * 这个类不依赖 React，也不依赖 three 的场景图，纯粹是数据。
 */

export interface EmitSpec {
  /** 发射原点，世界坐标。 */
  readonly origin: Vector3;
  /** 发射数量。 */
  readonly count: number;
  /** 初速度范围 [最小, 最大]。 */
  readonly speed: readonly [number, number];
  /** 主方向。给定时粒子沿它喷射，否则向四周球形散开。 */
  readonly direction?: Vector3;
  /** 方向随机扩散，0 = 完全沿 direction，1 = 半球范围。 */
  readonly spread?: number;
  /** 基准颜色。 */
  readonly color: Color;
  /** 每个通道的随机扰动幅度（0–1）。 */
  readonly colorJitter?: number;
  /** 体积范围 [最小, 最大]。 */
  readonly size: readonly [number, number];
  /** 生命周期范围 [最小, 最大]，单位秒。 */
  readonly life: readonly [number, number];
  /** 重力加速度（负值下落）。 */
  readonly gravity?: number;
  /** 速度阻尼系数，每秒衰减比例。 */
  readonly drag?: number;
  /** 原点附近的随机散布半径。 */
  readonly spawnRadius?: number;
  /**
   * 这批粒子是「每帧持续发射」而不是「一次性爆发」。
   *
   * 置 true 时，`count` 会乘上池子的帧率归一化系数，
   * 使单位时间内的发射密度不随帧率变化。
   * 一次性爆发（命中、死亡）不要设这个，否则低帧率下会喷得更多。
   */
  readonly perFrame?: boolean;
}

const MAX_JITTER_RGB = 1;

export class ParticlePool {
  readonly capacity: number;

  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly sizes: Float32Array;
  readonly alphas: Float32Array;

  private readonly velocities: Float32Array;
  private readonly remaining: Float32Array;
  private readonly lifetimes: Float32Array;
  private readonly gravities: Float32Array;
  private readonly drags: Float32Array;
  private readonly baseSizes: Float32Array;

  /** 环形写入游标。 */
  private cursor = 0;
  /** 当前存活数量，仅用于统计与调试。 */
  private aliveCount = 0;

  /**
   * 帧率归一化系数：60fps 为 1，30fps 为 2。
   *
   * 由渲染系统每帧写入。只影响 `perFrame` 的发射，
   * 一次性爆发不受影响。
   */
  frameScale = 1;

  // 复用的临时对象，避免每次发射都 new
  private readonly tmpDir = new Vector3();
  private readonly tmpPos = new Vector3();

  constructor(capacity: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);

    this.velocities = new Float32Array(capacity * 3);
    this.remaining = new Float32Array(capacity);
    this.lifetimes = new Float32Array(capacity);
    this.gravities = new Float32Array(capacity);
    this.drags = new Float32Array(capacity);
    this.baseSizes = new Float32Array(capacity);
  }

  get alive(): number {
    return this.aliveCount;
  }

  /** 发射一批粒子。超出容量的部分覆盖最旧的粒子。 */
  emit(spec: EmitSpec): void {
    const {
      origin,
      count,
      speed,
      direction,
      spread = 0,
      color,
      colorJitter = 0,
      size,
      life,
      gravity = 0,
      drag = 0,
      spawnRadius = 0,
      perFrame = false,
    } = spec;

    // 持续发射按帧率归一化：低帧率下每帧多发一些，单位时间的密度才一致。
    // 至少发 1 颗，否则帧率很高时会出现「应该持续发射却一颗都不发」的断流。
    const emitCount = perFrame ? Math.max(1, Math.round(count * this.frameScale)) : count;

    for (let i = 0; i < emitCount; i += 1) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;

      const i3 = index * 3;

      // 位置：原点 + 可选球形散布
      if (spawnRadius > 0) {
        this.tmpPos.set(
          rand(-1, 1) * spawnRadius,
          rand(-1, 1) * spawnRadius,
          rand(-1, 1) * spawnRadius,
        );
        this.positions[i3] = origin.x + this.tmpPos.x;
        this.positions[i3 + 1] = origin.y + this.tmpPos.y;
        this.positions[i3 + 2] = origin.z + this.tmpPos.z;
      } else {
        this.positions[i3] = origin.x;
        this.positions[i3 + 1] = origin.y;
        this.positions[i3 + 2] = origin.z;
      }

      // 方向：有主方向时在其周围散开，否则球形均匀
      if (direction) {
        this.tmpDir.copy(direction).normalize();
        if (spread > 0) {
          this.tmpDir.x += rand(-1, 1) * spread;
          this.tmpDir.y += rand(-1, 1) * spread;
          this.tmpDir.z += rand(-1, 1) * spread;
          this.tmpDir.normalize();
        }
      } else {
        // 球面均匀采样：z 均匀、方位角均匀
        const z = rand(-1, 1);
        const theta = rand(0, Math.PI * 2);
        const r = Math.sqrt(Math.max(0, 1 - z * z));
        this.tmpDir.set(r * Math.cos(theta), z, r * Math.sin(theta));
      }

      const v = rand(speed[0], speed[1]);
      this.velocities[i3] = this.tmpDir.x * v;
      this.velocities[i3 + 1] = this.tmpDir.y * v;
      this.velocities[i3 + 2] = this.tmpDir.z * v;

      // 颜色扰动
      const jitter = colorJitter;
      this.colors[i3] = clamp01(color.r + rand(-jitter, jitter) * MAX_JITTER_RGB);
      this.colors[i3 + 1] = clamp01(color.g + rand(-jitter, jitter) * MAX_JITTER_RGB);
      this.colors[i3 + 2] = clamp01(color.b + rand(-jitter, jitter) * MAX_JITTER_RGB);

      const s = rand(size[0], size[1]);
      this.baseSizes[index] = s;
      this.sizes[index] = s;

      const l = rand(life[0], life[1]);
      this.remaining[index] = l;
      this.lifetimes[index] = l;
      this.alphas[index] = 1;

      this.gravities[index] = gravity;
      this.drags[index] = drag;
    }
  }

  /**
   * 推进一帧。
   *
   * 用「剩余时间 / 总时长」驱动 alpha 与体积衰减，
   * 而不是额外的缓动曲线——粒子数量大时每条曲线都是成本。
   */
  update(delta: number): void {
    const { capacity, positions, velocities, remaining, lifetimes, alphas, sizes, baseSizes } =
      this;
    let alive = 0;

    for (let index = 0; index < capacity; index += 1) {
      const left = remaining[index];
      if (left === undefined || left <= 0) {
        continue;
      }

      const next = left - delta;
      if (next <= 0) {
        remaining[index] = 0;
        alphas[index] = 0;
        sizes[index] = 0;
        continue;
      }
      remaining[index] = next;
      alive += 1;

      const i3 = index * 3;

      const gravity = this.gravities[index] ?? 0;
      const drag = this.drags[index] ?? 0;

      // 阻尼：与帧率无关的指数衰减
      const damping = drag > 0 ? Math.exp(-drag * delta) : 1;

      let vx = (velocities[i3] ?? 0) * damping;
      let vy = (velocities[i3 + 1] ?? 0) * damping + gravity * delta;
      let vz = (velocities[i3 + 2] ?? 0) * damping;

      velocities[i3] = vx;
      velocities[i3 + 1] = vy;
      velocities[i3 + 2] = vz;

      positions[i3] = (positions[i3] ?? 0) + vx * delta;
      positions[i3 + 1] = (positions[i3 + 1] ?? 0) + vy * delta;
      positions[i3 + 2] = (positions[i3 + 2] ?? 0) + vz * delta;

      const lifetime = lifetimes[index] ?? 1;
      const t = next / lifetime; // 1 → 0

      // 前 15% 淡入、后 45% 淡出，中间保持——避免粒子「啪」地出现或消失
      const fadeIn = Math.min(1, (1 - t) / 0.15);
      const fadeOut = Math.min(1, t / 0.45);
      alphas[index] = clamp01(fadeIn * fadeOut);

      // 体积随生命收缩，火焰/火花看起来才会「烧完」
      sizes[index] = (baseSizes[index] ?? 1) * (0.35 + 0.65 * t);

      void vx;
      void vy;
      void vz;
    }

    this.aliveCount = alive;
  }

  /** 清空全部粒子。用于场景切换与设置变更。 */
  clear(): void {
    this.remaining.fill(0);
    this.alphas.fill(0);
    this.sizes.fill(0);
    this.aliveCount = 0;
  }
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
