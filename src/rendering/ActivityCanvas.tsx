import { Canvas, type CanvasProps } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';

/** Keep the Canvas prop in agreement with RenderActivity across ordinary React rerenders.
 * Otherwise Fiber.configure() restores its default 'always' loop on the next parent update.
 */
export function ActivityCanvas({ activityFps, frameloop = 'always', onCreated, ...props }: CanvasProps & {
  readonly activityFps?: number;
}) {
  const [element, setElement] = useState<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(() => !document.hidden);
  const created = useRef(onCreated); created.current = onCreated;
  useEffect(() => {
    let inView = true;
    const update = () => setVisible(!document.hidden && inView);
    const observer = element ? new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? true; update();
    }) : null;
    if (element) observer?.observe(element);
    document.addEventListener('visibilitychange', update);
    update();
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, [element]);
  const loop = !visible ? 'never' : frameloop === 'always' && activityFps ? 'demand' : frameloop;
  return <Canvas {...props} frameloop={loop} onCreated={state => {
    setElement(state.gl.domElement); created.current?.(state);
  }} />;
}
