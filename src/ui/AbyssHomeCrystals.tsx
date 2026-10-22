import { ActivityCanvas as Canvas } from '../rendering/ActivityCanvas';
import { RenderActivity } from '../rendering/RenderActivity';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { BufferGeometry, Float32BufferAttribute, EdgesGeometry, CanvasTexture, Color, SRGBColorSpace, AdditiveBlending,
  type Group, type MeshPhysicalMaterial, type OrthographicCamera, type ShaderMaterial } from 'three';
import { WebGLGuard } from '../scenes/WebGLGuard';

export interface AbyssCrystalEntry {
  readonly title: string;
  readonly detail: string;
  readonly disabled: boolean;
  readonly action: () => void;
}

/** A single transparent renderer aligns four actual faceted crystals with accessible DOM controls. */
export function AbyssHomeCrystals({ entries, anchors, active, still, onReady }: {
  readonly entries: readonly AbyssCrystalEntry[];
  readonly anchors: RefObject<Map<number, HTMLSpanElement>>;
  readonly active: number | null;
  readonly still: boolean;
  readonly onReady: () => void;
}) {
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return <div className="abyss-home-crystals" aria-hidden="true">
    <WebGLGuard fallback={null}>
      <Canvas activityFps={active === null ? 30 : 60} orthographic camera={{ position: [0, 0, 1000], near: 1, far: 2200, zoom: 1 }} dpr={[1, 1.5]}
        frameloop={!visible ? 'never' : still ? 'demand' : 'always'} gl={{ alpha: true, antialias: true }}
        onCreated={onReady} style={{ pointerEvents: 'none' }}>
        <RenderActivity mode={still ? 'demand' : 'always'} fps={active === null ? 30 : 60} />
        <ambientLight intensity={.95} color="#d1bde8" />
        <directionalLight position={[-180, 320, 500]} intensity={2.5} color="#f4d19a" />
        <directionalLight position={[300, 90, 300]} intensity={1.9} color="#b995df" />
        <directionalLight position={[-120, -230, 220]} intensity={1.2} color="#ddc191" />
        <CrystalModels entries={entries} anchors={anchors} active={active} still={still} visible={visible} />
      </Canvas>
    </WebGLGuard>
  </div>;
}

/** Six-point star with raised center, secondary cuts and a bevelled rim. */
function crystalGeometry(): BufferGeometry {
  const vertices: number[] = [], colors: number[] = [];
  const color = new Color(), gold = new Color('#cda465'), purple = new Color('#966cc1');
  const point = (index: number, radius: number, z: number): number[] => {
    const angle = Math.PI / 2 - index * Math.PI / 6;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius, z];
  };
  const cut = (a: number[], b: number[], c: number[], sector: number, light: number) => {
    color.copy(purple).lerp(gold, .5 + Math.sin(sector * Math.PI / 3 + .25) * .38).multiplyScalar(.60 + light * .43);
    // Clockwise contour, reversed so every front cut faces the viewer.
    for (const v of [a, c, b]) { vertices.push(...v); colors.push(color.r, color.g, color.b); }
  };
  for (let i = 0; i < 12; i += 1) {
    const j = (i + 1) % 12, ri = i % 2 === 0 ? .80 : .53, rj = j % 2 === 0 ? .80 : .53;
    const outerA = point(i, ri, 0), outerB = point(j, rj, 0);
    const bevelA = point(i, ri * .91, .13), bevelB = point(j, rj * .91, .13);
    const innerA = point(i, .35, .28 + (i % 3) * .015), innerB = point(j, .35, .28 + (j % 3) * .015);
    cut([.015, .04, .42], innerA, innerB, i, .67);
    cut(innerA, bevelA, bevelB, i, i % 2 ? .56 : .66);
    cut(innerA, bevelB, innerB, i, i % 2 ? .69 : .55);
    cut(bevelA, outerA, outerB, i, .78);
    cut(bevelA, outerB, bevelB, i, .70);
    const backA = point(i, ri * .97, -.16), backB = point(j, rj * .97, -.16);
    cut(outerA, backA, backB, i, .42); cut(outerA, backB, outerB, i, .47);
    cut([0, 0, -.19], backB, backA, i, .49);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function crystalSparkles(): BufferGeometry {
  const positions: number[] = [], phases: number[] = [];
  for (let i = 0; i < 44; i += 1) {
    const angle = i * 2.39996, radius = .08 + ((i * 17) % 43) / 43 * .38;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, .48);
    phases.push(i * 1.73);
  }
  // Fine sparkle on the six tips, rather than a surrounding rectangular glow.
  for (let i = 0; i < 6; i += 1) {
    const angle = Math.PI / 2 - i * Math.PI / 3;
    positions.push(Math.cos(angle) * .76, Math.sin(angle) * .76, .15); phases.push(i * 2.17);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('phase', new Float32BufferAttribute(phases, 1));
  return geometry;
}

function goldTitle(title: string): CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 320;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gold = ctx.createLinearGradient(0, 45, 0, 275);
    gold.addColorStop(0, '#fff4c7'); gold.addColorStop(.35, '#ffe09b'); gold.addColorStop(.65, '#bc8237'); gold.addColorStop(1, '#f5d383');
    ctx.font = 'bold 224px "SimSun", "Songti SC", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = '#251529'; ctx.shadowColor = '#0b0518'; ctx.shadowBlur = 18;
    ctx.strokeText(title, 512, 160, 950); ctx.fillStyle = gold; ctx.fillText(title, 512, 160, 950);
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  return texture;
}
const coreVertex = `varying vec3 vPoint;varying vec3 vTint;
void main(){vPoint=position;vTint=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const coreFragment = `uniform float time;uniform float strength;uniform vec3 gold;uniform vec3 purple;varying vec3 vPoint;varying vec3 vTint;
void main(){float sweep=pow(max(0.,sin(vPoint.x*7.+vPoint.y*5.-time*.48)),18.);
float vein=pow(max(0.,sin(vPoint.x*31.-vPoint.y*19.+time*.23)),28.);
float core=exp(-dot(vPoint.xy,vPoint.xy)*14.);
float breath=.5+.5*sin(time*.55);
vec3 tint=mix(purple,gold,breath);
gl_FragColor=vec4(mix(vTint,tint,.78)*(.85+sweep*.18),(.035+sweep*.09+vein*.025+core*.035)*strength*(.65+breath*.35));}`;
const sparkleVertex = `attribute float phase;uniform float time;uniform float pointSize;varying float vAlpha;
void main(){vAlpha=.25+.75*pow(.5+.5*sin(time*.72+phase),4.);
gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=pointSize*(.65+vAlpha*.5);}`;
const sparkleFragment = `varying float vAlpha;
void main(){vec2 p=gl_PointCoord-.5;float rays=exp(-p.x*p.x*280.-p.y*p.y*18.)+exp(-p.y*p.y*280.-p.x*p.x*18.);
float center=exp(-dot(p,p)*65.);float alpha=(rays*.38+center*.65)*vAlpha*.65;
if(alpha<.015)discard;gl_FragColor=vec4(vec3(1.,.83,.55),alpha);}`;

function CrystalModels({ entries, anchors, active, still, visible }: {
  readonly entries: readonly AbyssCrystalEntry[]; readonly anchors: RefObject<Map<number, HTMLSpanElement>>;
  readonly active: number | null; readonly still: boolean; readonly visible: boolean;
}) {
  const { camera, size, gl, invalidate } = useThree();
  const geometry = useMemo(crystalGeometry, []), edges = useMemo(() => new EdgesGeometry(geometry, 20), [geometry]);
  const sparkles = useMemo(crystalSparkles, []);
  useEffect(() => () => { geometry.dispose(); edges.dispose(); sparkles.dispose(); }, [geometry, edges, sparkles]);
  useLayoutEffect(() => {
    const view = camera as OrthographicCamera;
    view.left = -size.width / 2; view.right = size.width / 2; view.top = size.height / 2; view.bottom = -size.height / 2;
    view.updateProjectionMatrix(); invalidate();
  }, [camera, size.width, size.height, invalidate]);
  useEffect(() => { invalidate(); }, [entries, active, still, visible, invalidate]);
  return <>{entries.map((entry, index) => <Crystal key={entry.title} entry={entry} index={index} geometry={geometry} edges={edges} sparkles={sparkles}
    anchor={anchors} canvas={gl.domElement} width={size.width} height={size.height} active={active === index} still={still} />)}</>;
}

function Crystal({ entry, index, geometry, edges, sparkles, anchor, canvas, width, height, active, still }: {
  readonly entry: AbyssCrystalEntry; readonly index: number; readonly geometry: BufferGeometry; readonly edges: EdgesGeometry; readonly sparkles: BufferGeometry;
  readonly anchor: RefObject<Map<number, HTMLSpanElement>>; readonly canvas: HTMLCanvasElement;
  readonly width: number; readonly height: number; readonly active: boolean; readonly still: boolean;
}) {
  const group = useRef<Group>(null), body = useRef<MeshPhysicalMaterial>(null), glow = useRef<ShaderMaterial>(null);
  const sparkle = useRef<ShaderMaterial>(null);
  const goldGlow = useMemo(() => new Color('#d6ac68'), []), purpleGlow = useMemo(() => new Color('#9b6cc8'), []);
  const uniforms = useMemo(() => ({ time: { value: 0 }, strength: { value: 1 }, gold: { value: goldGlow }, purple: { value: purpleGlow } }), [goldGlow, purpleGlow]);
  const sparkUniforms = useMemo(() => ({ time: { value: 0 }, pointSize: { value: 4.8 } }), []);
  const title = useMemo(() => goldTitle(entry.title), [entry.title]);
  useEffect(() => () => title.dispose(), [title]);
  useFrame(({ clock }, delta) => {
    const model = group.current, node = anchor.current.get(index);
    if (!model || !node) return;
    const surface = canvas.getBoundingClientRect(), rect = node.getBoundingClientRect();
    model.visible = rect.width > 0 && rect.height > 0 && surface.width > 0 && surface.height > 0 && rect.bottom > surface.top && rect.top < surface.bottom;
    if (!model.visible) return;
    const sx = width / surface.width, sy = height / surface.height;
    const time = still ? 0 : clock.elapsedTime, hover = active && !entry.disabled;
    const base = Math.min(rect.width * sx / 2.10, rect.height * sy / 2.20), blend = still ? 1 : 1 - Math.exp(-Math.min(.1, delta) * 7);
    const scale = base * (hover ? 1.06 : 1);
    model.scale.setScalar(model.scale.x + (scale - model.scale.x) * blend);
    model.position.set((rect.left + rect.width / 2 - surface.left - surface.width / 2) * sx,
      (surface.top + surface.height / 2 - rect.top - rect.height / 2) * sy + (hover ? 7 : 0) + (still ? 0 : Math.sin(time * .55 + index * 1.6) * 2), 0);
    model.rotation.y += ((hover ? -.10 : .17) + (still ? 0 : Math.sin(time * .20 + index) * .12) - model.rotation.y) * blend;
    model.rotation.x = -.055; model.rotation.z = (index % 2 ? -1 : 1) * .035 + (still ? 0 : Math.sin(time * .16 + index) * .025);
    const breath = still ? .5 : .5 + .5 * Math.sin(time * .55 + index * .75);
    if (body.current) {
      body.current.emissive.copy(purpleGlow).lerp(goldGlow, breath);
      body.current.emissiveIntensity = entry.disabled ? .035 : (hover ? .18 : .09) + breath * .04;
    }
    if (glow.current) { glow.current.uniforms.time!.value = time + index * 1.36; glow.current.uniforms.strength!.value = entry.disabled ? .3 : hover ? 1.3 : .85; }
    if (sparkle.current) { sparkle.current.uniforms.time!.value = time + index * 2; sparkle.current.uniforms.pointSize!.value = hover ? 6 : 4.8; }
  });
  return <group ref={group}>
    <mesh geometry={geometry} dispose={null}>
      <meshPhysicalMaterial ref={body} color="#ffffff" vertexColors metalness={.18} roughness={.21} clearcoat={1} clearcoatRoughness={.08}
        emissive="#aa79cc" emissiveIntensity={.11} transparent opacity={entry.disabled ? .62 : .96} depthWrite={false} />
    </mesh>
    <lineSegments geometry={edges} dispose={null}>
      <lineBasicMaterial color={active && !entry.disabled ? '#ebcc92' : '#bb93d4'} transparent opacity={entry.disabled ? .16 : .36} />
    </lineSegments>
    <mesh geometry={geometry} position={[0, 0, .008]} dispose={null}>
      <shaderMaterial ref={glow} uniforms={uniforms} vertexShader={coreVertex} fragmentShader={coreFragment}
        vertexColors transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
    <mesh position={[0, .075, .46]} rotation={[0, 0, Math.PI / 2]}>
      <circleGeometry args={[.34, 3]} />
      <meshPhysicalMaterial color="#d2b9e5" emissive="#d1ae76" emissiveIntensity={.16} metalness={.12} roughness={.15}
        transparent opacity={entry.disabled ? .08 : .17} depthWrite={false} clearcoat={1} />
    </mesh>
    <points geometry={sparkles} dispose={null}>
      <shaderMaterial ref={sparkle} uniforms={sparkUniforms} vertexShader={sparkleVertex} fragmentShader={sparkleFragment}
        transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
    </points>
    <mesh position={[0, .035, .53]}><planeGeometry args={[1.25, .36]} /><meshBasicMaterial map={title} transparent
      opacity={entry.disabled ? .50 : 1} toneMapped={false} depthWrite={false} /></mesh>
  </group>;
}
