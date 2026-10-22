import { hpLabelDimensions } from './boardVitalsThemes';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, CanvasTexture, Color, ExtrudeGeometry, LinearFilter, MeshStandardMaterial, SRGBColorSpace, ShaderMaterial, type Mesh } from 'three';
import { useSettingsStore } from '../../state/settingsStore';
import { numberCanvasFont } from '../text/numberFont';
import { abyssVitalsShape } from '../abyss/abyssVitalsShape';
import { ABYSS_VITALS as V } from '../abyss/abyssVitalsLayout';
import { BOARD_CENTER_Z } from './layout';

const noHit = (): void => {};
const vertex = `
uniform float uTime;
uniform float uFill;
uniform float uLength;
uniform float uWidth;
uniform float uDirection;
uniform float uHit;
uniform float uMotion;
uniform float uGlow;
varying float vAlong;
varying float vAcross;
varying float vTop;
void main() {
  vec3 p = position;
  vAlong = p.z * uFill + uDirection * (1.0 - uFill) * uLength * 0.5;
  vAcross = p.x / (uWidth * 0.5);
  vTop = normal.y;
  float phase = vAlong * 7.0 - uTime * 2.3 * uDirection;
  float crest = sin(phase) * 0.28 + sin(vAlong * 11.5 - uTime * 3.4 * uDirection) * 0.12;
  float breath = sin(uTime * 1.65) * 0.07;
  float hitWave = sin(vAlong * 15.0 - uTime * 8.0) * uHit * 0.10;
  p.x *= (0.94 + (crest + breath + hitWave) * uMotion) * (1.0 + uGlow * 2.2);
  if (p.y > 0.0) p.y += sin(phase) * 0.0012 * uMotion;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const fragment = `
uniform float uTime;
uniform float uLength;
uniform float uDirection;
uniform float uHit;
uniform float uGlow;
uniform vec3 uDeep;
uniform vec3 uLight;
varying float vAlong;
varying float vAcross;
varying float vTop;
void main() {
  float flow = vAlong * 18.0 - uTime * 5.2 * uDirection;
  float strands = pow(0.5 + 0.5 * sin(flow + sin(vAlong * 4.0 - uTime) + vAcross * 4.5), 5.0);
  float core = exp(-abs(vAcross + sin(vAlong * 8.0 - uTime * 1.8) * 0.18) * 3.0);
  float edge = pow(abs(vAcross), 6.0);
  float gradient = clamp(vAlong / uLength + 0.5, 0.0, 1.0);
  float eddy = pow(0.5 + 0.5 * sin(vAlong * 9.0 - uTime * 4.1 * uDirection - vAcross * 5.0), 3.0);
  if (uGlow > 0.5) {
    float feather = pow(max(0.0, 1.0 - abs(vAcross)), 2.3);
    gl_FragColor = vec4(uLight * 0.65, feather * (0.045 + strands * 0.055) * max(vTop, 0.0));
    return;
  }
  float pigment = 0.24 + gradient * 0.20 + core * 0.24 + strands * 0.30 + eddy * 0.08 + edge * 0.06;
  vec3 color = mix(uDeep, uLight, clamp(pigment, 0.0, 1.0));
  // Color-matched pulse, without white highlights or reflective overexposure.
  color *= 1.0 + uHit * (0.10 + strands * 0.12);
  color *= mix(0.58, 1.0, max(vTop, 0.0));
  gl_FragColor = vec4(min(color, vec3(0.90)), 1.0);
}`;

/** Sits inside the actual hole cut into the persistent abyss table. */
export function AbyssVitalsHousing() {
  const resources = useMemo(() => {
    const floor = new ExtrudeGeometry(abyssVitalsShape(V.width, V.length), { depth: .012, bevelEnabled: false, curveSegments: 16 });
    floor.rotateX(-Math.PI / 2); floor.translate(0, -.034, 0);
    const material = new MeshStandardMaterial({ color: '#14151d', metalness: 0, roughness: 1, envMapIntensity: 0 });
    return { floor, material };
  }, []);
  useEffect(() => () => { resources.floor.dispose(); resources.material.dispose(); }, [resources]);
  return <>{[-1, 1].map(side => <mesh key={side} position={[V.x, 0, side * V.z]}
    geometry={resources.floor} material={resources.material} receiveShadow raycast={noHit} />)}</>;
}

function hpLabel(maxHp: number, color: string) {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建深渊生命数字贴图');
  context.font = numberCanvasFont(112);
  const dimensions = hpLabelDimensions(maxHp, text => context.measureText(text).width);
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter; texture.magFilter = LinearFilter;
  let previous = -1;
  const write = (hp: number) => {
    const value = Math.max(0, Math.ceil(hp));
    if (value === previous) return;
    previous = value;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = numberCanvasFont(112); context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillStyle = color; context.fillText(`${value}/${maxHp}`, canvas.width / 2, 80);
    texture.needsUpdate = true;
  };
  return { texture, worldWidth: dimensions.worldWidth, worldHeight: dimensions.worldHeight, write };
}

export interface BoardVitalsLayout {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly length: number;
  readonly channelWidth: number;
}

export function LiquidChannel({ hp, maxHp, enemy, layout, palette, labelColor }: { readonly hp: number; readonly maxHp: number; readonly enemy: boolean; readonly layout: BoardVitalsLayout; readonly palette?: readonly [string, string]; readonly labelColor?: string }) {
  const still = useSettingsStore(state => state.reduceMotion);
  const target = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
  const ratio = useRef(target);
  const transition = useRef({ from: target, to: target, elapsed: 0, duration: 0 });
  const previousHp = useRef(hp), hit = useRef(0);
  const liquid = useRef<Mesh>(null);
  const glow = useRef<Mesh>(null);
  const length = layout.length - .04;
  const direction = enemy ? -1 : 1;
  const geometry = useMemo(() => {
    // Subdivide long edges so width waves travel along the body instead of moving only its ends.
    const capsule = new ExtrudeGeometry(abyssVitalsShape(layout.channelWidth, length, 0, 0, 96), { depth: .012, bevelEnabled: false, curveSegments: 16 });
    capsule.rotateX(-Math.PI / 2); capsule.translate(0, -.006, 0);
    return capsule;
  }, [length, layout.channelWidth]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uFill: { value: 1 }, uLength: { value: length },
      uWidth: { value: layout.channelWidth }, uDirection: { value: direction }, uMotion: { value: 1 }, uHit: { value: 0 }, uGlow: { value: 0 },
      uDeep: { value: new Color(palette?.[0] ?? (enemy ? '#780000' : '#006b00')) }, uLight: { value: new Color(palette?.[1] ?? (enemy ? '#e00000' : '#00df00')) } } }), [enemy, direction, length, layout.channelWidth, palette]);
  const glowMaterial = useMemo(() => new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment,
    uniforms: { ...material.uniforms, uGlow: { value: 1 } }, transparent: true, depthWrite: false,
    blending: AdditiveBlending, toneMapped: false }), [material]);
  useEffect(() => () => glowMaterial.dispose(), [glowMaterial]);
  const label = useMemo(() => hpLabel(maxHp, labelColor ?? (enemy ? layout === V ? '#ff3030' : '#a32020' : layout === V ? '#30df30' : '#087226')), [maxHp, enemy, layout, labelColor]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => label.texture.dispose(), [label]);
  useEffect(() => {
    if (hp < previousHp.current) hit.current = 1;
    previousHp.current = hp;
    if (transition.current.to !== target) transition.current = {
      from: ratio.current, to: target, elapsed: 0, duration: target < ratio.current ? .72 : .48,
    };
  }, [hp, target]);
  useFrame((_, delta) => {
    const dt = Math.min(.1, delta);
    const tween = transition.current;
    tween.elapsed = Math.min(tween.duration, tween.elapsed + dt);
    const progress = tween.duration > 0 ? Math.min(1, tween.elapsed / tween.duration) : 1;
    const eased = progress * progress * (3 - 2 * progress);
    ratio.current = still ? target : tween.from + (tween.to - tween.from) * eased;
    const level = progress === 1 || still ? target : Math.max(0, ratio.current);
    if (!still) material.uniforms.uTime!.value += dt;
    hit.current = still ? 0 : hit.current * Math.exp(-dt * 3.5);
    material.uniforms.uFill!.value = level;
    material.uniforms.uMotion!.value = still ? 0 : 1;
    material.uniforms.uHit!.value = hit.current;
    label.write(level * maxHp);
    for (const mesh of [liquid.current, glow.current]) {
      if (!mesh) continue;
      mesh.visible = level > .0001;
      mesh.scale.z = Math.max(.0001, level);
      mesh.position.z = direction * (1 - level) * length / 2;
    }
  });
  return <group position={[layout.x, 0, direction * layout.z]}>
    <mesh ref={liquid} position={[0, -.009, direction * (1 - target) * length / 2]} scale={[1, 1, Math.max(.0001, target)]} visible={target > 0} material={material} geometry={geometry} raycast={noHit} />
    <mesh ref={glow} position={[0, .004, direction * (1 - target) * length / 2]} scale={[1, 1, Math.max(.0001, target)]} visible={target > 0} material={glowMaterial} geometry={geometry} raycast={noHit} />
    <mesh position={[0, .022, direction * (layout.length / 2 + .30)]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1000} raycast={noHit}>
      <planeGeometry args={[label.worldWidth, label.worldHeight]} /><meshBasicMaterial map={label.texture} transparent depthTest={false} depthWrite={false} toneMapped={false} fog={false} />
    </mesh>
  </group>;
}

/** Uses the presentation HP, so liquid and numbers change at the actual hit cue. */
export function AbyssVitals({ playerHp, enemyHp, playerMaxHp, enemyMaxHp, layout = V }: {
  readonly playerHp: number; readonly enemyHp: number; readonly playerMaxHp: number; readonly enemyMaxHp: number;
  readonly layout?: BoardVitalsLayout;
}) {
  return <group position={[0, 0, BOARD_CENTER_Z]}>
    <LiquidChannel hp={playerHp} maxHp={playerMaxHp} enemy={false} layout={layout} />
    <LiquidChannel hp={enemyHp} maxHp={enemyMaxHp} enemy layout={layout} />
  </group>;
}
