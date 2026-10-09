import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ACESFilmicToneMapping, PCFSoftShadowMap, PerspectiveCamera, Vector3 } from 'three';

import { useSettingsStore } from '../../state/settingsStore';
import type { QualityLevel } from '../table/materials';
import type { TextureTier } from '../../services/AssetManager';
import { CardCorridor, DistantCardBelt, LoginPortal, loginSampleCards, useLoginTextures } from './LoginCards';
import {
  CorridorDust, HorizonLight, LoginAtmosphere, LoginLighting, LoginStars, ProcessionBoard,
} from './LoginEnvironment';
import { clamp01, LOGIN_TIMING, smoothstep, type LoginMotionState } from './motion';

export type LoginPhase = 'title' | 'descent' | 'cruise';

export interface LoginStageProps {
  readonly departing: boolean;
  readonly authenticated: boolean;
  readonly onPhaseChange: (phase: LoginPhase) => void;
  readonly onReady: () => void;
  readonly onReveal: (polygon: string, progress: number) => void;
  readonly onComplete: () => void;
}

function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = (): void => setReduced(query.matches);
    change();
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return reduced;
}

interface SceneProps extends LoginStageProps {
  readonly reducedMotion: boolean;
  readonly quality: QualityLevel;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
}

function LoginWorld({ reducedMotion, quality, shadows, shadowMapSize, ...callbacks }: SceneProps) {
  const motion = useRef<LoginMotionState>({ elapsed: 0, cruise: 0, travel: 0, origin: 0, brightness: 0, exit: -1, still: reducedMotion, authenticated: false });
  const callbackRef = useRef(callbacks);
  callbackRef.current = callbacks;
  const phase = useRef<LoginPhase>('title');
  const readySent = useRef(false);
  const completed = useRef(false);
  const departingLastFrame = useRef(false);
  const target = useMemo(() => new Vector3(), []);
  const startPosition = useMemo(() => new Vector3(0, 37.025, 15), []);
  const cruisePosition = useMemo(() => new Vector3(0, 2.7, 0), []);
  const cards = useMemo(loginSampleCards, []);
  // Towering foreground cards use detail textures; low quality remains inexpensive.
  const tier: TextureTier = quality === 'low' ? 'battle' : 'detail';
  const { textures, ready: texturesReady } = useLoginTextures(cards, tier);

  useEffect(() => { callbackRef.current.onPhaseChange('title'); }, []);

  useFrame(({ camera }, delta) => {
    if (completed.current || document.visibilityState === 'hidden') return;
    const state = motion.current;
    const step = Math.min(delta, .05);
    state.elapsed += step;
    state.still = reducedMotion;
    state.authenticated = callbackRef.current.authenticated;
    const descentDuration = LOGIN_TIMING.descent * (reducedMotion ? 1.35 : 1);
    const descent = clamp01((state.elapsed - LOGIN_TIMING.title) / descentDuration);
    const nextPhase: LoginPhase = state.elapsed < LOGIN_TIMING.title ? 'title' : descent < 1 ? 'descent' : 'cruise';
    if (phase.current !== nextPhase) {
      phase.current = nextPhase;
      callbackRef.current.onPhaseChange(nextPhase);
    }
    state.brightness = smoothstep((state.elapsed - LOGIN_TIMING.title) / 1.35);
    state.cruise = Math.max(0, state.elapsed - LOGIN_TIMING.title - descentDuration);
    if (state.elapsed > LOGIN_TIMING.title) {
      // Integrate the smoothly increasing speed over this frame, keeping the same path and FOV.
      // Acceleration starts when the central card appears, with zero initial velocity jump.
      const from = Math.max(0, state.exit - LOGIN_TIMING.portalDelay);
      const to = Math.max(0, state.exit + step - LOGIN_TIMING.portalDelay);
      const boostDistance = LOGIN_TIMING.portalAcceleration * (to ** 3 - from ** 3) / 3;
      state.travel += (step + boostDistance) * LOGIN_TIMING.travelSpeed
        * (reducedMotion ? .55 : 1) * smoothstep(descent);
      // Rebase at a two-colour tile period. Every world object is rebased together,
      // so the camera keeps advancing without a return-to-start cut or precision drift.
      state.origin = -(state.travel % 512);
    }

    if (callbackRef.current.departing && !departingLastFrame.current) state.exit = 0;
    departingLastFrame.current = callbackRef.current.departing;
    if (state.exit >= 0) state.exit += step;

    if (!readySent.current && state.cruise >= LOGIN_TIMING.minimumCruise &&
      (texturesReady || state.cruise >= 18)) {
      readySent.current = true;
      callbackRef.current.onReady();
    }

    if (state.exit < 0) {
      // The eased dive accelerates down from the title's star field, then levels out at eye height.
      const dive = smoothstep(descent);
      camera.position.copy(startPosition).lerp(cruisePosition, dive);
      camera.position.z += state.origin;
      target.set(0, 2.9 + (1 - dive) * 8.5, state.origin - 150);
      camera.lookAt(target);
      if (camera instanceof PerspectiveCamera) {
        camera.fov = 47 + dive * 4;
        camera.updateProjectionMatrix();
      }
    } else {
      // Keep the cruise path and FOV continuous while speed smoothly builds through the handoff.
      // The central card remains fixed on the ground while the camera approaches it.
      camera.position.set(0, 2.7, state.origin);
      target.set(0, 2.9, state.origin - 150);
      camera.lookAt(target);
      if (camera instanceof PerspectiveCamera) {
        camera.fov = 51;
        camera.updateProjectionMatrix();
      }
    }
    camera.updateMatrixWorld();
  }, -2);

  const onComplete = (): void => {
    if (completed.current) return;
    completed.current = true;
    callbackRef.current.onComplete();
  };

  return <>
    <LoginAtmosphere motion={motion} />
    <LoginLighting motion={motion} shadows={shadows} shadowMapSize={shadowMapSize} />
    <LoginStars motion={motion} count={quality === 'low' ? 580 : 1400} />
    <ProcessionBoard motion={motion} quality={quality} />
    <HorizonLight motion={motion} />
    <CardCorridor cards={cards} textures={textures} tier={tier} motion={motion} count={quality === 'low' ? 28 : quality === 'high' ? 48 : 40} />
    <DistantCardBelt cards={cards} textures={textures} motion={motion} count={quality === 'low' ? 20 : quality === 'high' ? 44 : 32} />
    <CorridorDust motion={motion} count={quality === 'low' ? 80 : 220} />
    <LoginPortal textures={textures} motion={motion}
      onReveal={(polygon, progress) => callbackRef.current.onReveal(polygon, progress)} onComplete={onComplete} />
  </>;
}

/** Fullscreen non-interactive WebGL scenery; the surrounding scene owns accessible form/click UI. */
export function LoginStage(props: LoginStageProps) {
  // Account hydration may replace settings while the portal is flipping. This one scene
  // retains its mounted material/texture tier; the newly entered game uses the saved profile.
  const [{ profile, quality, still }] = useState(() => {
    const settings = useSettingsStore.getState();
    return { profile: settings.profile, quality: settings.quality, still: settings.reduceMotion };
  });
  const systemReduced = useSystemReducedMotion();
  return <Canvas
    style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
    dpr={[1, Math.min(profile.dprCap, 1.75)]}
    camera={{ position: [0, 37.025, 15], fov: 47, near: .05, far: 520 }}
    shadows
    gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', toneMapping: ACESFilmicToneMapping }}
    onCreated={({ gl }) => { gl.toneMappingExposure = .9; gl.shadowMap.type = PCFSoftShadowMap; }}
  >
    <LoginWorld {...props} quality={quality} reducedMotion={still || systemReduced}
      shadows={true} shadowMapSize={quality === 'low' ? 1024 : Math.max(2048, profile.shadowMapSize)} />
  </Canvas>;
}
