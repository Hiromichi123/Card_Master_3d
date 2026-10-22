import { RoomMirrorMaterial } from './RoomMirrorMaterial';
import type { QualityLevel } from '../table/materials';

const noHit = (): void => {};
/** Five bounded planar mirrors; moderate render targets keep room reflections affordable. */
export function StandardMirrorRoom({ quality }: { readonly quality: QualityLevel }) {
  const resolution = quality === 'high' ? 512 : quality === 'medium' ? 384 : 128;
  const sides: readonly { position: [number, number, number]; rotation: [number, number, number] }[] = [
    { position: [-26, 9.6, 0], rotation: [0, Math.PI / 2, 0] },
    { position: [26, 9.6, 0], rotation: [0, -Math.PI / 2, 0] },
    { position: [0, 9.6, -26], rotation: [0, 0, 0] },
    { position: [0, 9.6, 26], rotation: [0, Math.PI, 0] },
  ];
  return <group>
    {sides.map((side, index) => <mesh key={index} position={side.position} rotation={side.rotation} raycast={noHit}>
      <planeGeometry args={[52, 28]} />
      <RoomMirrorMaterial resolution={resolution} mirror={1} mixStrength={1.5} index={index}
        color="#ffffff" roughness={.012} />
    </mesh>)}
    <mesh position={[0, 23.6, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={noHit}>
      <planeGeometry args={[52, 52]} />
      <RoomMirrorMaterial resolution={resolution} mirror={.94} mixStrength={1.1} index={4}
        color="#e4e8eb" roughness={.04} />
    </mesh>
  </group>;
}
