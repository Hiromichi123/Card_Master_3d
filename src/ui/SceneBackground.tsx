import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useSettingsStore } from '../state/settingsStore';

export const BACKGROUND_CROSSFADE_SECONDS = 0.32;
const BackgroundMemory = createContext<RefObject<string | null> | null>(null);

/** Carry the last visible background across route unmounts; never retain an old screen's UI. */
export function SceneBackgroundProvider({ children }: { readonly children: ReactNode }) {
  const memory = useRef<string | null>(null);
  return <BackgroundMemory.Provider value={memory}>{children}</BackgroundMemory.Provider>;
}

export function useBackgroundMemory(): RefObject<string | null> {
  const shared = useContext(BackgroundMemory);
  const local = useRef<string | null>(null);
  return shared ?? local;
}

/** Native menu backgrounds use the same old/new blend as the 3D board. */
export function CrossfadeBackground({ url, className = 'menu__bg' }: {
  readonly url: string | null;
  readonly className?: string;
}) {
  const memory = useBackgroundMemory();
  const still = useSettingsStore((state) => state.reduceMotion);
  const [layers, setLayers] = useState<{ from: string | null; to: string | null }>(() => ({ from: memory.current, to: null }));
  const [ready, setReady] = useState<string | null | undefined>(undefined);
  const incoming = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!url) { setReady(null); return; }
    let cancelled = false;
    const image = new Image();
    image.onload = () => { if (!cancelled) setReady(url); };
    // Keep the old image if the next resource fails, rather than exposing a blank layer.
    image.onerror = () => {};
    image.src = url;
    if (image.complete && image.naturalWidth > 0) setReady(url);
    return () => { cancelled = true; image.onload = image.onerror = null; };
  }, [url]);

  useEffect(() => {
    if (ready === undefined || layers.to !== null || layers.from === ready) return;
    if (still || !layers.from || !ready) {
      memory.current = ready;
      setLayers({ from: ready, to: null });
    } else setLayers({ from: layers.from, to: ready });
  }, [ready, layers.from, layers.to, still, memory]);

  useLayoutEffect(() => {
    const element = incoming.current;
    if (!layers.to || !element) return;
    let start: number | null = null;
    let frame = 0;
    const tick = (now: number): void => {
      start ??= now;
      const progress = still ? 1 : Math.min(1, (now - start) / (BACKGROUND_CROSSFADE_SECONDS * 1000));
      element.style.opacity = String(progress);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else {
        // Retain the actually visible image when a route interrupts a transition.
        memory.current = layers.to;
        setLayers({ from: layers.to, to: null });
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [layers.to, still, memory]);

  return <>
    <div className={className} data-background-layer="base" aria-hidden="true"
      style={{ backgroundImage: layers.from ? `url(${layers.from})` : undefined, pointerEvents: 'none' }} />
    {layers.to && <div ref={incoming} className={className} data-background-layer="incoming" aria-hidden="true"
      style={{ backgroundImage: `url(${layers.to})`, opacity: 0, transition: 'none', pointerEvents: 'none' }} />}
  </>;
}
