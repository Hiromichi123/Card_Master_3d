import { ActivityCanvas as Canvas } from '../rendering/ActivityCanvas';
import { RenderActivity } from '../rendering/RenderActivity';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { CardDefinition } from '../domain/cards/types';
import { CardMesh } from '../rendering/cards/CardMesh';
import { rarityIndex } from '../state/useRarityIndex';
import { hideCardTip, showCardTip, moveCardTip } from '../state/cardTipStore';
import { useFrame, useThree } from '@react-three/fiber';
import { CanvasTexture, Color, SRGBColorSpace, type Group, type OrthographicCamera, type ShaderMaterial } from 'three';
import { getCardBodyGeometry, getCardFaceGeometry, CARD_FACE_OFFSET } from '../rendering/cards/cardGeometry';
import { useSettingsStore } from '../state/settingsStore';
import { WebGLGuard } from '../scenes/WebGLGuard';
import { abyssTraitTip } from './abyssTraitTip';
import { ABYSS_GRADE_INFO, type AbyssGrade } from '../domain/progression/abyssGrades';

export interface AbyssTraitItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly card?: CardDefinition;
  readonly grade?: AbyssGrade | undefined;
  readonly level?: number | undefined;
  readonly tone?: 'positive' | 'negative' | 'growth' | undefined;
  readonly footer?: string | undefined;
  readonly known?: boolean | undefined;
  readonly selected?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly onSelect?: (() => void) | undefined;
}
const colorOf = (item: AbyssTraitItem): string => item.card ? rarityIndex().colorOf(item.card.rarity) : ABYSS_GRADE_INFO[item.grade ?? 'purple'].color;

/** One transparent WebGL surface per gallery; every card is an extruded model. */
export function AbyssTraitCards({ items, contract = false }: {
  readonly items: readonly AbyssTraitItem[];
  readonly contract?: boolean;
}) {
  const anchors = useRef(new Map<string, HTMLSpanElement>());
  const [active, setActive] = useState<string | null>(null);
  const still = useSettingsStore(state => state.reduceMotion);
  useEffect(() => () => { for (const item of items) hideCardTip(`abyss-offer:${item.id}`); }, [items]);
  return <div className="abyss-trait-deck" data-contract={contract} data-cards={items.some(item => !!item.card)}>
    <div className="abyss-trait-deck__models" aria-hidden="true">
      <WebGLGuard fallback={<span className="abyss-trait-deck__fallback">立体特性预览不可用，仍可查看和选择以下特性</span>}>
        <Canvas activityFps={active === null ? 30 : 60} orthographic camera={{ position: [0, 0, 1000], near: 1, far: 2500, zoom: 1 }}
          dpr={[1, 1.5]} frameloop={still ? 'demand' : 'always'} gl={{ alpha: true, antialias: true }}
          style={{ pointerEvents: 'none' }}>
          <RenderActivity mode={still ? 'demand' : 'always'} fps={active === null ? 30 : 60} />
          <ambientLight intensity={1.6} />
          <directionalLight position={[250, 400, 600]} intensity={3} color="#fff0d0" />
          <directionalLight position={[-300, -50, 450]} intensity={1.3} color="#aacdf5" />
          <Models items={items} anchors={anchors} active={active} still={still} />
        </Canvas>
      </WebGLGuard>
    </div>
    <div className="abyss-trait-deck__grid">{items.map(item => {
      const content = <>
        <span className="abyss-trait-card__anchor" ref={node => {
          if (node) anchors.current.set(item.id, node); else anchors.current.delete(item.id);
        }}><span className="abyss-trait-card__symbol" aria-hidden="true">{item.tone === 'negative' ? '−' : '✦'}</span></span>
        <span className="abyss-trait-card__grade">{item.card ? `${item.card.rarity} · ATK ${item.card.atk} · HP ${item.card.hp} · CD ${item.card.cd}` : `${ABYSS_GRADE_INFO[item.grade ?? 'purple'].name}${item.level ? ` · ${item.level}级` : ''}`}</span>
        <strong>{item.name}</strong><span className="abyss-trait-card__description">{item.description}</span>
        <small>{item.footer ?? '已知特性'}{item.known === undefined ? '' : item.known ? ' · 已发现' : item.tone === 'growth' ? ' · 未获得' : ' · 未遇见'}</small>
      </>;
      const props = {
        className: 'abyss-trait-card',
        'data-known': item.known !== false,
        'data-selected': item.selected === true,
        'data-grade': item.grade ?? 'purple',
        style: { '--trait-color': colorOf(item) } as CSSProperties,
        onPointerEnter: (event: { currentTarget: HTMLElement }) => {
          setActive(item.id);
          showCardTip(item.card?.cardId ?? item.id, event.currentTarget.getBoundingClientRect(),
            { ...abyssTraitTip(item), source: 'dom', ownerKey: `abyss-offer:${item.id}`, ownerElement: event.currentTarget });
        },
        onPointerMove: (event: { clientX: number; clientY: number }) => { moveCardTip(event.clientX, event.clientY); },
        onPointerLeave: () => { setActive(null); hideCardTip(`abyss-offer:${item.id}`); },
        onFocus: () => setActive(item.id), onBlur: () => { setActive(null); hideCardTip(`abyss-offer:${item.id}`); },
      };
      return <div key={item.id} className="abyss-trait-card-wrap">{item.onSelect ? <button {...props} type="button" disabled={item.disabled}
        aria-pressed={item.selected} onClick={item.onSelect}>{content}</button>
        : <article {...props} tabIndex={0}>{content}</article>}
      </div>;
    })}</div>
  </div>;
}

function Models({ items, anchors, active, still }: {
  readonly items: readonly AbyssTraitItem[];
  readonly anchors: RefObject<Map<string, HTMLSpanElement>>;
  readonly active: string | null;
  readonly still: boolean;
}) {
  const { camera, size, gl, invalidate } = useThree();
  useEffect(() => { invalidate(); }, [active, items, still, invalidate]);
  useLayoutEffect(() => {
    const ortho = camera as OrthographicCamera;
    ortho.left = -size.width / 2; ortho.right = size.width / 2;
    ortho.top = size.height / 2; ortho.bottom = -size.height / 2;
    ortho.updateProjectionMatrix(); invalidate();
  }, [camera, size.width, size.height, invalidate]);
  useEffect(() => {
    const update = () => invalidate();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [invalidate]);
  return <>{items.map(item => <TraitModel key={item.id} item={item} anchors={anchors}
    canvas={gl.domElement} width={size.width} height={size.height} active={active === item.id} still={still} />)}</>;
}

const vertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragment = `uniform float time; uniform vec3 tint; varying vec2 vUv;
void main(){
  vec2 p=vUv-.5;
  float wave=sin(p.x*9.+p.y*6.-time*.7)*.5+.5;
  float sweep=pow(max(0.,1.-abs(fract(vUv.x*.4+vUv.y*.3-time*.08)-.5)*2.),18.);
  float frame=1.-smoothstep(.004,.018,min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y)));
  float fine=pow(max(0.,sin((p.x-p.y*.5)*55.+time*.45)),20.)*.018;
  vec3 col=mix(vec3(.025,.032,.057),tint*.17,wave*.42)+tint*(sweep*.17+fine);
  gl_FragColor=vec4(mix(col,tint*(.86+.14*sin(time*.6)),frame*.9),1.);
}`;

function labelTexture(item: AbyssTraitItem): CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 180;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = colorOf(item); ctx.font = 'bold 48px "SimSun", serif';
    ctx.fillText(item.name, 320, 60, 594);
    ctx.fillStyle = colorOf(item); ctx.font = '24px "SimSun", serif';
    ctx.fillText(`${ABYSS_GRADE_INFO[item.grade ?? 'purple'].name.split(' · ')[1]}${item.level ? ` · ${item.level}级` : ''}`, 320, 128);
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** The same physical effect-card body can be placed directly on a world table. */
export function AbyssTraitBody({ item }: { readonly item: AbyssTraitItem }) {
  const spin = useRef<Group>(null), face = useRef<ShaderMaterial>(null);
  const still = useSettingsStore(state => state.reduceMotion);
  const color = colorOf(item);
  const uniforms = useMemo(() => ({ time: { value: 0 }, tint: { value: new Color(color) } }), [color]);
  const label = useMemo(() => labelTexture(item), [item.name, item.tone, item.grade, item.level]);
  useEffect(() => () => label.dispose(), [label]);
  useFrame(({ clock }) => {
    const time = still ? 0 : clock.elapsedTime;
    if (spin.current) spin.current.rotation.z = time * .18;
    if (face.current) face.current.uniforms.time!.value = time;
  });
  return <group>
    <mesh geometry={getCardBodyGeometry()} scale={[1.018, 1.014, 3.2]} dispose={null}>
      <meshStandardMaterial color={color} roughness={.3} metalness={.76} />
    </mesh>
    <mesh geometry={getCardFaceGeometry()} position={[0, 0, CARD_FACE_OFFSET * 3.2]} dispose={null}>
      <shaderMaterial ref={face} uniforms={uniforms} vertexShader={vertex} fragmentShader={fragment} />
    </mesh>
    <group position={[0, .16, .065]}>
      <group ref={spin}>
        <mesh><torusGeometry args={[.27, .013, 6, 56]} /><meshStandardMaterial color="#ecd095" metalness={.6} roughness={.25} /></mesh>
        {[0, 1, 2, 3].map(i => <mesh key={i} position={[Math.cos(i * Math.PI / 2) * .27, Math.sin(i * Math.PI / 2) * .27, .018]}>
          <octahedronGeometry args={[.023]} /><meshBasicMaterial color={color} /></mesh>)}
      </group>
      <Emblem icon={item.icon} color={color} />
    </group>
    <mesh position={[0, -.44, .064]}><planeGeometry args={[.87, .26]} />
      <meshBasicMaterial map={label} transparent toneMapped={false} depthWrite={false} /></mesh>
    {[-1, 1].map(sign => <mesh key={sign} position={[sign * .42, .60, .055]} rotation={[0, 0, sign * -.45]}>
      <boxGeometry args={[.12, .009, .008]} /><meshBasicMaterial color="#ffe1a2" /></mesh>)}
  </group>;
}

function TraitModel({ item, anchors, canvas, width, height, active, still }: {
  readonly item: AbyssTraitItem; readonly anchors: RefObject<Map<string, HTMLSpanElement>>;
  readonly canvas: HTMLCanvasElement; readonly width: number; readonly height: number;
  readonly active: boolean; readonly still: boolean;
}) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }, delta) => {
    const group = ref.current, anchor = anchors.current.get(item.id);
    if (!group || !anchor) return;
    const screen = canvas.getBoundingClientRect(), rect = anchor.getBoundingClientRect();
    group.visible = screen.width > 0 && screen.height > 0 && rect.width > 0 && rect.height > 0
      && rect.bottom >= screen.top && rect.top <= screen.bottom && rect.right >= screen.left && rect.left <= screen.right;
    if (!group.visible) return;
    const sx = width / screen.width, sy = height / screen.height;
    const time = still ? 0 : clock.elapsedTime;
    const lift = still ? 0 : Math.sin(time * .7 + item.id.length) * 2;
    group.position.set((rect.left + rect.width / 2 - screen.left - screen.width / 2) * sx,
      (screen.top + screen.height / 2 - rect.top - rect.height / 2) * sy + lift, 0);
    group.scale.setScalar(Math.min(rect.width * sx * .83, rect.height * sy / 1.67) * (item.selected ? 1.04 : 1));
    const blend = still ? 1 : 1 - Math.exp(-Math.min(delta, .1) * 7);
    group.rotation.x += ((active ? -.13 : -.07) - group.rotation.x) * blend;
    group.rotation.y += ((active ? .22 : -.18) - group.rotation.y) * blend;
    group.rotation.z = still ? .015 : .015 + Math.sin(time * .38) * .018;
  });
  if (item.card) return <group ref={ref} rotation={[-.07, -.18, .015]}>
    <CardMesh card={item.card} position={[0, 0, 0]} rotationX={0} interactive={false} showStats={false}
      statLayout="hand" textureTier="battle" holo glow selected={item.selected === true} />
  </group>;
  return <group ref={ref} rotation={[-.07, -.18, .015]}>
    <AbyssTraitBody item={item} />
  </group>;
}

function Emblem({ icon, color }: { readonly icon: string; readonly color: string }) {
  const material = <meshStandardMaterial color={color} emissive={color} emissiveIntensity={.2} roughness={.24} metalness={.44} />;
  if (icon === 'crystal') return <group rotation={[.2, .3, .15]}>
    <mesh scale={[.75, 1.25, .75]}><octahedronGeometry args={[.19, 0]} />{material}</mesh>
    <mesh position={[-.16, -.12, .05]} scale={[.35, .6, .35]}><octahedronGeometry args={[.15, 0]} />{material}</mesh>
  </group>;
  if (['fireball', 'groupFireball', 'burning'].includes(icon)) return <group>
    <mesh position={[0, -.015, .015]} scale={[.8, 1, .7]}><sphereGeometry args={[.12, 18, 12]} />
      <meshStandardMaterial color="#ffba65" emissive="#ee6e39" emissiveIntensity={.7} roughness={.28} metalness={.15} /></mesh>
    {[-1, 0, 1].map(sign => <mesh key={sign} position={[sign * .08, .10 + Math.abs(sign) * .015, .018]} rotation={[0, 0, -sign * .3]}>
      <coneGeometry args={[.055, sign === 0 ? .23 : .15, 6]} /><meshStandardMaterial color="#f9d292" emissive="#db7738" emissiveIntensity={.5} /></mesh>)}
  </group>;
  if (icon === 'iceSeal') return <group>
    {[-2, -1, 0, 1, 2].map(index => <mesh key={index} position={[index * .06, .02 - Math.abs(index) * .03, .015]} rotation={[0, index * .15, -index * .2]}>
      <coneGeometry args={[.037, .28 - Math.abs(index) * .05, 4]} /><meshStandardMaterial color="#b2e6ef" emissive="#64baca" emissiveIntensity={.23} metalness={.28} roughness={.16} /></mesh>)}
  </group>;
  if (icon === 'lightning') return <group>
    {[{ x: .035, y: .095, r: -.6 }, { x: 0, y: 0, r: 1.05 }, { x: -.035, y: -.095, r: -.6 }].map((part, index) => <mesh key={index}
      position={[part.x, part.y, .02]} rotation={[0, 0, part.r]}>
      <boxGeometry args={[.033, .16, .025]} /><meshStandardMaterial color="#fff2bf" emissive="#e4c675" emissiveIntensity={.6} metalness={.3} /></mesh>)}
  </group>;
  if (icon === 'slash') return <mesh rotation={[0, .2, -.5]}><torusGeometry args={[.18, .018, 6, 36, Math.PI * 1.45]} />{material}</mesh>;
  if (icon === 'poisonCloud' || icon === 'venom') return <group>
    {Array.from({ length: 7 }, (_, index) => { const angle = index * 2.4; return <mesh key={index}
      position={[Math.sin(angle) * .10, Math.cos(angle) * .11, index % 2 * .028]}>
      <sphereGeometry args={[index === 0 ? .10 : .068, 14, 10]} /><meshStandardMaterial color="#91caa1" emissive="#43875d" emissiveIntensity={.28} roughness={.38} metalness={.15} />
    </mesh>; })}
  </group>;
  if (['defense', 'immunity', 'frailty', 'trait'].includes(icon)) return <mesh scale={[.85, 1.1, .6]} rotation={[0, .2, 0]}>
    <octahedronGeometry args={[.19]} />{material}</mesh>;
  if (['hp', 'vitality', 'selfHeal', 'vampire'].includes(icon)) return <group>
    {[-1, 1].map(sign => <mesh key={sign} position={[sign * .075, .025, 0]} scale={[1, 1.18, .6]}>
      <sphereGeometry args={[.105, 14, 10]} />{material}</mesh>)}
    <mesh position={[0, -.09, 0]} rotation={[0, 0, Math.PI]}><coneGeometry args={[.14, .18, 4]} />{material}</mesh>
  </group>;
  if (['haste', 'swiftness', 'delay', 'cd'].includes(icon)) return <group>
    <mesh><torusGeometry args={[.15, .025, 8, 32]} />{material}</mesh>
    <mesh position={[0, .05, .025]}><boxGeometry args={[.018, .13, .025]} />{material}</mesh>
    <mesh position={[.045, -.02, .035]} rotation={[0, 0, -.9]}><boxGeometry args={[.015, .10, .025]} />{material}</mesh>
  </group>;
  if (['atk', 'might', 'weakness', 'counter'].includes(icon)) return <group rotation={[0, 0, -.55]}>
    <mesh position={[0, .06, 0]}><boxGeometry args={[.045, .27, .04]} />{material}</mesh>
    <mesh position={[0, -.085, .012]}><boxGeometry args={[.17, .03, .06]} />{material}</mesh>
    <mesh position={[0, -.145, 0]}><boxGeometry args={[.025, .10, .035]} />{material}</mesh>
  </group>;
  return <group rotation={[.1, -.2, .2]}>
    <mesh scale={[.8, 1.2, .8]}><octahedronGeometry args={[.19]} />{material}</mesh>
    <mesh rotation={[1.15, .4, 0]}><torusGeometry args={[.19, .016, 6, 36]} />
      <meshStandardMaterial color="#f4d28d" metalness={.75} roughness={.3} /></mesh>
  </group>;
}
