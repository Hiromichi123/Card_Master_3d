import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry, BufferGeometry, Euler, ExtrudeGeometry,
  Float32BufferAttribute, Matrix4, Quaternion, Shape, Vector3,
  type Group, type InstancedMesh, type Material, type ShaderMaterial,
} from 'three';
import { buildMaterial, type QualityLevel } from '../table/materials';
import type { TableTheme } from '../table/themes';
import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { LAYOUT } from './layout';
import { MechaVoid } from './MechaVoid';

type Vec3 = readonly [number, number, number];
interface BoxPart { readonly position: Vec3; readonly size: Vec3; readonly rotation?: Vec3 }
interface Props { readonly theme: TableTheme; readonly quality: QualityLevel; readonly reduceMotion: boolean }
type SceneClock = Readonly<{ current: number }>;
const noHit = (): void => {};
const BATTLE_ROW = LAYOUT.battleZ - LAYOUT.tableCenterZ;
const PREP_ROW = LAYOUT.prepZ - LAYOUT.tableCenterZ;

function clippedPlate(width: number, depth: number, cut: number): Shape {
  const x = width / 2, z = depth / 2;
  const shape = new Shape();
  shape.moveTo(-x + cut, -z); shape.lineTo(x - cut, -z);
  shape.lineTo(x, -z + cut); shape.lineTo(x, z - cut);
  shape.lineTo(x - cut, z); shape.lineTo(-x + cut, z);
  shape.lineTo(-x, z - cut); shape.lineTo(-x, -z + cut); shape.closePath();
  return shape;
}

/** Machined armor with a level upper surface, keeping cards at their existing Y. */
function ArmorPlate({ width, depth, thickness, position, material }: {
  readonly width: number; readonly depth: number; readonly thickness: number;
  readonly position: Vec3; readonly material: Material;
}) {
  const geometry = useMemo(() => {
    const mesh = new ExtrudeGeometry(clippedPlate(width, depth, Math.min(.36, width * .08)), {
      depth: thickness, bevelEnabled: true, bevelSize: .045, bevelThickness: .015, bevelSegments: 2,
    });
    mesh.rotateX(-Math.PI / 2);
    mesh.translate(0, -thickness - .015, 0);
    return mesh;
  }, [width, depth, thickness]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh position={position} geometry={geometry} material={material} receiveShadow castShadow raycast={noHit} />;
}

/** Repeated structural details share one draw batch per material. */
function BoxParts({ parts, material }: { readonly parts: readonly BoxPart[]; readonly material: Material }) {
  const mesh = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    const object = mesh.current;
    if (!object) return;
    const matrix = new Matrix4(), position = new Vector3(), scale = new Vector3();
    const rotation = new Quaternion(), euler = new Euler();
    parts.forEach((part, i) => {
      position.set(...part.position); scale.set(...part.size);
      const angles: Vec3 = part.rotation ?? [0, 0, 0];
      euler.set(angles[0], angles[1], angles[2]); rotation.setFromEuler(euler);
      matrix.compose(position, rotation, scale); object.setMatrixAt(i, matrix);
    });
    object.instanceMatrix.needsUpdate = true;
    object.computeBoundingSphere();
  }, [parts, material]);
  return <instancedMesh ref={mesh} args={[geometry, material, parts.length]} castShadow receiveShadow raycast={noHit} />;
}

const PANEL_FRAGMENT = `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uSide;
  void main() {
    float scan = fract(uTime * 0.11 + (uSide > 0.0 ? 0.0 : 0.5));
    float beam = 1.0 - smoothstep(0.006, 0.038, abs(vUv.y - scan));
    float edge = (1.0 - step(0.012, min(vUv.x, 1.0 - vUv.x))) *
      (0.4 + 0.6 * step(0.65, fract(vUv.y * 9.0)));
    float ports = step(0.95, vUv.x) * step(0.83, fract(vUv.y * 5.0));
    float alpha = beam * 0.18 + edge * 0.22 + ports * 0.16;
    if (alpha < 0.015) discard;
    gl_FragColor = vec4(vec3(0.04, 0.56, 0.67), alpha);
    #include <colorspace_fragment>
  }
`;

function EnergyPanel({ clock, side, width, depth, z }: {
  readonly clock: SceneClock; readonly side: number; readonly width: number; readonly depth: number; readonly z: number;
}) {
  const material = useRef<ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uSide: { value: side } }), [side]);
  useFrame(() => { if (material.current) material.current.uniforms['uTime']!.value = clock.current; });
  return <mesh position={[0, .004, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={noHit}>
    <planeGeometry args={[width, depth]} />
    <shaderMaterial ref={material} uniforms={uniforms} transparent depthWrite={false} toneMapped={false}
      vertexShader="varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }"
      fragmentShader={PANEL_FRAGMENT} />
  </mesh>;
}

function Reactor({ clock, x, white, steel, energy, segments }: {
  readonly clock: SceneClock; readonly x: number; readonly white: Material;
  readonly steel: Material; readonly energy: Material; readonly segments: number;
}) {
  const rotor = useRef<Group>(null);
  useFrame(() => {
    if (!rotor.current) return;
    rotor.current.rotation.y = clock.current * .34 * Math.sign(x);
    rotor.current.position.y = .29 + Math.sin(clock.current * 1.3) * .025;
  });
  return <group position={[x, 0, 0]}>
    <mesh position={[0, .03, 0]} material={white} raycast={noHit}><cylinderGeometry args={[.43, .53, .12, 6]} /></mesh>
    <mesh position={[0, .11, 0]} material={steel} rotation={[Math.PI / 2, 0, 0]} raycast={noHit}>
      <torusGeometry args={[.34, .045, 6, segments]} />
    </mesh>
    <group ref={rotor} position={[0, .29, 0]}>
      <mesh material={energy} scale={[.72, 1.15, .72]} raycast={noHit}><octahedronGeometry args={[.24]} /></mesh>
      <mesh material={energy} rotation={[.45, 0, .35]} raycast={noHit}>
        <torusGeometry args={[.42, .017, 5, segments, Math.PI * 1.5]} />
      </mesh>
    </group>
  </group>;
}

function PatrolProbe({ clock, side, white, steel, energy, segments }: {
  readonly clock: SceneClock; readonly side: number; readonly white: Material;
  readonly steel: Material; readonly energy: Material; readonly segments: number;
}) {
  const carrier = useRef<Group>(null), rotor = useRef<Group>(null);
  useFrame(() => {
    const phase = clock.current * .4 + (side < 0 ? Math.PI : 0);
    if (carrier.current) {
      carrier.current.position.z = Math.sin(phase) * 3.4;
      carrier.current.position.y = 1.04 + Math.sin(phase * 1.7) * .07;
      carrier.current.rotation.z = Math.cos(phase) * .045;
    }
    if (rotor.current) rotor.current.rotation.y = clock.current * -.65 * side;
  });
  return <group ref={carrier} position={[side * 6.38, 1.04, 0]}>
    <mesh material={white} castShadow raycast={noHit}><cylinderGeometry args={[.28, .4, .17, 6]} /></mesh>
    <mesh material={steel} position={[0, -.09, 0]} raycast={noHit}><cylinderGeometry args={[.23, .21, .045, 6]} /></mesh>
    <group ref={rotor} position={[0, .035, 0]}>
      <mesh material={energy} rotation={[Math.PI / 2, 0, 0]} raycast={noHit}><torusGeometry args={[.46, .021, 5, segments, Math.PI * 1.7]} /></mesh>
    </group>
    <mesh position={[0, -.62, 0]} raycast={noHit}>
      <cylinderGeometry args={[.018, .045, 1.05, 6]} />
      <meshBasicMaterial color="#43b6cd" transparent opacity={.18} depthWrite={false} toneMapped={false} />
    </mesh>
  </group>;
}

function EdgeMotes({ clock, quality }: { readonly clock: SceneClock; readonly quality: QualityLevel }) {
  const material = useRef<ShaderMaterial>(null);
  const geometry = useMemo(() => {
    const count = quality === 'high' ? 112 : quality === 'medium' ? 64 : 24;
    const vertices = Array.from({ length: count }, (_, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      return [side * (5.8 + ((i * .618) % 1) * .8), (i * .173) % 1.3, Math.sin(i * 2.399) * 4.4];
    });
    return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(vertices.flat(), 3));
  }, [quality]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame(() => { if (material.current) material.current.uniforms['uTime']!.value = clock.current; });
  return <points geometry={geometry} raycast={noHit} frustumCulled={false}>
    <shaderMaterial ref={material} uniforms={uniforms} transparent depthWrite={false} toneMapped={false}
      vertexShader={`uniform float uTime; void main(){
        vec3 p = position; p.y = 0.2 + mod(p.y + uTime * 0.11, 1.35);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(42.0 / max(1.0, -mv.z), 1.0, 3.0);
        gl_Position = projectionMatrix * mv;
      }`}
      fragmentShader={`void main(){
        float radius = length(gl_PointCoord - vec2(0.5));
        if(radius > 0.5) discard;
        gl_FragColor = vec4(0.06, 0.62, 0.73, (1.0 - smoothstep(0.12, 0.5, radius)) * 0.42);
        #include <colorspace_fragment>
      }`} />
  </points>;
}

/** Grey metal armored arena carried by a suspended technology cube. */
export function MechaTable({ theme, quality, reduceMotion }: Props) {
  const clock = useRef(0);
  const materials = useMemo(() => ({
    white: buildMaterial(theme.mat.light, { quality }),
    secondary: buildMaterial(theme.mat.dark, { quality }),
    steel: buildMaterial(theme.mat.frame, { quality }),
    energy: buildMaterial({ kind: 'plain', color: 0x4fc2d6, metalness: .25, roughness: .3,
      emissive: 0x1bb7d1, emissiveIntensity: 1.25 }, { quality }),
  }), [theme, quality]);
  useEffect(() => () => { for (const material of Object.values(materials)) material.dispose(); }, [materials]);
  useFrame((_, delta) => {
    if (!reduceMotion) clock.current += Math.min(delta, .05) / ANIMATION_DURATION_SCALE;
    materials.energy.emissiveIntensity = 1.12 + Math.sin(clock.current * 1.1) * .16;
  });
  const hardware = useMemo(() => {
    const white: BoxPart[] = [], steel: BoxPart[] = [], glow: BoxPart[] = [];
    for (const side of [-1, 1]) {
      // Side armor rails and maintenance-carrier tracks sit outside the card field.
      white.push({ position: [side * 5.57, -.08, 0], size: [.42, .15, 9.65] });
      steel.push({ position: [side * 6.38, -.22, 0], size: [.21, .22, 8.75] });
      glow.push({ position: [side * 6.38, -.098, 0], size: [.045, .022, 8.35] });
      for (const end of [-1, 1]) {
        // Feet, track struts, segmented end bumpers and separate card-pile plinths.
        steel.push({ position: [side * 4.85, -.69, end * 4.5], size: [.58, .86, .7] });
        white.push({ position: [side * 5.94, -.2, end * 3.9], size: [.77, .24, .35] });
        white.push({ position: [side * 5.54, -.11, end * 4.97], size: [.85, .21, .57] });
        white.push({ position: [side * 4.72, -.055, end * PREP_ROW], size: [.81, .1, 1.08] });
        glow.push({ position: [side * 4.73, .002, end * (PREP_ROW + .5)], size: [.6, .009, .023] });
        white.push({ position: [side * 6.38, .3, end * 4.48], size: [.29, .78, .3] });
        glow.push({ position: [side * 6.38, .7, end * 4.48], size: [.21, .025, .21] });
        for (let i = 0; i < 6; i++) {
          steel.push({ position: [side * 5.58, .002, end * (1.3 + i * .27)], size: [.26, .009, .065] });
        }
      }
      for (const z of [-BATTLE_ROW, BATTLE_ROW, -PREP_ROW, PREP_ROW]) {
        const w = Math.abs(z) === BATTLE_ROW ? 9.5 : 8.25;
        glow.push({ position: [0, .002, z + side * (Math.abs(z) === BATTLE_ROW ? 1.31 : .7)], size: [w, .008, .018] });
      }
    }
    // A recessed center spine replaces the chessboard's center seam.
    steel.push({ position: [0, -.025, 0], size: [8.4, .05, .42] });
    glow.push({ position: [0, .004, 0], size: [6.9, .012, .035] });
    for (const end of [-1, 1]) white.push({ position: [0, -.11, end * 5.42], size: [9.4, .16, .32] });
    return { white, steel, glow };
  }, []);
  const segments = quality === 'low' ? 18 : quality === 'medium' ? 32 : 48;
  return <group position={[0, 0, LAYOUT.tableCenterZ]}>
    <MechaVoid clock={clock} quality={quality} />
    <ArmorPlate width={11.55} depth={11.35} thickness={.31} position={[0, -.18, 0]} material={materials.steel} />
    <ArmorPlate width={11.3} depth={11.06} thickness={.19} position={[0, -.035, 0]} material={materials.secondary} />
    {[-1, 1].map((side) => <group key={side}>
      <ArmorPlate width={9.85} depth={2.94} thickness={.14} position={[0, -.012, side * BATTLE_ROW]} material={materials.white} />
      <ArmorPlate width={8.48} depth={1.55} thickness={.13} position={[0, -.012, side * PREP_ROW]} material={materials.white} />
      <EnergyPanel clock={clock} side={side} width={9.4} depth={2.64} z={side * BATTLE_ROW} />
      <EnergyPanel clock={clock} side={-side} width={8.1} depth={1.33} z={side * PREP_ROW} />
      <Reactor clock={clock} x={side * 4.65} white={materials.white} steel={materials.steel} energy={materials.energy} segments={segments} />
      <PatrolProbe clock={clock} side={side} white={materials.white} steel={materials.steel} energy={materials.energy} segments={segments} />
    </group>)}
    <BoxParts parts={hardware.white} material={materials.white} />
    <BoxParts parts={hardware.steel} material={materials.steel} />
    <BoxParts parts={hardware.glow} material={materials.energy} />
    <EdgeMotes clock={clock} quality={quality} />
  </group>;
}
