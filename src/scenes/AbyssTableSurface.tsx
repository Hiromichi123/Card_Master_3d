import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { BattleCanvas } from '../rendering/battle/BattleCanvas';
import { BattleBoard } from '../rendering/battle/BattleBoard';
import { SharedBattleSurfaceContext, SharedWebGLStatusContext, type SharedWebGLStatus, type SharedSurfaceLayer } from '../rendering/battle/SharedBattleSurfaceContext';
import { WebGLGuard } from './WebGLGuard';

/** One renderer and one arena for the whole run; Save & Exit is its only release boundary. */
export function AbyssTableSurfaceProvider({ children }: { readonly children: ReactNode }) {
  const [webGLStatus, setWebGLStatus] = useState<SharedWebGLStatus>('checking');
  const [enabled, setEnabled] = useState(false);
  const [layers, setLayers] = useState(new Map<string, SharedSurfaceLayer>());
  const setLayer = useCallback((id: string, layer: SharedSurfaceLayer) => setLayers(previous => {
    if (previous.get(id)?.children === layer.children && previous.get(id)?.onPointerMissed === layer.onPointerMissed) return previous;
    const next = new Map(previous); next.set(id, layer); return next;
  }), []);
  const removeLayer = useCallback((id: string) => setLayers(previous => {
    if (!previous.has(id)) return previous;
    const next = new Map(previous); next.delete(id); return next;
  }), []);
  const api = useMemo(() => ({ setEnabled, setLayer, removeLayer }), [setLayer, removeLayer]);
  const active = [...layers.values()].at(-1);
  return <SharedBattleSurfaceContext.Provider value={api}><SharedWebGLStatusContext.Provider value={enabled ? webGLStatus : null}>
    {enabled && <div className="abyss-table-surface" data-persistent-surface="abyss">
      <WebGLGuard standalone onStatusChange={setWebGLStatus} fallback={<p className="abyss-surface-unavailable">3D盘面暂时不可用，可使用界面入口保存或继续操作。</p>}>
        <BattleCanvas standalone themeId="abyss" onPointerMissed={() => active?.onPointerMissed?.()}>
          <BattleBoard surface cameraRig={false} showSlotMarkers={false} />
          <SharedBattleSurfaceContext.Provider value={api}>
            {[...layers].map(([id, layer]) => <group key={id}>{layer.children}</group>)}
          </SharedBattleSurfaceContext.Provider>
        </BattleCanvas>
      </WebGLGuard>
    </div>}
    {children}
  </SharedWebGLStatusContext.Provider></SharedBattleSurfaceContext.Provider>;
}
