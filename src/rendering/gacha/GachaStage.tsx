import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { PCFShadowMap, Vector3 } from 'three';
import type { Group } from 'three';

import { CARD_BACK_URL, cardFaceUrl } from '../../data/assets';
import type { CardDefinition } from '../../domain/cards/types';
import { assetManager } from '../../services/AssetManager';
import { useRarityIndex } from '../../state/useRarityIndex';
import { SPEED_SCALE, useSettingsStore } from '../../state/settingsStore';
import { WebGLGuard } from '../../scenes/WebGLGuard';
import { effectDirector } from '../effects/effectDirector';
import { EffectSystem } from '../effects/EffectSystem';
import { PerfSampler } from '../PerfSampler';
import { PostEffects } from '../postprocessing/PostEffects';
import { QUALITY_PROFILES, type QualityProfile } from '../quality';
import { getTableTheme, type TableTheme } from '../table/themes';
import { GachaCameraDriver } from './GachaCameraDriver';
import { GachaCard } from './GachaCard';
import { GachaBackdrop } from './GachaBackdrop';
import { sceneBoardDistance, menuBoardCameraDistance } from './revealStyle';
import { GachaDriver } from './GachaDriver';
import { DECK_POINT, buildChoreography, MENU_CAMERA_DISTANCE } from './choreography';
import { GachaMenuCards } from './GachaMenuPreview';
import { showcaseRects } from './menuLayout';
import { GachaLandingBeams } from './GachaLandingBeams';
import { GachaDepartingCards } from './GachaDepartingCards';
import type { CardShot } from './choreography';

/**
 * 抽卡的 3D 舞台。
 *
 * 一段演出的全部组成：卡池背景板 + 若干张 `CardMesh` + 粒子 + 相机。
 * 「什么时候发生什么」全在 `choreography.ts` 里，这里只负责把 three 摆好。
 *
 * ## 两条硬约束
 *
 * 1. **`<PostEffects>` 必须是 Canvas 里最后一个**：`EffectComposer` 挂上之后，
 *    声明在它之后的兄弟组件收不到 `useFrame`，而且**不报错**——只是不动。
 *    所以驱动器与相机都在它前面。
 * 2. **卡面的纹理要先预热**。贴图是异步到的，翻面那一刻没到就是一块深色底板。
 *    挂载时先 `acquire` 全部卡面（含卡背），预热完成前驱动器不推进时间轴。
 *    这里刻意不走 Suspense：一张图没到就挂起整棵树，会让 10 张卡一起消失。
 */
/** 安全网时间上限。覆盖两倍基准时长和纹理预热的余量，又不至于让人干等。 */
const SAFETY_TIMEOUT_MS = 45_000;

export interface GachaStageProps {
  readonly cards: readonly CardDefinition[];
  /** 卡池背景图（`backgroundUrl(pool.bgType)`）。没有就只留底色。 */
  readonly backdropUrl: string | null;
  /** 整段演完（含跳过）。 */
  readonly onFinished: () => void;
  readonly completed: boolean;
  readonly onPreview: (card: CardDefinition) => void;
  readonly skipAnimation: boolean;
  readonly runKey: string | null;
  readonly mode: 'select' | 'reveal' | 'result';
  readonly showcaseCards: readonly CardDefinition[];
  readonly showcaseHovered: number | null;
  readonly showcasePointer: readonly [number, number];
  readonly menuVisible: boolean;
  readonly outgoingCards: readonly CardDefinition[];
  readonly onStarted: () => void;
  readonly onMenuHidden: () => void;
}

export function GachaStage(props: GachaStageProps) {
  const { runKey, mode, onFinished, skipAnimation } = props;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const finishedKey = useRef<string | null>(null);
  const [forcedKey, setForcedKey] = useState<string | null>(null);
  const finish = useCallback(() => {
    if (runKey && finishedKey.current !== runKey) { finishedKey.current = runKey; onFinishedRef.current(); }
  }, [runKey]);
  useEffect(() => {
    if (mode !== 'reveal' || !runKey) return;
    const timer = window.setTimeout(() => { setForcedKey(runKey); finish(); }, SAFETY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [mode, runKey, finish]);
  const qualityId = useSettingsStore((state) => state.quality);
  const themeId = useSettingsStore((state) => state.tableThemeId);
  const cameraShake = useSettingsStore((state) => state.cameraShake);
  const reduceMotion = useSettingsStore((state) => state.reduceMotion);
  const profile = QUALITY_PROFILES[qualityId];
  const theme = getTableTheme(themeId);
  const cameraOptions = useMemo(() => ({ position: [0, 0, MENU_CAMERA_DISTANCE] as [number, number, number],
    fov: 42, near: 0.1, far: 80 }), []);

  return (
    <WebGLGuard>
      <div className="gacha__stage">
        <Canvas
          /* 关掉渲染器自带的色调映射：挂了后处理链之后会变成两套影调（见 EffectLabScene） */
          flat
          shadows={profile.shadows ? { type: PCFShadowMap } : false}
          dpr={[1, profile.dprCap]}
          camera={cameraOptions}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
        >
          <StageContent {...props} profile={profile} theme={theme} shake={cameraShake && !reduceMotion}
            onFinished={finish} instant={skipAnimation || (runKey !== null && forcedKey === runKey)} />
        </Canvas>
      </div>
    </WebGLGuard>
  );
}

interface StageContentProps extends GachaStageProps {
  readonly profile: QualityProfile;
  readonly theme: TableTheme;
  readonly shake: boolean;
  readonly instant: boolean;
}

function StageContent({ cards, backdropUrl, profile, theme, shake, onFinished, onPreview, completed, instant, runKey, mode,
  showcaseCards, showcaseHovered, showcasePointer, menuVisible, outgoingCards, onStarted, onMenuHidden }: StageContentProps) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const aspect = size.height > 0 ? size.width / size.height : 16 / 9;
  const menuDistance = menuBoardCameraDistance(aspect);
  const entryPose = useMemo(() => {
    if (!runKey) return { position: [0, 0, menuDistance] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    const direction = camera.getWorldDirection(new Vector3());
    const at = Math.abs(direction.z) > 0.001 ? -camera.position.z / direction.z : 0;
    return { position: camera.position.toArray() as [number, number, number], target: [camera.position.x + direction.x * at,
      camera.position.y + direction.y * at, 0] as [number, number, number] };
  }, [runKey, camera, menuDistance]);
  const rarityIndex = useRarityIndex();

  const cardRefs = useRef<(Group | null)[]>([]);
  /** 每张卡的翻面进度对象，一次性建好——驱动器每帧只改 `.current`。 */
  const flipControls = useMemo(
    () => cards.map(() => ({ current: 1 })),
    [cards],
  );

  const choreo = useMemo(
    () =>
      buildChoreography({
        cards: cards.map((card) => ({ cardId: card.cardId, rarity: card.rarity })),
        rankOf: rarityIndex.rankOf,
        isHighRarity: rarityIndex.isHighRarity,
        aspect,
        initialCamera: entryPose,
      }),
    [cards, aspect, rarityIndex, entryPose],
  );

  /*
    演出的当前时刻由 StageContent 持有：驱动器**写**它、相机**读**它。
    两边各持一个 ref 的话，相机会永远读到 0（第一帧就落位、之后一动不动）。
  */
  const elapsedRef = useRef(0);
  const elapsed = useMemo(() => () => elapsedRef.current, []);
  const elapsedBox = elapsedRef;
  useLayoutEffect(() => { elapsedRef.current = 0; effectDirector.skipAll(); }, [runKey]);
  const showcaseLayout = useMemo(() => showcaseRects(showcaseCards.length), [showcaseCards.length]);
  const boardDistance = sceneBoardDistance(aspect);

  /*
    预热：把这一批卡面（与卡背）先 acquire 进 `AssetManager` 的缓存。
    成对 release 在 cleanup 里——资产是引用计数的，漏放会一直占着显存。
    `allSettled`：某张图挂了不该让整段演出停摆，那张卡会显示占位纹理。
  */
  const [readyCards, setReadyCards] = useState<readonly CardDefinition[] | null>(null);
  const ready = readyCards === cards;
  const cardTier = profile.cardTier;
  useEffect(() => {
    const urls = [
      CARD_BACK_URL,
      ...(backdropUrl ? [backdropUrl] : []),
      ...cards
        .map((card) => cardFaceUrl(card.cardId, cardTier))
        .filter((url): url is string => url !== null),
    ];
    let alive = true;
    setReadyCards(null);
    void Promise.allSettled(urls.map((url) => assetManager.acquire(url))).then(() => {
      if (alive) {
        setReadyCards(cards);
      }
    });
    return () => {
      alive = false;
      for (const url of urls) {
        assetManager.release(url);
      }
    };
  }, [cards, cardTier, backdropUrl]);

  /*
    爆点：粒子模板复用既有的（`flow` 的注释语义就是「抽卡/转移」，
    高稀有再叠一层 `buff`），颜色取该张卡的稀有度色——与卡框、图鉴小圆点同源。
    不新增特效模板。
  */
  const handleBurst = useMemo(
    () => (_index: number, shot: CardShot) => {
      const color = rarityIndex.colorOf(shot.rarity);
      effectDirector.play({
        template: 'flow',
        from: DECK_POINT,
        to: [shot.slot[0], shot.slot[1], 0],
        color,
        intensity: shot.high ? 1.3 : 0.8,
        durationScale: SPEED_SCALE[useSettingsStore.getState().presentationSpeed],
      });
      if (shot.high) {
        effectDirector.play({
          template: 'buff',
          from: [shot.slot[0], shot.slot[1] - 0.3, 0.2],
          to: [shot.slot[0], shot.slot[1] - 0.3, 0.2],
          color,
          intensity: 1.2,
          durationScale: SPEED_SCALE[useSettingsStore.getState().presentationSpeed],
        });
      }
    },
    [rarityIndex],
  );

  return (
    <>
      <ambientLight intensity={0.85} />
      <hemisphereLight args={['#fff5dc', '#604424', 0.85]} />
      <directionalLight position={[2.5, 5, 5]} intensity={1.35} castShadow={profile.shadows}
        shadow-mapSize={[profile.shadowMapSize, profile.shadowMapSize]}
        shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7}
        shadow-bias={-0.0005} />

      <GachaBackdrop url={backdropUrl} distance={boardDistance} aspect={aspect} menuActive={mode === 'select'} menuDistance={menuDistance} />

      {menuVisible && <GachaMenuCards cards={showcaseCards} rects={showcaseLayout} hovered={showcaseHovered}
        pointer={showcasePointer} aspect={aspect} menuDistance={menuDistance} elapsed={elapsedBox} departing={mode === 'reveal'} />}
      {mode === 'reveal' && outgoingCards.length > 0 && <GachaDepartingCards cards={outgoingCards} elapsed={elapsedBox} />}
      {mode !== 'select' && <GachaLandingBeams choreo={choreo} elapsed={elapsedBox} />}
      {cards.map((card, index) => (
        <GachaCard
          key={`${runKey}-${card.cardId}-${index}`}
          card={card}
          completed={completed}
          onPreview={onPreview}
          flipControl={flipControls[index] as { current: number }}
          register={(group) => {
            cardRefs.current[index] = group;
          }}
        />
      ))}

      <EffectSystem capacity={profile.particleCapacity} />

      {mode !== 'select' && <GachaDriver
        choreo={choreo}
        elapsed={elapsedBox}
        targets={cardRefs}
        flipControls={flipControls}
        onBurst={handleBurst}
        onFinished={onFinished}
        ready={ready}
        instant={instant}
        onStarted={onStarted}
        onMenuHidden={onMenuHidden}
      />}
      <GachaCameraDriver choreo={choreo} elapsed={elapsed} shake={mode !== 'select' && shake} mode={mode} instant={instant} menuDistance={menuDistance} />

      <color attach="background" args={['#fff8e8']} />

      {/* 这两行必须在最后（见文件头注释） */}
      <PerfSampler />
      <PostEffects profile={profile} theme={theme} />
    </>
  );
}
