/**
 * 运行时性能采样（`V-PERF-4..7` / P7 的性能 HUD 基础）。
 *
 * 设计取舍：
 * - 帧时间存进**环形缓冲**，不无限增长，也不每帧 setState（那本身就会掉帧）；
 * - 单独记录**首帧时刻**，因为施工清单要求「冷加载与首次 Shader 编译单独记录，
 *   不得用预热后的流畅度冒充首屏表现」；
 * - 只暴露一个可读快照，界面按低频采样取走。
 */

const RING_SIZE = 240;

export interface FrameStats {
  /** 采样窗口内的平均帧耗时（毫秒）。 */
  readonly avgMs: number;
  /** P95 帧耗时：比平均值更能反映卡顿。 */
  readonly p95Ms: number;
  /** 由平均帧耗时换算的帧率。 */
  readonly fps: number;
  /** 窗口内最大帧耗时。 */
  readonly maxMs: number;
  readonly samples: number;
}

export const perfStats = {
  /** 环形缓冲，单位毫秒。 */
  frameTimes: new Float32Array(RING_SIZE),
  cursor: 0,
  count: 0,
  /** 第一次 `useFrame` 时的 `performance.now()`，用于算首帧耗时。 */
  firstFrameAt: 0,
  /** 长时间尖峰计数（超过 50ms，即掉到 20fps 以下）。 */
  spikes: 0,
};

/** 每帧调用一次。 */
export function recordFrame(deltaMs: number): void {
  if (perfStats.firstFrameAt === 0) {
    perfStats.firstFrameAt = performance.now();
  }
  perfStats.frameTimes[perfStats.cursor] = deltaMs;
  perfStats.cursor = (perfStats.cursor + 1) % RING_SIZE;
  perfStats.count = Math.min(perfStats.count + 1, RING_SIZE);
  if (deltaMs > 50) {
    perfStats.spikes += 1;
  }
}

export function resetPerf(): void {
  perfStats.frameTimes.fill(0);
  perfStats.cursor = 0;
  perfStats.count = 0;
  perfStats.firstFrameAt = 0;
  perfStats.spikes = 0;
}

/** 读取当前窗口的统计快照。 */
export function frameStats(): FrameStats {
  const n = perfStats.count;
  if (n === 0) {
    return { avgMs: 0, p95Ms: 0, fps: 0, maxMs: 0, samples: 0 };
  }

  const values = Array.from(perfStats.frameTimes.slice(0, n)).sort((a, b) => a - b);
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  const avgMs = sum / n;
  const p95Index = Math.min(n - 1, Math.floor(n * 0.95));

  return {
    avgMs,
    p95Ms: values[p95Index] ?? avgMs,
    fps: avgMs > 0 ? 1000 / avgMs : 0,
    maxMs: values[n - 1] ?? 0,
    samples: n,
  };
}

/** 渲染器侧的一帧信息，由采样组件从 `gl.info` 填入。 */
export const rendererStats = {
  drawCalls: 0,
  triangles: 0,
  /** 纹理数量（近似值，用于观察是否持续增长）。 */
  textures: 0,
  programs: 0,
  /** 卡在 `document.visibilityState === 'hidden'` 的次数，用于排除后台暂停的干扰。 */
  backgroundPauses: 0,
};

/** 调试与自动测量用的全局出口。生产构建里也存在，但只在开发页展示。 */
declare global {
  interface Window {
    __perf?: {
      frameStats: typeof frameStats;
      perfStats: typeof perfStats;
      rendererStats: typeof rendererStats;
      resetPerf: typeof resetPerf;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__perf = { frameStats, perfStats, rendererStats, resetPerf };
}
