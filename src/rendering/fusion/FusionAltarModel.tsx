import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, DoubleSide, type Group, type Mesh, type MeshBasicMaterial } from 'three';
import { useManagedTexture } from '../../services/useManagedTexture';
import { SPEED_SCALE, useSettingsStore } from '../../state/settingsStore';
import { fusionSlotPosition } from './motion';

export const ALTAR_TOP = .64;
export const CARD_REST_Y = .83;
export function altarPoint(point: readonly [number, number, number]): readonly [number, number, number] {
  return [point[0], CARD_REST_Y + point[2] - .04, -point[1]];
}

/** Layered physical geometry: stone steps, brass mouldings, five material plinths and a central crucible. */
export function FusionAltarModel() {
  const supports = useMemo(() => Array.from({ length: 5 }, (_, i) => altarPoint(fusionSlotPosition(i))), []);
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.018, 0]} receiveShadow>
      <circleGeometry args={[3.65, 80]} /><meshStandardMaterial color="#0d1824" roughness={.95} transparent opacity={.65} />
    </mesh>
    <mesh position={[0, .13, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[2.88, 3.08, .26, 80]} /><meshStandardMaterial color="#1c2632" roughness={.78} metalness={.1} />
    </mesh>
    <mesh position={[0, .34, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[2.7, 2.82, .22, 80]} /><meshStandardMaterial color="#273a43" roughness={.65} metalness={.18} />
    </mesh>
    <mesh position={[0, .535, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[2.58, 2.67, .21, 80]} /><meshStandardMaterial color="#1d2a34" roughness={.5} metalness={.22} />
    </mesh>
    {[{ r: 2.93, y: .21, tube: .025 }, { r: 2.74, y: .44, tube: .021 }, { r: 2.58, y: .64, tube: .026 }].map(({ r, y, tube }) =>
      <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]}>
        <torusGeometry args={[r, tube, 8, 100]} /><meshStandardMaterial color="#c1a268" roughness={.35} metalness={.62} emissive="#7c5925" emissiveIntensity={.12} />
      </mesh>)}
    <mesh position={[0, .7, 0]} castShadow>
      <cylinderGeometry args={[.76, .86, .12, 64]} /><meshStandardMaterial color="#33434b" roughness={.5} metalness={.35} />
    </mesh>
    <mesh position={[0, .78, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[.76, .035, 10, 64]} /><meshStandardMaterial color="#d9b36f" roughness={.3} metalness={.6} />
    </mesh>
    {supports.map((point, i) => <group key={i} position={[point[0], ALTAR_TOP, point[2]]}>
      <mesh position={[0, .047, 0]} castShadow receiveShadow><cylinderGeometry args={[.64, .7, .094, 40]} />
        <meshStandardMaterial color="#34404a" roughness={.5} metalness={.22} /></mesh>
      <mesh position={[0, .099, 0]} rotation={[-Math.PI / 2, 0, 0]}><torusGeometry args={[.63, .017, 6, 48]} />
        <meshStandardMaterial color="#b69963" roughness={.35} metalness={.55} /></mesh>
    </group>)}
    {Array.from({ length: 5 }, (_, i) => {
      const angle = (-54 + i * 72) * Math.PI / 180;
      return <group key={i} position={[Math.cos(angle) * 2.78, .62, Math.sin(angle) * 2.78]} rotation={[0, -angle, 0]}>
        <mesh position={[0, .21, 0]} castShadow><boxGeometry args={[.15, .42, .2]} />
          <meshStandardMaterial color="#706049" roughness={.42} metalness={.55} /></mesh>
        <mesh position={[0, .44, 0]}><sphereGeometry args={[.047, 12, 10]} />
          <meshStandardMaterial color="#d9bf87" emissive="#edd29a" emissiveIntensity={.55} /></mesh>
      </group>;
    })}
  </group>;
}

/** Reuses the local magic-circle texture and the fusion's existing ring/pentagram language. */
export function FusionMagicCircle({ elapsed, active, color }: {
  readonly elapsed: Readonly<{ current: number }>; readonly active: boolean; readonly color: string;
}) {
  const texture = useManagedTexture(`${import.meta.env.BASE_URL}assets/vfx/magic-circle.png`);
  const first = useRef<Group>(null), second = useRef<Group>(null);
  const seal = useRef<Mesh>(null);
  const clock = useRef(0);
  const still = useSettingsStore((state) => state.reduceMotion);
  const speed = useSettingsStore((state) => state.presentationSpeed);
  useEffect(() => { if (seal.current) (seal.current.material as MeshBasicMaterial).needsUpdate = true; }, [texture]);
  useFrame((_, delta) => {
    if (!still) clock.current += Math.min(delta, .05) / SPEED_SCALE[speed];
    const phase = active ? elapsed.current : clock.current;
    if (first.current) first.current.rotation.y = phase * (active ? .65 : .09);
    if (second.current) second.current.rotation.y = -phase * (active ? .85 : .13);
    const burst = active ? Math.max(0, 1 - Math.abs(elapsed.current - 1.05) / .65) : 0;
    if (seal.current) {
      seal.current.scale.setScalar(1 + burst * .12);
      (seal.current.material as MeshBasicMaterial).opacity = .17 + burst * .3;
    }
  });
  return <group position={[0, ALTAR_TOP + .015, 0]}>
    <group ref={first}>
      <mesh ref={seal} visible={texture !== null} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5.05, 5.05]} />
        <meshBasicMaterial map={texture} color={color} transparent opacity={.17} blending={AdditiveBlending}
          depthWrite={false} side={DoubleSide} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .008, 0]}>
        <ringGeometry args={[2.42, 2.445, 100]} /><meshBasicMaterial color={color} transparent opacity={.5} depthWrite={false} blending={AdditiveBlending} />
      </mesh>
    </group>
    <group ref={second} position={[0, .022, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[1.31, 1.33, 80]} />
        <meshBasicMaterial color="#a5d5e0" transparent opacity={.32} depthWrite={false} blending={AdditiveBlending} /></mesh>
      {Array.from({ length: 30 }, (_, i) => {
        const angle = i * Math.PI * 2 / 30;
        return <mesh key={i} position={[Math.cos(angle) * 1.42, 0, Math.sin(angle) * 1.42]} rotation={[-Math.PI / 2, 0, -angle]}>
          <planeGeometry args={[.023, i % 5 === 0 ? .14 : .07]} /><meshBasicMaterial color={color} transparent opacity={.48} depthWrite={false} />
        </mesh>;
      })}
    </group>
  </group>;
}
