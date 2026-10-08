import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, Float32BufferAttribute, AdditiveBlending, type Group, type Mesh, type MeshBasicMaterial, type Points, Vector3, type PerspectiveCamera } from 'three';
import type { CardDefinition } from '../../domain/cards/types';
import { WebGLGuard } from '../../scenes/WebGLGuard';
import { CARD_BACK_URL, cardFaceUrl } from '../../data/assets';
import { assetManager } from '../../services/AssetManager';
import { audioEngine } from '../../services/audio/AudioEngine';
import { CardMesh } from '../cards/CardMesh';
import { SPEED_SCALE, useSettingsStore } from '../../state/settingsStore';
import { damp } from '../anim/motion';
import { FusionAltarModel, FusionMagicCircle, ALTAR_TOP, CARD_REST_Y, altarPoint } from './FusionAltarModel';
import { FUSION_SECONDS, fusionSlotPosition, fusionMaterialPose, fusionResultPose } from './motion';

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
  const profile = useSettingsStore((state) => state.profile);
  const camera = useMemo(() => ({ position: [5.5, 8, 10] as [number, number, number], fov: 44, near: 0.1, far: 100 }), []);
  const finish = useRef(props.onFinished); finish.current = props.onFinished;
  useEffect(() => {
    if (!props.run || props.completed) return;
    const timer = window.setTimeout(() => finish.current(), 45_000);
    return () => window.clearTimeout(timer);
  }, [props.run?.operationId, props.completed]);
  return <WebGLGuard><Canvas flat camera={camera} shadows={profile.shadows}
    dpr={[1, profile.dprCap]} gl={{ alpha: true, antialias: true }}>
    <AltarContent {...props} />
  </Canvas></WebGLGuard>;
}

function AltarContent({ cards, run, completed, onRemove, onPreview, onFinished }: FusionAltarProps) {
  const size = useThree((state) => state.size);
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const elapsed = useRef(0);
  const notified = useRef(false);
  /** 「一次融合一声」的守卫，见 useFrame 里 burst 峰值那一行。 */
  const burstCuePlayed = useRef(false);
  const result = useRef<Group>(null);
  const materialGroups = useRef<(Group | null)[]>([]);
  const ring = useRef<Mesh>(null);
  const sparkles = useRef<Points>(null);
  const speed = useSettingsStore((state) => state.presentationSpeed);
  const profile = useSettingsStore((state) => state.profile);
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
    if (size.width <= 0 || size.height <= 0) return;
    const target = new Vector3(0, .7, 0);
    const direction = new Vector3(.55, .9, 1).normalize();
    const aspect = size.width / Math.max(1, size.height);
    const halfFov = Math.tan(camera.fov * Math.PI / 360);
    const distance = Math.max(7.2 / (2 * halfFov * aspect), 6.4 / (2 * halfFov)) * 1.07;
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  useLayoutEffect(() => { elapsed.current = 0; notified.current = false; burstCuePlayed.current = false; }, [run?.operationId]);
  const paths = useMemo(() => {
    const points = Array.from({ length: 5 }, (_, i) => fusionSlotPosition(i));
    const shape = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points.flatMap((p) => [p[0], ALTAR_TOP + .038, -p[1]]), 3));
    const star = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 2, 2, 4, 4, 1, 1, 3, 3, 0].flatMap((i) => [points[i]![0], ALTAR_TOP + .04, -points[i]![1]]), 3));
    const particles = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(Array.from({ length: 54 }, (_, i) => {
      const a = i * 2.399963; const r = 0.2 + (i % 9) * 0.11;
      return [Math.cos(a) * r, (i % 7) * .055, Math.sin(a) * r];
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
    elapsed.current = completed || speed === 'skip' ? FUSION_SECONDS : Math.min(FUSION_SECONDS, elapsed.current + delta / SPEED_SCALE[speed]);
    const time = elapsed.current;
    for (let i = 0; i < 5; i++) {
      const group = materialGroups.current[i]; if (!group) continue;
      const pose = fusionMaterialPose(i, time);
      group.visible = pose.visible;
      group.position.set(...altarPoint(pose.position)); group.scale.setScalar(pose.scale);
      group.rotation.y = time * 0.7;
    }
    if (result.current) {
      const pose = fusionResultPose(time);
      result.current.visible = pose.visible;
      result.current.scale.setScalar(pose.scale);
      result.current.rotation.y = pose.rotationY;
    }
    const burst = Math.max(0, 1 - Math.abs(time - 1.05) / 0.65);
    // 一次融合只响一声：ref 守卫，与 60fps 的帧数无关（在 useLayoutEffect 里随 run 重置）
    if (time >= 1.05 && !burstCuePlayed.current) {
      burstCuePlayed.current = true;
      audioEngine.play('fusion');
    }
    if (ring.current) {
      ring.current.scale.setScalar(1 + burst * 3.5);
      (ring.current.material as MeshBasicMaterial).opacity = 0.25 + burst * 0.65;
    }
    if (sparkles.current) {
      sparkles.current.visible = burst > 0;
      sparkles.current.scale.setScalar(0.2 + (time / 1.4) * 2.1);
      sparkles.current.rotation.y = time * 0.9;
    }
    if (time >= FUSION_SECONDS && !notified.current) { notified.current = true; finish.current(); }
  });
  const shown = run ? run.materials : cards;
  return <>
    <hemisphereLight args={['#f3dec0', '#18283f', 1.35]} />
    <directionalLight position={[3, 7, 5]} intensity={2.4} castShadow={profile.shadows}
      shadow-mapSize-width={profile.shadowMapSize} shadow-mapSize-height={profile.shadowMapSize}
      shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={4} shadow-camera-bottom={-4} shadow-bias={-.0005} />
    <pointLight position={[-3, 2.5, -3]} color="#92bedc" intensity={6} distance={12} />
    <FusionAltarModel />
    <FusionMagicCircle elapsed={elapsed} active={Boolean(run && !completed)} color={run?.color ?? '#e5c88b'} />
    <lineLoop geometry={paths.shape}><lineBasicMaterial color="#d9b568" transparent opacity={0.6} /></lineLoop>
    <lineSegments geometry={paths.star}><lineBasicMaterial color="#efce89" transparent opacity={0.55} /></lineSegments>
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, ALTAR_TOP + .09, 0]}><ringGeometry args={[0.46, 0.5, 64]} />
      <meshBasicMaterial color={run?.color ?? '#e9d296'} transparent opacity={0.25} blending={AdditiveBlending} depthWrite={false} /></mesh>
    {!run && cards.map((card, i) => card ? <SelectedCard key={`${i}-${card.cardId}`} card={card} index={i} onRemove={onRemove} /> :
      <mesh key={`empty-${i}`} position={altarPoint(fusionSlotPosition(i))} rotation={[-Math.PI / 2, 0, 0]}>
        <boxGeometry args={[.72, 1.08, .018]} /><meshStandardMaterial color="#2e424e" roughness={.65} metalness={.18} transparent opacity={.5} />
      </mesh>)}
    {run && shown.map((card, i) => card && <group key={`${run.operationId}-${i}`} ref={(group) => { materialGroups.current[i] = group; }} position={altarPoint(fusionSlotPosition(i))} scale={0.82}>
      <CardMesh card={card} position={[0, 0, 0]} rotationX={-Math.PI / 2} interactive={false} hoverTip={false} glow showStats={false} textureTier="detail" />
    </group>)}
    {run && <group ref={result} position={[0, CARD_REST_Y + .85, 0]} visible={completed}>
      <CardMesh card={run.result} position={[0, 0, 0]} rotationX={-.82} glow glowScale={1.5} textureTier="detail"
        showStats={false} hoverTip={completed} interactive={completed} onClick={() => { if (completed) onPreview(run.result); }} />
    </group>}
    <points ref={sparkles} position={[0, CARD_REST_Y + .08, 0]} geometry={paths.particles} visible={false}><pointsMaterial color={run?.color ?? '#ffe6a4'} size={0.055}
      transparent opacity={0.8} blending={AdditiveBlending} depthWrite={false} /></points>
  </>;
}

function SelectedCard({ card, index, onRemove }: { readonly card: CardDefinition; readonly index: number; readonly onRemove: (index: number) => void }) {
  const group = useRef<Group>(null);
  const still = useSettingsStore((state) => state.reduceMotion);
  const speed = useSettingsStore((state) => state.presentationSpeed);
  const target = altarPoint(fusionSlotPosition(index));
  useFrame((_, delta) => {
    if (!group.current) return;
    for (let axis = 0; axis < 3; axis++) {
      const name = (['x', 'y', 'z'] as const)[axis]!;
      group.current.position[name] = still || speed === 'skip' ? target[axis]! : damp(group.current.position[name], target[axis]!, 12 / SPEED_SCALE[speed], delta);
    }
  });
  return <group ref={group} position={[-3.8, target[1] + .2, target[2]]} scale={0.82}>
    <CardMesh card={card} position={[0, 0, 0]} rotationX={-Math.PI / 2} glow textureTier="detail" showStats={false}
      onClick={() => onRemove(index)} />
  </group>;
}
