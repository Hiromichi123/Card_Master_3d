import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

/** Pause hidden surfaces without destroying their scene/resources. Ambient UI may tick at 30 Hz. */
export function RenderActivity({ mode = 'always', fps }: {
  readonly mode?: 'always' | 'demand';
  readonly fps?: number;
}) {
  const { gl, setFrameloop, invalidate, get } = useThree();
  useEffect(() => {
    let inView = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const changeLoop = (mode: 'always' | 'demand' | 'never') => {
      const state = get();
      if (state.frameloop === mode) return;
      // Fiber restarts its clock on mode changes. Preserve shader/timeline phase on resume.
      const elapsed = state.clock.elapsedTime;
      setFrameloop(mode);
      state.clock.elapsedTime = elapsed;
    };
    const update = () => {
      clearInterval(timer);
      timer = undefined;
      if (document.hidden || !inView) { changeLoop('never'); return; }
      changeLoop(mode === 'always' && !fps ? 'always' : 'demand');
      invalidate();
      if (mode === 'always' && fps) timer = setInterval(() => invalidate(), 1000 / fps);
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? true;
      update();
    });
    observer.observe(gl.domElement);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      clearInterval(timer);
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [gl, setFrameloop, invalidate, get, mode, fps]);
  return null;
}
