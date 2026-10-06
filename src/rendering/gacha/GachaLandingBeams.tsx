import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, CylinderGeometry, MeshBasicMaterial, RingGeometry, type Group } from 'three';
import { useRarityIndex } from '../../state/useRarityIndex';
import { FALL_HEIGHT, landingBeamEnvelope, type CardShot, type GachaChoreography } from './choreography';

/** One colored 3D column per paid card, before any face is revealed. */
export function GachaLandingBeams({ choreo, elapsed }: {
  readonly choreo: GachaChoreography;
  readonly elapsed: Readonly<{ current: number }>;
}) {
  const geometry = useMemo(() => new CylinderGeometry(0.1, 0.23, 1, 12, 1, true), []);
  const ring = useMemo(() => new RingGeometry(0.2, 0.25, 40), []);
  useEffect(() => () => { geometry.dispose(); ring.dispose(); }, [geometry, ring]);
  return <>{choreo.shots.map((shot) => <Beam key={shot.index} shot={shot} elapsed={elapsed}
    scale={choreo.cardScale} geometry={geometry} ring={ring} />)}</>;
}

function Beam({ shot, elapsed, scale, geometry, ring }: {
  readonly shot: CardShot; readonly elapsed: Readonly<{ current: number }>; readonly scale: number;
  readonly geometry: CylinderGeometry; readonly ring: RingGeometry;
}) {
  const group = useRef<Group>(null);
  const column = useRef<Group>(null);
  const color = useRarityIndex().colorOf(shot.rarity);
  const materials = useMemo(() => [0.32, 0.55, 0.75].map((opacity) => new MeshBasicMaterial({
    color: new Color(color).multiplyScalar(1.8), opacity, transparent: true, depthWrite: false,
    blending: AdditiveBlending, toneMapped: false, fog: false,
  })), [color]);
  useEffect(() => () => materials.forEach((material) => material.dispose()), [materials]);
  useFrame(() => {
    const strength = landingBeamEnvelope(shot, elapsed.current);
    const progress = Math.max(0, Math.min(1, (elapsed.current - shot.delay) / shot.flight));
    if (column.current) column.current.position.y = FALL_HEIGHT * (1 - progress) ** 3;
    if (group.current) group.current.visible = strength > 0;
    materials[0]!.opacity = strength * 0.32;
    materials[1]!.opacity = strength * 0.55;
    materials[2]!.opacity = strength * 0.75 * Math.max(0, (progress - 0.8) / 0.2);
  });
  return <group ref={group} position={[shot.slot[0], shot.slot[1], 0.035]} visible={false}>
    <group ref={column}>
    <mesh geometry={geometry} material={materials[0]!} position={[0, FALL_HEIGHT / 2, 0]} scale={[scale, FALL_HEIGHT, scale]} />
    <mesh geometry={geometry} material={materials[1]!} position={[0, FALL_HEIGHT / 2, 0]} scale={[scale * 0.32, FALL_HEIGHT, scale * 0.32]} />
    </group>
    <mesh geometry={ring} material={materials[2]!} scale={scale} />
  </group>;
}
