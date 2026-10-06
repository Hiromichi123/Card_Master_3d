import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, Float32BufferAttribute, AdditiveBlending, type Group, type Mesh, type MeshBasicMaterial, type Points, type OrthographicCamera } from 'three';
import type { CardDefinition } from '../../domain/cards/types';
import { WebGLGuard } from '../../scenes/WebGLGuard';
import { CARD_BACK_URL, cardFaceUrl } from '../../data/assets';
import { assetManager } from '../../services/AssetManager';
import { CardMesh } from '../cards/CardMesh';
import { SPEED_SCALE, useSettingsStore } from '../../state/settingsStore';
import { damp } from '../anim/motion';
import { FUSION_SECONDS, FUSION_RADIUS, fusionSlotPosition, fusionMaterialPose, fusionResultPose } from './motion';

export interface FusionAltarRun {
  readonly operationId: string;
  readonly materials: readonly CardDefinition[];
  readonly result: CardDefinition;
  readonly color: string;
}
export interface FusionAltarProps {
  readonly cards: readonly (CardDefinition | null)[];
  readonly run: FusionAltarRun | null;
  readonly completed: boolean;
  readonly onRemove: (index: number) => void;
  readonly onPreview: (card: CardDefinition) => void;
  readonly onFinished: () => void;
}

export function FusionAltarStage(props: FusionAltarProps) {
  const quality = useSettingsStore((state) => state.quality);
  const camera = useMemo(() => ({ position: [0, 0, 10] as [number, number, number], zoom: 60, near: 0.1, far: 40 }), []);
  const finish = useRef(props.onFinished); finish.current = props.onFinished;
  useEffect(() => {
    if (!props.run || props.completed) return;
    const timer = window.setTimeout(() => finish.current(), 45_000);
    return () => window.clearTimeout(timer);
  }, [props.run?.operationId, props.completed]);
  return <WebGLGuard><Canvas orthographic flat camera={camera}
    dpr={[1, quality === 'high' ? 2 : 1.5]} gl={{ alpha: true, antialias: true }}>
    <AltarContent {...props} />
  </Canvas></WebGLGuard>;
}

function AltarContent({ cards, run, completed, onRemove, onPreview, onFinished }: FusionAltarProps) {
  const size = useThree((state) => state.size);
  const camera = useThree((state) => state.camera) as OrthographicCamera;
  const elapsed = useRef(0);
  const notified = useRef(false);
  const result = useRef<Group>(null);
  const materialGroups = useRef<(Group | null)[]>([]);
  const ring = useRef<Mesh>(null);
  const sparkles = useRef<Points>(null);
  const speed = useSettingsStore((state) => state.presentationSpeed);
  const still = useSettingsStore((state) => state.reduceMotion);
  const finish = useRef(onFinished); finish.current = onFinished;
  const [readyOperation, setReadyOperation] = useState<string | null>(null);
  useEffect(() => {
    if (!run) { setReadyOperation(null); return; }
    let cancelled = false;
    const urls = [...new Set([CARD_BACK_URL, ...[...run.materials, run.result].map((card) => cardFaceUrl(card.cardId, 'detail'))]
      .filter((url): url is string => Boolean(url)))];
    void Promise.allSettled(urls.map((url) => assetManager.acquire(url))).then(() => {
      if (!cancelled) setReadyOperation(run.operationId);
    });
    return () => { cancelled = true; for (const url of urls) assetManager.release(url); };
  }, [run]);
  useLayoutEffect(() => {
    camera.zoom = Math.min(size.width / 6.7, size.height / 7.2);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  useLayoutEffect(() => { elapsed.current = 0; notified.current = false; }, [run?.operationId]);
  const paths = useMemo(() => {
    const points = Array.from({ length: 5 }, (_, i) => fusionSlotPosition(i));
    const shape = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points.flatMap((p) => [p[0], p[1], -0.08]), 3));
    const star = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 2, 2, 4, 4, 1, 1, 3, 3, 0].flatMap((i) => [points[i]![0], points[i]![1], -0.08]), 3));
    const particles = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(Array.from({ length: 54 }, (_, i) => {
      const a = i * 2.399963; const r = 0.2 + (i % 9) * 0.11;
      return [Math.cos(a) * r, Math.sin(a) * r, 0.15 + (i % 7) * 0.025];
    }).flat(), 3));
    return { shape, star, particles };
  }, []);
  useEffect(() => () => { paths.shape.dispose(); paths.star.dispose(); paths.particles.dispose(); }, [paths]);
  useFrame((_, delta) => {
    if (!run) {
      if (ring.current) ring.current.scale.setScalar(1);
      if (sparkles.current) sparkles.current.visible = false;
      return;
    }
    if (readyOperation !== run.operationId && !completed) return;
    elapsed.current = completed || still || speed === 'skip' ? FUSION_SECONDS : Math.min(FUSION_SECONDS, elapsed.current + delta / SPEED_SCALE[speed]);
    const time = elapsed.current;
    for (let i = 0; i < 5; i++) {
      const group = materialGroups.current[i]; if (!group) continue;
      const pose = fusionMaterialPose(i, time);
      group.visible = pose.visible;
      group.position.set(...pose.position); group.scale.setScalar(pose.scale);
      group.rotation.z = time * 0.7;
    }
    if (result.current) {
      const pose = fusionResultPose(time);
      result.current.visible = pose.visible;
      result.current.scale.setScalar(pose.scale);
      result.current.rotation.y = pose.rotationY;
    }
    const burst = Math.max(0, 1 - Math.abs(time - 1.05) / 0.65);
    if (ring.current) {
      ring.current.scale.setScalar(1 + burst * 3.5);
      (ring.current.material as MeshBasicMaterial).opacity = 0.25 + burst * 0.65;
    }
    if (sparkles.current) {
      sparkles.current.visible = burst > 0;
      sparkles.current.scale.setScalar(0.2 + (time / 1.4) * 2.1);
      sparkles.current.rotation.z = time * 0.9;
    }
    if (time >= FUSION_SECONDS && !notified.current) { notified.current = true; finish.current(); }
  });
  const shown = run ? run.materials : cards;
  return <>
    <ambientLight intensity={1.3} /><directionalLight position={[2, 3, 7]} intensity={1.5} />
    <mesh position={[0, 0, -0.2]}><circleGeometry args={[FUSION_RADIUS + 0.75, 80]} /><meshBasicMaterial color="#101c31" transparent opacity={0.58} /></mesh>
    <lineLoop geometry={paths.shape}><lineBasicMaterial color="#d9b568" transparent opacity={0.6} /></lineLoop>
    <lineSegments geometry={paths.star}><lineBasicMaterial color="#efce89" transparent opacity={0.55} /></lineSegments>
    <mesh ref={ring} position={[0, 0, -0.05]}><ringGeometry args={[0.46, 0.5, 64]} />
      <meshBasicMaterial color={run?.color ?? '#e9d296'} transparent opacity={0.25} blending={AdditiveBlending} depthWrite={false} /></mesh>
    {!run && cards.map((card, i) => card ? <SelectedCard key={`${i}-${card.cardId}`} card={card} index={i} onRemove={onRemove} /> :
      <mesh key={`empty-${i}`} position={fusionSlotPosition(i)}><boxGeometry args={[0.82, 1.22, 0.035]} />
        <meshStandardMaterial color="#24364c" roughness={0.55} metalness={0.2} /></mesh>)}
    {run && shown.map((card, i) => card && <group key={`${run.operationId}-${i}`} ref={(group) => { materialGroups.current[i] = group; }} position={fusionSlotPosition(i)} scale={0.82}>
      <CardMesh card={card} position={[0, 0, 0]} rotationX={0} interactive={false} glow showStats={false} textureTier="detail" />
    </group>)}
    {run && <group ref={result} position={[0, 0, 0.48]} visible={completed}>
      <CardMesh card={run.result} position={[0, 0, 0]} rotationX={0} glow glowScale={1.5} textureTier="detail"
        showStats={false} interactive={completed} onClick={() => { if (completed) onPreview(run.result); }} />
    </group>}
    <points ref={sparkles} geometry={paths.particles} visible={false}><pointsMaterial color={run?.color ?? '#ffe6a4'} size={0.055}
      transparent opacity={0.8} blending={AdditiveBlending} depthWrite={false} /></points>
  </>;
}

function SelectedCard({ card, index, onRemove }: { readonly card: CardDefinition; readonly index: number; readonly onRemove: (index: number) => void }) {
  const group = useRef<Group>(null);
  const still = useSettingsStore((state) => state.reduceMotion);
  const speed = useSettingsStore((state) => state.presentationSpeed);
  const target = fusionSlotPosition(index);
  useFrame((_, delta) => {
    if (!group.current) return;
    for (let axis = 0; axis < 3; axis++) {
      const name = (['x', 'y', 'z'] as const)[axis]!;
      group.current.position[name] = still || speed === 'skip' ? target[axis]! : damp(group.current.position[name], target[axis]!, 12 / SPEED_SCALE[speed], delta);
    }
  });
  return <group ref={group} position={[-3.8, target[1], 0.2]} scale={0.82}>
    <CardMesh card={card} position={[0, 0, 0]} rotationX={0} glow textureTier="detail" showStats={false}
      onClick={() => onRemove(index)} />
  </group>;
}
