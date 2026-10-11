import { useEffect, useRef } from 'react';

/** 演出时钟只累计前台时间；隐藏不会跳阶段，回前台继续剩余时长。 */
export function useForegroundTimeout(enabled: boolean, duration: number, callback: () => void, restartKey: unknown = undefined) {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    if (!enabled) return;
    let remaining = duration;
    let started = 0;
    let timer: number | null = null;
    let completed = false;
    const pause = () => {
      if (timer === null) return;
      window.clearTimeout(timer); timer = null;
      remaining = Math.max(0, remaining - (performance.now() - started));
    };
    const resume = () => {
      if (completed || document.hidden || timer !== null) return;
      started = performance.now();
      timer = window.setTimeout(() => { timer = null; completed = true; latest.current(); }, remaining);
    };
    const visibility = () => { if (document.hidden) pause(); else resume(); };
    document.addEventListener('visibilitychange', visibility);
    resume();
    return () => { pause(); document.removeEventListener('visibilitychange', visibility); };
  }, [enabled, duration, restartKey]);
}
