import { createContext, useContext, useId, useLayoutEffect, type ReactNode } from 'react';

export interface SharedSurfaceLayer {
  readonly children: ReactNode;
  readonly onPointerMissed?: (() => void) | undefined;
}
export interface SharedBattleSurfaceApi {
  readonly setEnabled: (enabled: boolean) => void;
  readonly setLayer: (id: string, layer: SharedSurfaceLayer) => void;
  readonly removeLayer: (id: string) => void;
}
export type SharedWebGLStatus = 'checking' | 'ready' | 'unavailable';
export const SharedWebGLStatusContext = createContext<SharedWebGLStatus | null>(null);
export const SharedBattleSurfaceContext = createContext<SharedBattleSurfaceApi | null>(null);
export const useSharedBattleSurface = () => useContext(SharedBattleSurfaceContext);

/** DOM sessions publish actors into the retained R3F surface, rather than mounting a second renderer. */
export function SharedBattleLayer({ children, onPointerMissed }: SharedSurfaceLayer) {
  const surface = useSharedBattleSurface(), id = useId();
  useLayoutEffect(() => { surface?.setLayer(id, { children, onPointerMissed }); }, [surface, id, children, onPointerMissed]);
  useLayoutEffect(() => () => surface?.removeLayer(id), [surface, id]);
  return null;
}
