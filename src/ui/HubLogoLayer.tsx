import { useLayoutEffect, useRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import type { Group, OrthographicCamera } from 'three';

export type HubLogoKind = 'battle' | 'market' | 'activity' | 'ranking' | 'statistics' | 'demo'
  | 'gacha' | 'deck' | 'collection' | 'fusion' | 'settings' | 'reset';
export interface HubLogoItem { readonly id: string; readonly kind: HubLogoKind; readonly color: string }
interface LogoLayerProps {
  readonly items: readonly HubLogoItem[];
  readonly anchors: RefObject<Map<string, HTMLSpanElement>>;
  readonly activeId: string | null;
  readonly still: boolean;
}

/** One WebGL context for every emblem; DOM anchors keep logos aligned to moving buttons. */
export function HubLogoLayer(props: LogoLayerProps) {
  return <div className="hub-logo-layer" aria-hidden="true">
    {/* Canvas sets pointerEvents:auto inline by default; override it at the source. */}
    <Canvas orthographic camera={{ position: [0, 0, 1000], near: 1, far: 3000, zoom: 1 }}
      style={{ pointerEvents: 'none' }}
      frameloop="demand" dpr={[1, 1.4]} gl={{ alpha: true, antialias: true }}>
      <ambientLight intensity={1.35} />
      <directionalLight position={[200, 400, 800]} intensity={2.8} color="#fff3d4" />
      <directionalLight position={[-400, -120, 500]} intensity={1.1} color="#91bfd5" />
      <LogoModels {...props} />
    </Canvas>
  </div>;
}

function LogoModels({ items, anchors, activeId, still }: LogoLayerProps) {
  const { camera, gl, size, invalidate } = useThree();
  const models = useRef(new Map<string, Group>());
  const moving = useRef(new Set<string>());
  const previousActive = useRef<string | null>(null);
  const settleUntil = useRef(0);
  const reduced = useRef(false);

  const place = (id: string): void => {
    const model = models.current.get(id);
    const anchor = anchors.current.get(id);
    if (!model || !anchor) return;
    const canvas = gl.domElement.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    if (canvas.width === 0 || canvas.height === 0) return;
    const sx = size.width / canvas.width;
    const sy = size.height / canvas.height;
    model.position.set((rect.left + rect.width / 2 - canvas.left - canvas.width / 2) * sx,
      (canvas.top + canvas.height / 2 - rect.top - rect.height / 2) * sy, 0);
    model.scale.setScalar(Math.min(rect.width * sx, rect.height * sy) * .68);
  };

  useLayoutEffect(() => {
    const ortho = camera as OrthographicCamera;
    ortho.left = -size.width / 2;
    ortho.right = size.width / 2;
    ortho.top = size.height / 2;
    ortho.bottom = -size.height / 2;
    ortho.updateProjectionMatrix();
    const measure = (): void => { for (const item of items) place(item.id); invalidate(); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(gl.domElement);
    for (const anchor of anchors.current.values()) observer.observe(anchor);
    return () => observer.disconnect();
  }, [camera, gl, size.width, size.height, items, anchors, invalidate]);

  useLayoutEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => { reduced.current = query.matches; invalidate(); };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [invalidate]);

  useLayoutEffect(() => {
    if (previousActive.current) moving.current.add(previousActive.current);
    if (activeId) moving.current.add(activeId);
    previousActive.current = activeId;
    settleUntil.current = performance.now() + 420;
    invalidate();
  }, [activeId, still, invalidate]);

  useFrame((_, delta) => {
    // Read only the entering/leaving anchors while their CSS lift settles.
    for (const id of moving.current) place(id);
    const settling = performance.now() < settleUntil.current;
    if (!settling) moving.current.clear();
    const rotating = activeId !== null && !still && !reduced.current;
    if (rotating) {
      const model = models.current.get(activeId);
      if (model) model.rotation.y += Math.min(delta, .08) * .42;
    }
    if (settling || rotating) invalidate();
  });

  return <>{items.map((item) => <group key={item.id} rotation={[.22, -.45, -.04]}
    ref={(model) => { if (model) models.current.set(item.id, model); else models.current.delete(item.id); }}>
    <LogoGeometry kind={item.kind} color={item.color} />
  </group>)}</>;
}

function Metal({ color }: { readonly color: string }) {
  return <meshStandardMaterial color={color} metalness={.52} roughness={.32} />;
}
function LogoGeometry({ kind, color }: { readonly kind: HubLogoKind; readonly color: string }) {
  const gold = '#f0d58d';
  if (kind === 'battle') return <>{[-1, 1].map((sign) => <group key={sign} rotation={[0, 0, sign * .55]}>
    <mesh><boxGeometry args={[.13, .9, .13]} /><Metal color={color} /></mesh>
    <mesh position={[0, -.3, .01]}><boxGeometry args={[.42, .08, .18]} /><Metal color={gold} /></mesh>
    <mesh position={[0, .5, 0]} scale={[.6, 1, .6]}><octahedronGeometry args={[.18]} /><Metal color={color} /></mesh>
  </group>)}</>;
  if (kind === 'market') return <>
    <mesh position={[0, -.1, 0]}><boxGeometry args={[.72, .55, .62]} /><Metal color={color} /><Edges color={gold} /></mesh>
    <mesh position={[0, .42, 0]} rotation={[0, .4, .2]}><icosahedronGeometry args={[.27, 0]} /><Metal color={gold} /></mesh>
    <mesh position={[0, -.1, .32]}><boxGeometry args={[.16, .22, .05]} /><Metal color={gold} /></mesh>
  </>;
  if (kind === 'activity' || kind === 'gacha') return <>
    <mesh scale={[.7, 1, .7]}><octahedronGeometry args={[.63]} /><Metal color={kind === 'gacha' ? '#cc5551' : color} /><Edges color={gold} /></mesh>
    <mesh rotation={[1.1, .3, .2]}><torusGeometry args={[.47, .055, 6, 36]} /><Metal color={gold} /></mesh>
  </>;
  if (kind === 'deck') return <>{[-1, 0, 1].map((index) => <mesh key={index}
    position={[index * .23, index === 0 ? .08 : -.04, -Math.abs(index) * .1]} rotation={[0, index * .22, -index * .16]}>
    <boxGeometry args={[.48, .72, .075]} /><Metal color={color} /><Edges color={gold} />
  </mesh>)}</>;
  if (kind === 'collection') return <>
    {[-1, 1].map((sign) => <mesh key={sign} position={[sign * .23, 0, 0]} rotation={[0, sign * -.35, 0]}>
      <boxGeometry args={[.43, .72, .13]} /><Metal color={color} /><Edges color={gold} />
    </mesh>)}
    <mesh><boxGeometry args={[.08, .8, .18]} /><Metal color={gold} /></mesh>
  </>;
  if (kind === 'fusion') return <>
    <mesh><octahedronGeometry args={[.26]} /><Metal color={color} /></mesh>
    {[0, Math.PI / 2].map((angle) => <mesh key={angle} rotation={[.3, angle, .25]}>
      <torusGeometry args={[.48, .06, 6, 40]} /><Metal color={gold} />
    </mesh>)}
  </>;
  if (kind === 'settings') return <>
    <mesh><torusGeometry args={[.31, .13, 8, 32]} /><Metal color={color} /></mesh>
    {Array.from({ length: 8 }, (_, index) => {
      const angle = index * Math.PI / 4;
      return <mesh key={index} position={[Math.cos(angle) * .43, Math.sin(angle) * .43, 0]} rotation={[0, 0, angle]}>
        <boxGeometry args={[.25, .16, .22]} /><Metal color={gold} />
      </mesh>;
    })}
  </>;
  if (kind === 'reset') return <>
    {[-1, 1].map((sign) => <group key={sign}>
      <mesh position={[0, sign * .2, 0]} rotation={[0, 0, sign > 0 ? Math.PI : 0]}>
        <coneGeometry args={[.31, .42, 6]} /><Metal color={color} />
      </mesh>
      <mesh position={[0, sign * .45, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[.36, .05, 6, 32]} /><Metal color={gold} />
      </mesh>
    </group>)}
  </>;
  if (kind === 'ranking' || kind === 'statistics') return <>
    {[.46, .86, .62].map((height, index) => <mesh key={index} position={[(index - 1) * .28, height / 2 - .4, 0]}>
      <boxGeometry args={[.2, height, .28]} /><Metal color={index === 1 ? gold : color} />
    </mesh>)}
    <mesh position={[0, -.42, 0]}><boxGeometry args={[.9, .06, .4]} /><Metal color={gold} /></mesh>
    {kind === 'statistics' && <mesh rotation={[0, 0, -.4]}><torusGeometry args={[.57, .03, 5, 32, Math.PI * 1.3]} /><Metal color={color} /></mesh>}
  </>;
  return <>
    <mesh rotation={[0, 0, -Math.PI / 2]}><coneGeometry args={[.42, .65, 3]} /><Metal color={color} /></mesh>
    <mesh><torusGeometry args={[.55, .045, 6, 40]} /><Metal color={gold} /></mesh>
  </>;
}
