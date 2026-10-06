import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { PCFShadowMap } from 'three';
import type { Group } from 'three';

import { CARD_BACK_URL, cardFaceUrl } from '../../data/assets';
import type { CardDefinition } from '../../domain/cards/types';
import { assetManager } from '../../services/AssetManager';
import { useManagedTexture } from '../../services/useManagedTexture';
import { sceneFogArgs } from '../table/themes';
import { useRarityIndex } from '../../state/useRarityIndex';
import { useSettingsStore } from '../../state/settingsStore';
import { WebGLGuard } from '../../scenes/WebGLGuard';
import { effectDirector } from '../effects/effectDirector';
import { EffectSystem } from '../effects/EffectSystem';
import { PerfSampler } from '../PerfSampler';
import { PostEffects } from '../postprocessing/PostEffects';
import { QUALITY_PROFILES, type QualityProfile } from '../quality';
import { getTableTheme, type TableTheme } from '../table/themes';
import { GachaCameraDriver } from './GachaCameraDriver';
import { GachaCard } from './GachaCard';
import { GachaDriver } from './GachaDriver';
import { DECK_POINT, backdropSize, buildChoreography } from './choreography';
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
/** 安全网时间上限。比最长的演出（十连带高亮 ~4s）宽裕，又不至于让人干等。 */
const SAFETY_TIMEOUT_MS = 8000;

export interface GachaStageProps {
  readonly cards: readonly CardDefinition[];
  /** 卡池背景图（`backgroundUrl(pool.bgType)`）。没有就只留底色。 */
  readonly backdropUrl: string | null;
  /** 整段演完（含跳过）。 */
  readonly onFinished: () => void;
}

export function GachaStage({ cards, backdropUrl, onFinished }: GachaStageProps) {
  /*
    安全网：无论因为什么原因演出没能自己结束（WebGL 起不来、上下文丢失、
    贴图卡住），到点也得把结果交出去——否则玩家抽完卡，结果面板永远不出现，
    而钱已经扣了。演出正常时这个定时器会被清掉，`onFinished` 也只生效一次。
  */
  useEffect(() => {
    const timer = window.setTimeout(onFinished, SAFETY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [onFinished]);

  const qualityId = useSettingsStore((state) => state.quality);
  const themeId = useSettingsStore((state) => state.tableThemeId);
  const cameraShake = useSettingsStore((state) => state.cameraShake);
  const reduceMotion = useSettingsStore((state) => state.reduceMotion);
  const profile = QUALITY_PROFILES[qualityId];
  const theme = getTableTheme(themeId);

  return (
    <WebGLGuard>
      <div className="gacha__stage">
        <Canvas
          /* 关掉渲染器自带的色调映射：挂了后处理链之后会变成两套影调（见 EffectLabScene） */
          flat
          shadows={profile.shadows ? { type: PCFShadowMap } : false}
          dpr={[1, profile.dprCap]}
          camera={{ position: [0, 0.2, 6], fov: 42, near: 0.1, far: 80 }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
        >
          <StageContent
            cards={cards}
            backdropUrl={backdropUrl}
            profile={profile}
            theme={theme}
            shake={cameraShake && !reduceMotion}
            onFinished={onFinished}
          />
        </Canvas>
      </div>
    </WebGLGuard>
  );
}

interface StageContentProps {
  readonly cards: readonly CardDefinition[];
  readonly backdropUrl: string | null;
  readonly profile: QualityProfile;
  readonly theme: TableTheme;
  readonly shake: boolean;
  readonly onFinished: () => void;
}

function StageContent({
  cards,
  backdropUrl,
  profile,
  theme,
  shake,
  onFinished,
}: StageContentProps) {
  const size = useThree((state) => state.size);
  const aspect = size.height > 0 ? size.width / size.height : 16 / 9;
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
      }),
    [cards, aspect, rarityIndex],
  );

  /*
    演出的当前时刻由 StageContent 持有：驱动器**写**它、相机**读**它。
    两边各持一个 ref 的话，相机会永远读到 0（第一帧就落位、之后一动不动）。
  */
  const elapsedRef = useRef(0);
  const elapsed = useMemo(() => () => elapsedRef.current, []);
  const elapsedBox = elapsedRef;

  /*
    预热：把这一批卡面（与卡背）先 acquire 进 `AssetManager` 的缓存。
    成对 release 在 cleanup 里——资产是引用计数的，漏放会一直占着显存。
    `allSettled`：某张图挂了不该让整段演出停摆，那张卡会显示占位纹理。
  */
  const [ready, setReady] = useState(false);
  const cardTier = profile.cardTier;
  useEffect(() => {
    const urls = [
      CARD_BACK_URL,
      ...cards
        .map((card) => cardFaceUrl(card.cardId, cardTier))
        .filter((url): url is string => url !== null),
    ];
    let alive = true;
    setReady(false);
    void Promise.allSettled(urls.map((url) => assetManager.acquire(url))).then(() => {
      if (alive) {
        setReady(true);
      }
    });
    return () => {
      alive = false;
      for (const url of urls) {
        assetManager.release(url);
      }
    };
  }, [cards, cardTier]);

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
      });
      if (shot.high) {
        effectDirector.play({
          template: 'buff',
          from: [shot.slot[0], shot.slot[1] - 0.3, 0.2],
          to: [shot.slot[0], shot.slot[1] - 0.3, 0.2],
          color,
          intensity: 1.2,
        });
      }
    },
    [rarityIndex],
  );

  return (
    <>
      <ambientLight intensity={0.85} />
      <hemisphereLight args={['#9fb6e0', '#3b4252', 0.85]} />
      <directionalLight position={[2.5, 5, 5]} intensity={1.35} />

      <Backdrop url={backdropUrl} distance={choreo.cameraDistance} fovDeg={42} aspect={aspect} />

      {cards.map((card, index) => (
        <GachaCard
          key={`${card.cardId}-${index}`}
          card={card}
          flipControl={flipControls[index] as { current: number }}
          register={(group) => {
            cardRefs.current[index] = group;
          }}
        />
      ))}

      <EffectSystem capacity={profile.particleCapacity} />

      <GachaDriver
        choreo={choreo}
        elapsed={elapsedBox}
        targets={cardRefs}
        flipControls={flipControls}
        onBurst={handleBurst}
        onFinished={onFinished}
        ready={ready}
      />
      <GachaCameraDriver choreo={choreo} elapsed={elapsed} shake={shake} />

      <color attach="background" args={[theme.background]} />
      <fog attach="fog" args={sceneFogArgs(theme.fog)} />

      {/* 这两行必须在最后（见文件头注释） */}
      <PerfSampler />
      <PostEffects profile={profile} theme={theme} />
    </>
  );
}

/**
 * 背景板。
 *
 * 三处参数都不是随手写的：
 *
 * 1. **尺寸按「板子到相机」的距离算**，不是按板子到原点的距离。
 *    板子在原点后方 `depth`，相机在前方 `distance`，两者相差 `distance + depth`。
 *    用错距离的话板子会小一大圈（第一版就是），屏幕两侧露出底色。
 * 2. **`fog: false`**：`meshBasicMaterial` 默认受雾影响，而板子离相机最远、
 *    被雾吃到只剩雾色——看起来像「背景图没加载出来」。`CardGlow` 同样是这么关的。
 * 3. **`toneMapped: false`** + 一层淡淡的 `color` 压暗：池背景是插画，
 *    不该被场景的色调映射再压一道；但也不该比卡片还亮，所以乘一个灰度压下去。
 */
function Backdrop({
  url,
  distance,
  fovDeg,
  aspect,
}: {
  readonly url: string | null;
  readonly distance: number;
  readonly fovDeg: number;
  readonly aspect: number;
}) {
  const texture = useManagedTexture(url);
  const depth = distance * 0.95;
  // 相机在 +distance，板子在 -depth：两者相差 distance + depth
  const [width, height] = backdropSize(distance + depth, fovDeg, aspect);
  const scale = 1.12;

  return (
    <mesh position={[0, 0, -depth]}>
      <planeGeometry args={[width * scale, height * scale]} />
      {texture ? (
        <meshBasicMaterial map={texture} toneMapped={false} fog={false} color="#c8ccd4" />
      ) : (
        // 没有背景图（或还没加载出来）：给一块深色，至少不是黑洞
        <meshBasicMaterial color="#0b0e15" toneMapped={false} fog={false} />
      )}
    </mesh>
  );
}
