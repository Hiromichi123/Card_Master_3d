import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { ExtrudeGeometry, Path, Shape, type Group } from 'three';
import { damp } from '../anim/motion';
import { GachaBackdropImage } from './GachaBackdropImage';
import { useSettingsStore } from '../../state/settingsStore';
import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { buildMaterial } from '../table/materials';
import { backdropSize } from './choreography';
import { framedBackdropSize, GACHA_BOARD_Z } from './revealStyle';

const VOID_FRAGMENT = `
  varying vec2 vUv;
  uniform float uTime;
  float noise(vec2 p) {
    return sin(p.x * 1.7 + sin(p.y * 1.3)) * sin(p.y * 1.1 + cos(p.x * 1.5));
  }
  void main() {
    vec2 p = (vUv - 0.5) * 7.0;
    float cloud = 0.5 + 0.22 * noise(p + uTime * 0.035)
      + 0.14 * noise(p * 2.1 - uTime * 0.025) + 0.07 * noise(p * 4.3);
    float flow = pow(clamp(cloud, 0.0, 1.0), 1.4);
    vec3 gold = vec3(0.84, 0.63, 0.22);
    vec3 ivory = vec3(1.0, 0.98, 0.91);
    vec3 color = mix(gold, ivory, smoothstep(0.18, 0.68, flow));
    color = mix(color, vec3(1.0), smoothstep(0.6, 0.86, cloud) * 0.7);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

function frameGeometry(width: number, height: number, rim: number): ExtrudeGeometry {
  const x = width / 2 + rim;
  const y = height / 2 + rim;
  const r = rim * 0.45;
  const shape = new Shape();
  shape.moveTo(-x + r, -y); shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r); shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y); shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r); shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);
  const hole = new Path();
  hole.moveTo(-width / 2, -height / 2); hole.lineTo(-width / 2, height / 2);
  hole.lineTo(width / 2, height / 2); hole.lineTo(width / 2, -height / 2); hole.closePath();
  shape.holes.push(hole);
  const geometry = new ExtrudeGeometry(shape, { depth: rim * 0.6, bevelEnabled: true,
    bevelThickness: rim * 0.12, bevelSize: rim * 0.12, bevelSegments: 2, curveSegments: 4 });
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++) uv.setXY(i, (position.getX(i) + x) / (2 * x), (position.getY(i) + y) / (2 * y));
  return geometry;
}

/** Pool illustration on a physical wood-framed board, surrounded by a golden-white void. */
export function GachaBackdrop({ url, distance, aspect, menuActive = false, menuDistance = distance }: {
  readonly url: string | null;
  readonly distance: number;
  readonly aspect: number;
  readonly menuActive?: boolean;
  readonly menuDistance?: number;
}) {
  const quality = useSettingsStore((state) => state.quality);
  const still = useSettingsStore((state) => state.reduceMotion);
  const depth = -GACHA_BOARD_Z;
  const board = useRef<Group>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    pointer.current.x = pointer.current.y = 0;
    if (!menuActive || still) return;
    const move = (event: PointerEvent): void => {
      const bounds = gl.domElement.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      pointer.current.x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
      pointer.current.y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
    };
    const reset = (): void => { pointer.current.x = pointer.current.y = 0; };
    window.addEventListener('pointermove', move);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('blur', reset);
      reset();
    };
  }, [gl, menuActive, still]);
  useFrame((_, delta) => {
    if (!board.current) return;
    const [w, h] = backdropSize(menuDistance + depth, 42, aspect);
    // Main-menu motion: 50px, damping 5, bounded by the cropped margin.
    const x = menuActive && !still ? pointer.current.x * Math.min(50, size.width * 0.08) * w / Math.max(1, size.width) : 0;
    const y = menuActive && !still ? -pointer.current.y * Math.min(50, size.height * 0.08) * h / Math.max(1, size.height) : 0;
    board.current.position.x = still ? 0 : damp(board.current.position.x, x, 5, delta);
    board.current.position.y = still ? 0 : damp(board.current.position.y, y, 5, delta);
  });
  const [viewWidth, viewHeight] = backdropSize(distance + depth, 42, aspect);
  const [width, height] = framedBackdropSize(viewWidth, viewHeight, 1.6);
  const rim = Math.min(0.14, viewHeight * 1.45 * 0.035);
  const geometry = useMemo(() => frameGeometry(width, height, rim), [width, height, rim]);
  const wood = useMemo(() => {
    // The same wood-grain, normal and clearcoat material factory as the battle board.
    const material = buildMaterial({ kind: 'wood', color: 0xffffff, light: 0x956a3f, dark: 0x3d2314,
      rings: 12, turbulence: 4, roughness: 0.5, clearcoat: 0.3 }, { quality });
    material.fog = false;
    return material;
  }, [quality]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => wood.dispose(), [wood]);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame((_, delta) => { if (!still) uniforms.uTime.value += Math.min(delta, 0.05) / ANIMATION_DURATION_SCALE; });
  return (
    <>
      <mesh position={[0, 0, -depth - 4]} renderOrder={-10}>
        <planeGeometry args={[viewWidth * 5, viewHeight * 5]} />
        <shaderMaterial uniforms={uniforms} depthWrite={false} toneMapped={false} fog={false}
          vertexShader="varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }"
          fragmentShader={VOID_FRAGMENT} />
      </mesh>
      <group ref={board} position={[0, 0, -depth]}>
        <mesh position={[0, 0, -rim * 0.3]}>
          <boxGeometry args={[width + rim * 2, height + rim * 2, rim * 0.4]} />
          <primitive object={wood} attach="material" />
        </mesh>
        <mesh geometry={geometry} material={wood} />
        <GachaBackdropImage url={url} width={width} height={height} z={rim * 0.08} />
        <mesh position={[0, 0, rim * 0.08 + 0.001]} receiveShadow>
          <planeGeometry args={[width, height]} />
          <shadowMaterial transparent opacity={0.24} depthWrite={false} />
        </mesh>
      </group>
    </>
  );
}
