import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { WebGLGuard } from '../../scenes/WebGLGuard';

function Crystal({ color, still, world }: { color: string; still: boolean; world: boolean }) {
  const crystal = useRef<Group>(null);
  useFrame(({ clock }, delta) => {
    if (still || !crystal.current) return;
    crystal.current.rotation.y += Math.min(delta, 0.05) * 0.32;
    crystal.current.position.y = Math.sin(clock.elapsedTime * 0.9) * 0.09;
  });
  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[3, 5, 4]} intensity={3} color="#e8f5ff" />
      <pointLight position={[-3, 1, -1]} intensity={15} color={world ? '#bb8cff' : color} />
      <pointLight position={[2, -1, 2]} intensity={9} color={world ? '#76e5d0' : color} />
      <group ref={crystal} rotation={[0.12, 0.35, 0.08]}>
        <mesh name="golden-core">
          <sphereGeometry args={[0.34, 24, 16]} />
          <meshStandardMaterial color="#ffdb70" emissive="#ffbd32" emissiveIntensity={2.2} roughness={0.2} toneMapped={false} />
        </mesh>
        <pointLight color="#ffd36a" intensity={3} distance={3} decay={2} />
        <mesh name="golden-halo" renderOrder={1}>
          <sphereGeometry args={[0.48, 24, 16]} />
          <meshBasicMaterial color="#ffd979" transparent opacity={0.12} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh name="transparent-shell" scale={[0.85, 1.55, 0.85]} renderOrder={2}>
          <octahedronGeometry args={[1.2, 0]} />
          <meshPhysicalMaterial color={color} metalness={0.04} roughness={0.12} clearcoat={1}
            transparent opacity={0.3} depthWrite={false} transmission={0.15} thickness={0.12} ior={1.2}
            emissive={color} emissiveIntensity={0.08} flatShading />
        </mesh>
        <mesh scale={[0.86, 1.56, 0.86]} renderOrder={3}>
          <octahedronGeometry args={[1.2, 0]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.55} depthWrite={false} />
        </mesh>
        {[-1, 1].map(side => (
          <mesh key={side} position={[side * 1.45, -0.3, 0]} scale={[0.18, 0.42, 0.18]} rotation={[0, 0, side * -0.2]}>
            <octahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} metalness={0.4} roughness={0.2} />
          </mesh>
        ))}
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.05, 0]}>
        <torusGeometry args={[1.25, 0.025, 8, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.65} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.07, 0]}>
        <circleGeometry args={[1.28, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.09} />
      </mesh>
    </>
  );
}

export function LadderCrystal({ color, still, world }: { color: string; still: boolean; world: boolean }) {
  return (
    <div className="ladder__crystal" data-color={color} data-still={still} aria-hidden="true">
      <WebGLGuard fallback={<div className="ladder__crystal-fallback" style={{ ['--crystal-color' as string]: color }} />}>
        <Canvas camera={{ position: [0, 0.6, 6.6], fov: 44 }} dpr={[1, 1.5]}
          frameloop={still ? 'demand' : 'always'} gl={{ alpha: true, antialias: true }}>
          <Crystal color={color} still={still} world={world} />
        </Canvas>
      </WebGLGuard>
    </div>
  );
}
