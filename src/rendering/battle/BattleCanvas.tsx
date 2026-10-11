import { Canvas } from '@react-three/fiber';
import type { ReactNode } from 'react';
import { PCFShadowMap } from 'three';
import { BattleVisualContext, useBattleVisuals } from './battleVisuals';
import { PostEffects } from '../postprocessing/PostEffects';
import { sceneFogArgs } from '../table/themes';

/** 战前空盘与实战共用渲染配置，不持有规则会话。 */
export function BattleCanvas({ children, onPointerMissed, themeId }: {
  readonly themeId?: string | undefined;
  readonly children: ReactNode;
  readonly onPointerMissed?: (() => void) | undefined;
}) {
  const visuals = useBattleVisuals(themeId);
  const {profile,theme} = visuals;
  return <Canvas flat shadows={profile.shadows ? { type: PCFShadowMap } : false}
    dpr={[1, profile.dprCap]}
    camera={{ position: [0, 11, 9], fov: 45, near: .1, far: theme.geometry === 'abyss' ? 360 : theme.geometry === 'solar' ? 320 : theme.geometry === 'mecha' ? 260 : 120 }}
    gl={{ antialias: true, powerPreference: 'high-performance' }} {...(onPointerMissed ? { onPointerMissed } : {})}>
    <BattleVisualContext.Provider value={visuals}>
    {children}
    <color attach="background" args={[theme.background]} />
    <fog attach="fog" args={sceneFogArgs(theme.fog)} />
    <PostEffects profile={profile} theme={theme} />
    </BattleVisualContext.Provider>
  </Canvas>;
}
