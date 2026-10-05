import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';

import { recordFrame, rendererStats } from './perf';

/**
 * 性能采样器。挂在 Canvas 内部，每帧记录一次。
 *
 * 刻意**不**触发 React 更新：它只往环形缓冲与可变对象里写，
 * 界面按低频轮询取走快照。每帧 setState 本身就会制造掉帧，
 * 那样量到的就不是应用的真实表现了。
 *
 * 它同时记录 `gl.info.render.calls`——draw calls 是 `V-PERF` 预算里
 * 最需要盯的一项，比「粒子数少」更能反映 GPU 压力。
 */
export function PerfSampler() {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    /**
     * 关掉 three 的自动重置。
     *
     * 默认 `autoReset` 为 true，每个渲染 pass 结束后都会清零 `gl.info`，
     * 于是挂上 EffectComposer 之后读到的永远是**最后一个全屏 pass**的计数——
     * 实测就是恒等于 1，完全失真。
     * 改为手动重置后，一帧内所有 pass 的绘制量会累加，才是真实的 draw calls。
     */
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);

  useFrame(
    (_, delta) => {
      // 先读上一帧的累计值，再清零为本帧累计
      rendererStats.drawCalls = gl.info.render.calls;
      rendererStats.triangles = gl.info.render.triangles;
      rendererStats.textures = gl.info.memory.textures;
      rendererStats.programs = gl.info.programs?.length ?? 0;
      gl.info.reset();

      recordFrame(delta * 1000);
    },
    // 优先级取很小值：保证在所有渲染 pass 之前执行
    -1000,
  );

  // 后台标签页会暂停 rAF，恢复时 delta 巨大；计数它能避免把它算成掉帧
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        rendererStats.backgroundPauses += 1;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return null;
}
