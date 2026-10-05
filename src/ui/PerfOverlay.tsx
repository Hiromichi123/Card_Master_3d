import { useEffect, useState } from 'react';

import { frameStats, perfStats, rendererStats, type FrameStats } from '../rendering/perf';
import { particleStats } from '../rendering/effects/particleStats';

/**
 * 性能读数条（`V-PERF-6`：冷加载与预热后要分开记录）。
 *
 * 低频轮询读取采样器写的可变对象，而不是订阅每帧数据——
 * 读数本身不能成为掉帧的原因。
 *
 * 首帧耗时单独显示：施工清单明确要求「不得用预热后的流畅度冒充首屏表现」，
 * 所以这一项要和稳态帧耗时并列摆出来，而不是只报稳态。
 */

const SAMPLE_INTERVAL_MS = 250;

export function PerfOverlay({ visible }: { visible: boolean }) {
  const [stats, setStats] = useState<FrameStats>({
    avgMs: 0,
    p95Ms: 0,
    fps: 0,
    maxMs: 0,
    samples: 0,
  });
  const [firstFrameMs, setFirstFrameMs] = useState(0);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const timer = window.setInterval(() => {
      setStats(frameStats());
      if (perfStats.firstFrameAt > 0) {
        // 首帧时刻 − 导航开始 = 从打开页面到画出第一帧的时间。
        // 它包含了解析、加载、Shader 编译，是真正的「冷启动」。
        setFirstFrameMs(perfStats.firstFrameAt - performance.timeOrigin);
      }
    }, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [visible]);

  if (!visible) {
    return null;
  }

  const fps = stats.fps;
  // 以 60fps 为基准分档着色：低于 50 变黄，低于 30 变红
  const level = fps >= 50 ? 'ok' : fps >= 30 ? 'warn' : 'bad';

  return (
    <div className={`perf perf--${level}`} role="status" aria-label="性能读数">
      <span className="perf__item">
        <b>{fps.toFixed(0)}</b> FPS
      </span>
      <span className="perf__item" title="窗口内平均帧耗时">
        均 <b>{stats.avgMs.toFixed(1)}</b> ms
      </span>
      <span className="perf__item" title="P95 帧耗时，比平均值更能反映卡顿">
        P95 <b>{stats.p95Ms.toFixed(1)}</b> ms
      </span>
      <span className="perf__item" title="窗口内单帧最大耗时">
        峰值 <b>{stats.maxMs.toFixed(0)}</b> ms
      </span>
      <span className="perf__item" title="绘制调用数">
        calls <b>{rendererStats.drawCalls}</b>
      </span>
      <span className="perf__item" title="三角形数量">
        tri <b>{(rendererStats.triangles / 1000).toFixed(1)}k</b>
      </span>
      <span className="perf__item" title="GPU 上的纹理数量">
        tex <b>{rendererStats.textures}</b>
      </span>
      <span className="perf__item" title="着色器程序数量">
        prog <b>{rendererStats.programs}</b>
      </span>
      <span className="perf__item" title="活跃粒子 / 池容量">
        粒子 <b>{particleStats.alive}</b>/{particleStats.capacity}
      </span>
      <span className="perf__item" title="单帧超过 50ms 的次数">
        尖峰 <b>{perfStats.spikes}</b>
      </span>
      <span className="perf__item" title="从页面开始加载到画出第一帧（含 Shader 编译）">
        首帧 <b>{firstFrameMs.toFixed(0)}</b> ms
      </span>
    </div>
  );
}
