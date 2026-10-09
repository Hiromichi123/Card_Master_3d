import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending, Color, DoubleSide, PerspectiveCamera, Vector3,
  type Group, type MeshBasicMaterial, type MeshPhysicalMaterial, type MeshStandardMaterial,
  type PointLight, type ShaderMaterial, type Texture,
} from 'three';

import { cardDatabase } from '../../data';
import { CARD_BACK_URL, cardFaceUrl, hasCardTexture } from '../../data/assets';
import type { CardDefinition, CardRarity } from '../../domain/cards/types';
import { assetManager, type TextureTier } from '../../services/AssetManager';
import { rarityIndex } from '../../state/useRarityIndex';
import {
  CARD_DIMENSIONS, CARD_FACE_OFFSET, getCardBodyGeometry, getCardFaceGeometry,
  getCardGlowGeometry,
} from '../cards/cardGeometry';
import { foilForRarity } from '../cards/foilModel';
import { createHoloUniforms, HOLO_FRAGMENT_SHADER, HOLO_VERTEX_SHADER } from '../cards/holoShader';
import { clamp01, LOGIN_TIMING, noise, smoothstep, type LoginMotion } from './motion';

const DISPLAY_RARITIES = new Set<CardRarity>(['A', 'A+', 'S', 'S+', 'SS', 'SS+', 'SSS']);

/** A varied visual-only draw: shuffle within rarity groups and interleave 32 distinct artworks. */
export function loginSampleCards(): readonly CardDefinition[] {
  const seed = Math.random() * 100_000;
  const groups = new Map<string, CardDefinition[]>();
  const candidates = cardDatabase.definitions
    .filter((card) => card.status === 'complete' && DISPLAY_RARITIES.has(card.rarity) && hasCardTexture(card.cardId))
    .map((card, index) => ({ card, order: noise(seed + index * 3.17) }))
    .sort((a, b) => a.order - b.order);
  for (const { card } of candidates) {
    const group = groups.get(card.rarity) ?? [];
    group.push(card);
    groups.set(card.rarity, group);
  }
  const buckets = [...groups.values()];
  const selected: CardDefinition[] = [];
  const artIds = new Set<string>();
  for (let round = 0; round < candidates.length && selected.length < 32; round++) {
    for (const group of buckets) {
      const card = group[round];
      if (!card || artIds.has(card.art.artId)) continue;
      artIds.add(card.art.artId);
      selected.push(card);
      if (selected.length === 32) break;
    }
  }
  return selected;
}

/** One reference per URL for the entire corridor, even though many cards reuse it. */
export function useLoginTextures(cards: readonly CardDefinition[], tier: TextureTier) {
  const urls = useMemo(() => [...new Set([
    CARD_BACK_URL, ...cards.flatMap((card) => [cardFaceUrl(card.cardId, tier), cardFaceUrl(card.cardId, 'thumbnail')]),
  ].filter((url): url is string => Boolean(url)))], [cards, tier]);
  const [textures, setTextures] = useState<ReadonlyMap<string, Texture>>(() => new Map());

  useEffect(() => {
    let live = true;
    setTextures(new Map());
    for (const url of urls) {
      void assetManager.acquire(url).then((texture) => {
        if (live) setTextures((previous) => new Map(previous).set(url, texture));
      });
    }
    return () => {
      live = false;
      for (const url of urls) assetManager.release(url);
    };
  }, [urls]);

  return { textures, ready: urls.every((url) => textures.has(url)) };
}

interface DisplayCardProps {
  readonly card: CardDefinition | undefined;
  readonly textures: ReadonlyMap<string, Texture>;
  readonly tier: TextureTier;
  readonly motion: LoginMotion;
  readonly fade?: Readonly<{ current: number }>;
  readonly holographic?: boolean;
}

/** Shared physical card geometry; login owns only the materials, never shared textures/geometries. */
function DisplayCard({ card, textures, tier, motion, fade, holographic = true }: DisplayCardProps) {
  const bodyRef = useRef<MeshPhysicalMaterial>(null);
  const faceRef = useRef<MeshPhysicalMaterial>(null);
  const backRef = useRef<MeshPhysicalMaterial>(null);
  const edgeRef = useRef<MeshBasicMaterial>(null);
  const foilRef = useRef<ShaderMaterial>(null);
  const frontUrl = card ? cardFaceUrl(card.cardId, tier) : null;
  const front = frontUrl ? textures.get(frontUrl) ?? null : null;
  const back = textures.get(CARD_BACK_URL) ?? null;
  const color = card ? rarityIndex().colorOf(card.rarity) : '#ecd18e';
  const foil = useMemo(() => card ? foilForRarity(card.rarity, color) : null, [card, color]);
  const uniforms = useMemo(() => {
    const result = createHoloUniforms();
    result.uTint.value.set(color);
    result.uStrength.value = (foil?.strength ?? .45) * .72;
    result.uRainbow.value = foil?.rainbow ? 1 : 0;
    return result;
  }, [color, foil]);
  const rim = useMemo(() => new Color(color).lerp(new Color('#f9e5b0'), .42), [color]);

  useEffect(() => {
    // Adding a map to an already compiled material needs a shader variant refresh.
    if (faceRef.current) faceRef.current.needsUpdate = true;
    if (backRef.current) backRef.current.needsUpdate = true;
  }, [front, back]);

  useFrame(() => {
    const opacity = (fade?.current ?? 1) * motion.current.brightness;
    for (const material of [bodyRef.current, faceRef.current, backRef.current]) {
      if (!material) continue;
      material.opacity = opacity;
      material.depthWrite = opacity > .98;
    }
    if (edgeRef.current) edgeRef.current.opacity = opacity * .62;
    const actualUniforms = foilRef.current?.uniforms;
    if (actualUniforms?.uTime) actualUniforms.uTime.value = motion.current.still ? 0 : motion.current.elapsed * .35;
    if (actualUniforms?.uStrength) actualUniforms.uStrength.value = (foil?.strength ?? .45) * opacity * .72;
  });

  return <group>
    <mesh castShadow>
      <primitive attach="geometry" object={getCardBodyGeometry()} />
      <meshPhysicalMaterial ref={bodyRef} transparent color={rim} metalness={.76} roughness={.25} clearcoat={.8} />
    </mesh>
    <mesh position={[0, 0, CARD_FACE_OFFSET]}>
      <primitive attach="geometry" object={getCardFaceGeometry()} />
      <meshPhysicalMaterial ref={faceRef} transparent map={front} color={front ? '#ffffff' : '#353041'}
        roughness={.26} metalness={.08} clearcoat={1} clearcoatRoughness={.12}
        envMapIntensity={.85} />
    </mesh>
    <mesh position={[0, 0, -CARD_FACE_OFFSET]} rotation={[0, Math.PI, 0]}>
      <primitive attach="geometry" object={getCardFaceGeometry()} />
      <meshPhysicalMaterial ref={backRef} transparent map={back} color={back ? '#ffffff' : '#222b3f'}
        roughness={.3} metalness={.13} clearcoat={1} clearcoatRoughness={.16}
        envMapIntensity={.8} />
    </mesh>
    <mesh position={[0, 0, CARD_FACE_OFFSET + .0007]}>
      <primitive attach="geometry" object={getCardGlowGeometry()} />
      <meshBasicMaterial ref={edgeRef} color={rim} vertexColors transparent blending={AdditiveBlending}
        depthWrite={false} opacity={.62} toneMapped={false} side={DoubleSide} />
    </mesh>
    {holographic && <mesh position={[0, 0, CARD_FACE_OFFSET + .002]}>
      <primitive attach="geometry" object={getCardFaceGeometry()} />
      <shaderMaterial ref={foilRef} uniforms={uniforms} vertexShader={HOLO_VERTEX_SHADER}
        fragmentShader={HOLO_FRAGMENT_SHADER} transparent blending={AdditiveBlending} depthWrite={false} />
    </mesh>}
  </group>;
}

interface CorridorProps {
  readonly cards: readonly CardDefinition[];
  readonly textures: ReadonlyMap<string, Texture>;
  readonly tier: TextureTier;
  readonly motion: LoginMotion;
  readonly count: number;
}

interface CorridorDrop {
  readonly sequence: number;
  readonly forward: number;
  readonly start: number;
  readonly height: number;
  readonly duration: number;
  readonly size: number;
  readonly x: number;
  readonly lean: number;
  readonly yaw: number;
  readonly tilt: number;
  cancelledAt: number | null;
}
type CorridorPool = MutableRefObject<(CorridorDrop | null)[]>;

function FallenCard({ index, pool, cards, ...props }: Omit<DisplayCardProps, 'card'> & {
  readonly index: number; readonly pool: CorridorPool; readonly cards: readonly CardDefinition[];
}) {
  const group = useRef<Group>(null);
  const impact = useRef<Group>(null);
  const impactMaterial = useRef<MeshBasicMaterial>(null);
  const fade = useRef(1);
  const sequence = useRef(-1);
  const [sampleIndex, setSampleIndex] = useState(index % Math.max(1, cards.length));

  useFrame(() => {
    const card = group.current;
    if (!card) return;
    const drop = pool.current[index];
    if (!drop) { card.visible = false; if (impact.current) impact.current.visible = false; return; }
    const state = props.motion.current;
    if (sequence.current !== drop.sequence) {
      sequence.current = drop.sequence;
      setSampleIndex(drop.sequence % Math.max(1, cards.length));
    }
    const z = state.travel - drop.forward;
    const worldZ = state.origin + z;
    const elapsed = (drop.cancelledAt ?? state.elapsed) - drop.start;
    const fall = clamp01(elapsed / drop.duration);
    const landed = elapsed >= drop.duration;
    const hit = landed ? clamp01((elapsed - drop.duration) / .7) : 0;
    const retiring = drop.cancelledAt === null ? 1 : 1 - smoothstep((state.elapsed - drop.cancelledAt) / .35);
    const baseY = drop.size * CARD_DIMENSIONS.height * .5 * Math.cos(drop.lean) - .85;
    card.visible = elapsed >= 0 && state.brightness > .001 && z > -100 && z < 30 && retiring > .001;
    card.position.set(drop.x, baseY + drop.height * (1 - fall * fall), worldZ);
    const settle = landed ? Math.sin(hit * 16) * Math.exp(-hit * 8) * .022 : (1 - fall) * .05;
    card.rotation.set(drop.tilt + settle, drop.yaw, drop.lean + Math.sign(drop.x) * settle);
    card.scale.setScalar(drop.size);
    fade.current = retiring;
    if (impact.current) {
      impact.current.visible = card.visible && landed && hit > 0 && hit < 1 && !state.still;
      impact.current.position.set(drop.x, .04, worldZ);
      impact.current.scale.setScalar(1 + hit * 7);
    }
    if (impactMaterial.current) impactMaterial.current.opacity = (1 - hit) * .3 * retiring;
  });

  return <>
    <group ref={group} visible={false}>
      <DisplayCard {...props} card={cards[sampleIndex]} fade={fade} />
    </group>
    <group ref={impact} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh><ringGeometry args={[.72, .79, 48]} />
        <meshBasicMaterial ref={impactMaterial} color="#ebc789" transparent opacity={.3}
          blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  </>;
}

/** One shared queue, never one trigger per empty slot: an empty board grows progressively. */
export function CardCorridor({ cards, textures, tier, motion, count }: CorridorProps) {
  const pool = useRef<(CorridorDrop | null)[]>(Array.from({ length: count }, () => null));
  const queue = useRef({ nextAt: null as number | null, frontier: -Infinity, sequence: 0 });
  useFrame(({ camera }) => {
    const state = motion.current;
    if (state.authenticated) {
      // Keep already planted scenery; retire unfinished drops as soon as credentials succeed.
      for (const drop of pool.current) {
        if (drop && drop.cancelledAt === null && state.elapsed - drop.start < drop.duration) {
          drop.cancelledAt = state.elapsed;
        }
      }
      return;
    }
    if (state.exit >= 0 || state.cruise < .65) return;
    const plan = queue.current;
    plan.nextAt ??= state.elapsed + .2;
    if (state.elapsed < plan.nextAt) return;
    const serial = plan.sequence;
    // Strictly monotonic ground distance prevents filling any gap behind an existing card.
    const forward = Math.max(state.travel + 40, plan.frontier + 13.5);
    if (forward - state.travel > 64) { plan.nextAt = state.elapsed + .2; return; }
    const vacant = pool.current.findIndex((drop) => !drop || state.travel - drop.forward > 30
      || (drop.cancelledAt !== null && state.elapsed - drop.cancelledAt > .5));
    if (vacant < 0) return;
    const side = serial % 2 ? 1 : -1;
    const size = 7.3 + noise(serial + 1) * 2.1;
    const lean = side * (.08 + noise(serial + 25) * .16);
    const baseY = size * CARD_DIMENSIONS.height * .5 * Math.cos(lean) - .85;
    const distance = camera.position.z - (state.origin + state.travel - forward);
    const halfFov = camera instanceof PerspectiveCamera ? camera.fov * Math.PI / 360 : .445;
    const height = Math.max(32, camera.position.y + distance * Math.tan(halfFov)
      + size * CARD_DIMENSIONS.height * .5 - baseY + 9);
    pool.current[vacant] = {
      sequence: serial, forward, start: state.elapsed, height,
      duration: Math.sqrt(2 * height / (state.still ? 6 : 8)) / LOGIN_TIMING.fallSpeed, size,
      x: side * (9.3 + noise(serial + 12) * 4.5),
      lean, yaw: -side * (.22 + noise(serial + 44) * .3),
      tilt: (noise(serial + 78) - .5) * .16, cancelledAt: null,
    };
    plan.frontier = forward;
    plan.sequence += 1;
    plan.nextAt = state.elapsed + 2.15 + noise(serial + 107) * .45;
  }, -1);
  return <>{Array.from({ length: count }, (_, index) => <FallenCard key={index}
    index={index} pool={pool} cards={cards} textures={textures} tier={tier} motion={motion} />)}</>;
}

interface DistantCardProps {
  readonly index: number;
  readonly count: number;
  readonly cards: readonly CardDefinition[];
  readonly textures: ReadonlyMap<string, Texture>;
  readonly motion: LoginMotion;
}

/** Thumbnail-only scenery: planted from the outset, revealed by distance fog instead of dropping. */
function DistantCard({ index, count, cards, textures, motion }: DistantCardProps) {
  const group = useRef<Group>(null);
  const body = useRef<MeshStandardMaterial>(null);
  const front = useRef<MeshStandardMaterial>(null);
  const back = useRef<MeshStandardMaterial>(null);
  const cycle = useRef(-Infinity);
  const [sample, setSample] = useState((index * 5 + 7) % Math.max(1, cards.length));
  const card = cards[sample];
  const url = card ? cardFaceUrl(card.cardId, 'thumbnail') : null;
  const faceTexture = url ? textures.get(url) ?? null : null;
  const side = index % 2 ? 1 : -1;
  const size = 8.5 + noise(index + 221) * 5.5;
  const lean = side * (.07 + noise(index + 87) * .13);
  const x = side * (43 + noise(index + 456) * 73);
  const baseY = size * CARD_DIMENSIONS.height * .5 * Math.cos(lean) - .55;
  const trackLength = count * 11.2;
  useEffect(() => {
    if (front.current) front.current.needsUpdate = true;
  }, [faceTexture]);
  useFrame(() => {
    if (!group.current) return;
    const state = motion.current;
    const track = index * 11.2 + state.travel + noise(index + 715) * 5;
    const lap = Math.floor(track / trackLength);
    const z = (track % trackLength) - trackLength + 16;
    if (cycle.current !== lap) {
      cycle.current = lap;
      setSample((index * 5 + lap * 11 + 7) % Math.max(1, cards.length));
    }
    const opacity = smoothstep((z + 180) / 62) * (1 - smoothstep((z + 56) / 30)) * state.brightness;
    group.current.visible = opacity > .002;
    group.current.position.set(x, baseY, state.origin + z);
    group.current.rotation.set((noise(index + 910) - .5) * .08, -side * (.15 + noise(index + 14) * .25), lean);
    group.current.scale.setScalar(size);
    for (const material of [body.current, front.current, back.current]) {
      if (material) material.opacity = opacity;
    }
  });
  return <group ref={group} visible={false}>
    <mesh><primitive attach="geometry" object={getCardBodyGeometry()} />
      <meshStandardMaterial ref={body} color="#55514a" transparent depthWrite={false} roughness={.95} envMapIntensity={.08} />
    </mesh>
    <mesh position={[0, 0, CARD_FACE_OFFSET]}>
      <primitive attach="geometry" object={getCardFaceGeometry()} />
      <meshStandardMaterial ref={front} map={faceTexture} color={faceTexture ? '#d0c9bd' : '#343536'}
        transparent depthWrite={false} roughness={1} metalness={0} envMapIntensity={.08} />
    </mesh>
    <mesh position={[0, 0, -CARD_FACE_OFFSET]} rotation={[0, Math.PI, 0]}>
      <primitive attach="geometry" object={getCardFaceGeometry()} />
      <meshStandardMaterial ref={back} color="#aaa69f" transparent depthWrite={false}
        roughness={1} metalness={0} envMapIntensity={.08} />
    </mesh>
  </group>;
}

export function DistantCardBelt({ cards, textures, motion, count }: Omit<CorridorProps, 'tier'>) {
  return <>{Array.from({ length: count }, (_, index) => <DistantCard key={index}
    index={index} count={count} cards={cards} textures={textures} motion={motion} />)}</>;
}

export interface LoginPortalProps {
  readonly textures: ReadonlyMap<string, Texture>;
  readonly motion: LoginMotion;
  readonly onReveal: (polygon: string, progress: number) => void;
  readonly onComplete: () => void;
}

/** Only a card back and metallic edge. The front is the live lobby aperture, never sample art. */
function PortalCard({ textures }: { readonly textures: ReadonlyMap<string, Texture> }) {
  const back = textures.get(CARD_BACK_URL) ?? null;
  const backMaterial = useRef<MeshPhysicalMaterial>(null);
  useEffect(() => { if (backMaterial.current) backMaterial.current.needsUpdate = true; }, [back]);
  return <group>
    <mesh castShadow>
      <primitive attach="geometry" object={getCardBodyGeometry()} />
      <meshPhysicalMaterial color="#c6aa6c" metalness={.85} roughness={.23} clearcoat={.8} />
    </mesh>
    <mesh position={[0, 0, -CARD_FACE_OFFSET]} rotation={[0, Math.PI, 0]}>
      <primitive attach="geometry" object={getCardFaceGeometry()} />
      <meshPhysicalMaterial ref={backMaterial} map={back} color={back ? '#ffffff' : '#1c2535'}
        roughness={.3} metalness={.12} clearcoat={1} clearcoatRoughness={.14} />
    </mesh>
    <mesh position={[0, 0, CARD_FACE_OFFSET + .0007]}>
      <primitive attach="geometry" object={getCardGlowGeometry()} />
      <meshBasicMaterial color="#e6c47e" vertexColors transparent opacity={.62}
        blending={AdditiveBlending} depthWrite={false} toneMapped={false} side={DoubleSide} />
    </mesh>
  </group>;
}

/** Ground pulse and real uplight fire exactly on the central back's ground contact. */
function PortalLandingLight({ motion, forward }: {
  readonly motion: LoginMotion; readonly forward: MutableRefObject<number | null>;
}) {
  const root = useRef<Group>(null);
  const glow = useRef<ShaderMaterial>(null);
  const light = useRef<PointLight>(null);
  const uniforms = useMemo(() => ({ uAge: { value: 0 }, uAmount: { value: 0 } }), []);
  useFrame(() => {
    const state = motion.current;
    const age = state.exit - LOGIN_TIMING.portalDelay - LOGIN_TIMING.portalDrop;
    const visible = forward.current !== null && age >= 0;
    if (root.current) {
      root.current.visible = visible;
      if (forward.current !== null) root.current.position.set(0, .025, state.origin + state.travel - forward.current);
    }
    const material = glow.current;
    if (material?.uniforms.uAge) material.uniforms.uAge.value = Math.max(0, age);
    if (material?.uniforms.uAmount) material.uniforms.uAmount.value = state.still ? .65 : 1;
    if (light.current) light.current.intensity = visible ? 25 + 140 * Math.exp(-age * 1.8) : 0;
  });
  return <group ref={root} visible={false}>
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[19, 19]} />
      <shaderMaterial ref={glow} uniforms={uniforms} transparent depthWrite={false}
        blending={AdditiveBlending} toneMapped={false}
        vertexShader={/* glsl */ `
          varying vec2 vUv;
          void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
        `}
        fragmentShader={/* glsl */ `
          varying vec2 vUv; uniform float uAge; uniform float uAmount;
          void main() {
            vec2 p=(vUv-.5)*2.0; float radius=length(p);
            float ring=exp(-pow((radius-min(.98,.08+uAge*.7))/.024,2.0))*exp(-uAge*1.1);
            float pad=exp(-radius*radius*8.0)*(.13+.04*sin(uAge*2.0));
            float angle=atan(p.y,p.x);
            float rays=pow(max(0.,cos(angle*12.0)),14.0)*exp(-radius*radius*5.0)*exp(-uAge*2.0)*.35;
            float edge=exp(-pow((radius-.36)/.018,2.0))*.10;
            float opacity=(ring*.85+pad+rays+edge)*uAmount;
            gl_FragColor=vec4(1.0,.72,.27,clamp(opacity,0.,.85));
          }
        `} />
    </mesh>
    <pointLight ref={light} position={[0, .9, 1.2]} color="#ffd78b" intensity={0} distance={20} decay={2} />
  </group>;
}

/** Camera-space corners are the reveal mask; the real hub is composited by the parent DOM. */
export function LoginPortal({ onReveal, onComplete, ...props }: LoginPortalProps) {
  const group = useRef<Group>(null);
  const camera = useThree((state) => state.camera);
  const corners = useMemo(() => [new Vector3(), new Vector3(), new Vector3(), new Vector3()], []);
  const completed = useRef(false);
  const completeNextFrame = useRef(false);
  const forward = useRef<number | null>(null);
  const callbacks = useRef({ onReveal, onComplete });
  callbacks.current = { onReveal, onComplete };

  useFrame(() => {
    if (completeNextFrame.current && !completed.current) {
      completed.current = true;
      callbacks.current.onComplete();
      return;
    }
    const gate = group.current;
    if (!gate || completed.current) return;
    const state = props.motion.current;
    if (state.exit >= 0 && forward.current === null) forward.current = state.travel + LOGIN_TIMING.portalDistance;
    const elapsed = state.exit - LOGIN_TIMING.portalDelay;
    gate.visible = elapsed >= 0;
    if (elapsed < 0 || forward.current === null) return;
    const drop = clamp01(elapsed / LOGIN_TIMING.portalDrop);
    const flip = smoothstep((elapsed - LOGIN_TIMING.portalFlipStart) /
      (LOGIN_TIMING.portalFlipEnd - LOGIN_TIMING.portalFlipStart));
    const distance = forward.current - state.travel;
    const baseY = LOGIN_TIMING.portalScale * CARD_DIMENSIONS.height * .5 - .35;
    gate.position.set(0, baseY + (1 - drop * drop) * LOGIN_TIMING.portalDropHeight,
      state.origin - distance);
    gate.rotation.set(0, Math.PI * (1 - flip), (1 - drop) * -.06);
    gate.scale.setScalar(LOGIN_TIMING.portalScale);

    // The instant the front turns toward the viewer, expose the already-rendered lobby.
    // Projection widens naturally from a thin edge, without any intermediate card illustration.
    if (flip <= .5) return;
    gate.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    const localCorners = [[-.5, .75], [.5, .75], [.5, -.75], [-.5, -.75]] as const;
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    const coordinates = localCorners.map(([x, y], index) => {
      const corner = corners[index]!;
      corner.set(x, y, CARD_FACE_OFFSET).applyMatrix4(gate.matrixWorld).project(camera);
      const px = (corner.x + 1) * 50;
      const py = (1 - corner.y) * 50;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      return `${px.toFixed(3)}% ${py.toFixed(3)}%`;
    });
    const coversViewport = minX <= -.5 && maxX >= 100.5 && minY <= -.5 && maxY >= 100.5;
    if (coversViewport || distance <= .3) {
      callbacks.current.onReveal('polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)', 1);
      // Let a full-frame hub be presented before the parent removes this canvas.
      completeNextFrame.current = true;
    } else {
      callbacks.current.onReveal(`polygon(${coordinates.join(', ')})`, clamp01(1 - distance / LOGIN_TIMING.portalDistance));
    }
  });

  return <>
    <group ref={group} visible={false}><PortalCard textures={props.textures} /></group>
    <PortalLandingLight motion={props.motion} forward={forward} />
  </>;
}
