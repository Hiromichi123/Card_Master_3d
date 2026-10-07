import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { PCFShadowMap, type Group } from 'three';

import { cardById, cardDatabase, slice } from '../data';
import type { CardDefinition } from '../domain/cards/types';
import { FLYING_CARD_LIFT } from '../rendering/anim/combatMotion';
import { CardMesh } from '../rendering/cards/CardMesh';
import { holoIntensityForRarity } from '../rendering/cards/HoloLayer';
import { effectDirector } from '../rendering/effects/effectDirector';
import { particleStats } from '../rendering/effects/particleStats';
import { EffectSystem } from '../rendering/effects/EffectSystem';
import { FAMILY_TINT } from '../rendering/effects/familyMap';
import { FAMILY_TO_EFFECT, type EffectTemplateId } from '../rendering/effects/templates';
import { PerfSampler } from '../rendering/PerfSampler';
import { PostEffects } from '../rendering/postprocessing/PostEffects';
import { CAST_OFFSET, CAST_Y, IMPACT_Y } from '../rendering/presentation/constants';
import { sceneFogArgs } from '../rendering/table/themes';
import { SPEED_SCALE, useSettingsStore } from '../state/settingsStore';
import { PerfOverlay } from '../ui/PerfOverlay';
import { WebGLGuard } from './WebGLGuard';

/**
 * 实验台
 *
 * 存在的理由：卡牌质感与特效都是**视角与时间相关**的。战斗全景里卡牌只有
 * 几十像素、特效一闪而过，既看不出全息色带是否跟视角走，也看不出火球
 * 「有没有轨迹与命中」。把它们放到能慢慢看、能反复触发的地方，
 * `V-HOLO-*` / `V-FX-*` / `V-REF-*` 才可验证。
 *
 * ## 阵型：第二行一张施法卡，上排三张目标
 *
 * - **第二行（近相机）一张施法卡**，四个槽都可以在下拉框里任选，点 3D 里的卡
 *   也与施法卡**对调**（四个位置永远是四张不同的卡）；
 * - **上排三张目标**，中槽正好在施法卡正上方，就是规则里的**对位**；
 * - 面板触发的特效**从这张施法卡出发、落到上排**，打几张**完全由技能族决定**：
 *   对群族（`group*`）打满三张，对单只打正前方那张（对位）。实验台不提供
 *   「强制群体」这类覆盖开关——要试群攻，选一个群攻模板或群攻族即可，
 *   留着开关只会让画面上的目标数与真实规则对不上。
 *
 * 上排左侧默认一张**飞行**卡：飞行卡的抬升用的是战斗里同一个 `FLYING_CARD_LIFT`，
 * 所以在实验台上「地对空打不到飞行卡」是**看得见的**，而不是只在结算数字里。
 * 它放在**左**槽而不是对位，是为了让默认的单体技能打在台面上的普通卡上，
 * 想试地对空时再把它换到对位（或直接对着它放群攻）。
 *
 * **与战斗唯一一处有意不同**：打在飞行卡上的命中点抬到了卡面上
 * （`FLYING_CARD_LIFT + IMPACT_Y`）。战斗里 `impactPointOf` 一律贴地面坐标
 * （见 `docs/COMBAT_MOTION_UPDATE.md`：技能命中坐标继续用地面位置），
 * 照搬过来的话弹体会从悬浮的卡**下面**穿过去，看不出打的是哪一张。
 * 这条只动表现，不动任何规则判定。
 */

/**
 * 模板按钮表。
 *
 * `family` 是给「同一个模板、不同族色」用的：圣盾与护盾是同一段演出，
 * 靠族名去 `FAMILY_TINT` 取金色（见 `playTemplate` 的 color 参数）。
 */
const TEMPLATE_LABELS: { id: EffectTemplateId; label: string; family?: string }[] = [
  { id: 'normalAttack', label: '普通攻击' },
  { id: 'slash', label: '斩击', family: 'slash' },
  { id: 'groupSlash', label: '群体斩击', family: 'groupSlash' },
  { id: 'swordDance', label: '剑舞', family: 'swordDance' },
  { id: 'swordDance', label: '斩杀', family: 'execute' },
  { id: 'lifeDrain', label: '献祭', family: 'sacrifice' },
  { id: 'flow', label: '传送', family: 'teleport' },
  { id: 'groupSwordDance', label: '群体剑舞', family: 'groupSwordDance' },
  { id: 'fireball', label: '火球' },
  { id: 'iceSeal', label: '冰封' },
  { id: 'lightning', label: '闪电' },
  { id: 'groupFireball', label: '群体火球' },
  { id: 'groupIceSeal', label: '群体冰封' },
  { id: 'groupLightning', label: '群体闪电' },
  { id: 'shield', label: '护盾 / 防御' },
  { id: 'shield', label: '圣盾', family: 'holyShield' },
  { id: 'heal', label: '治愈 / 恢复' },
  { id: 'buff', label: '祝福 / 振奋' },
  { id: 'curse', label: '诅咒' },
  { id: 'instantDeath', label: '即死', family: 'instantDeath' },
  { id: 'armorBreak', label: '闪避赋予', family: 'grantDodge' },
  { id: 'shield', label: '法术反弹', family: 'spellReflect' },
  { id: 'normalAttack', label: '伤害n', family: 'directDamage' },
  { id: 'normalAttack', label: '群体伤害n', family: 'groupPhysicalDamage' },
  { id: 'injury', label: '受伤' },
  { id: 'debuff', label: '其它减益' },
  { id: 'flow', label: '抽卡 / 转移' },
  { id: 'bombard', label: '炮击' },
  { id: 'groupBombard', label: '群体爆破' },
  { id: 'deathBurst', label: '自毁' },
  { id: 'deathBombard', label: '死亡爆裂' },
  { id: 'ranged', label: '远射' },
  { id: 'piercing', label: '贯穿' },
  { id: 'groupPiercing', label: '群体贯穿', family: 'groupPiercing' },
  { id: 'slash', label: '临点坍缩', family: 'criticalCollapse' },
  { id: 'status', label: '不屈遮罩（开 / 关）', family: 'unyielding' },
  { id: 'groupHeal', label: '群体治愈' },
  { id: 'armorBreak', label: '破甲' },
  { id: 'dodge', label: '闪避残影' },
  { id: 'lifeDrain', label: '吸血流光' },
  { id: 'rebirth', label: '还魂 / 复活' },
  { id: 'clone', label: '分身 / 复制' },
  { id: 'cooldown', label: '加速 / 延迟' },
  { id: 'silence', label: '沉默封印' },
];

/** 预设主题色：颜色是给「看效果」用的，不需要任意取色器。 */
const COLOR_PRESETS: { label: string; value: string }[] = [
  { label: '原色', value: '' },
  { label: '金', value: '#ffb445' },
  { label: '冰', value: '#8fd4ff' },
  { label: '雷', value: '#cfe6ff' },
  { label: '护', value: '#7fb2ff' },
  { label: '愈', value: '#8bf5c0' },
  { label: '咒', value: '#b46bff' },
  { label: '血', value: '#ff5a6e' },
];

const FLYING_TRAIT = '飞行';

/** 上排三个目标槽的 x；中槽（下标 1）在施法卡正上方，即规则里的「对位」。 */
const TARGET_XS = [-1.35, 0, 1.35] as const;
const TARGET_SLOTS = [0, 1, 2] as const;
const TARGET_LABELS = ['左', '对位', '右'] as const;
/**
 * 主目标所在的槽。
 *
 * 单体模板（`EffectRequest.to`）打**对位**那张——也就是施法卡正上方那张。
 * 这不是随便挑的：战斗里 `targetsOf` 取到的第一个目标就是技能结算的第一个目标，
 * 而实验台里能站得住脚的那一个只能是「对位」。要让单体技能打旁边那张，
 * 把上排的卡换过去即可（换位比多一个「打谁」的下拉框更接近真实盘面）。
 */
const ALIGNED_SLOT = 1;
/** 上排离桌心的距离：负 = 远的（画面里靠上）那一侧。 */
const TARGET_Z = -1.05;
/** 第二行（施法卡）离桌心的距离：正 = 近相机的一侧。两排相距 2 个世界单位。 */
const SOURCE_Z = 0.95;
/** 施法卡的 x：与上排中槽同一列，特效的起点与主落点才在同一条线上。 */
const SOURCE_X = 0;

/**
 * 默认上排：左＝飞行、对位＝受击基准、右＝死亡基准。
 *
 * 这三张不是随便挑的——技能族里最需要「换对手」才能看出差别的就是这三类：
 * 飞行（地对空规则）、防御（受击减伤）、不死（死亡后回手牌）。
 * 飞行那张放在**左**槽：对位留给地面卡，单体技能的默认落点才是普通盘面。
 */
const DEFAULT_TARGET_IDS: readonly [string, string, string] = ['A+_006', 'SSS_001', 'C_026'];

/** 飞行卡在空中的浮动幅度与周期。抬升的基准值是战斗里的 `FLYING_CARD_LIFT`。 */
const FLY_BOB_AMPLITUDE = 0.07;
const FLY_BOB_PERIOD = 2.6;

type Vec3 = readonly [number, number, number];
type LayoutMode = 'formation' | 'single';
/** 槽位：`'source'` 是第二行那张，0/1/2 是上排的左/对位/右。 */
type SlotId = 'source' | 0 | 1 | 2;

interface LabSetup {
  readonly source: string;
  readonly targets: readonly [string, string, string];
}

function slotValue(setup: LabSetup, slot: SlotId): string {
  return slot === 'source' ? setup.source : setup.targets[slot];
}

function withSlot(setup: LabSetup, slot: SlotId, cardId: string): LabSetup {
  if (slot === 'source') {
    return { ...setup, source: cardId };
  }
  const targets: [string, string, string] = [setup.targets[0], setup.targets[1], setup.targets[2]];
  targets[slot] = cardId;
  return { ...setup, targets };
}

function findSlot(setup: LabSetup, cardId: string): SlotId | null {
  const slots: readonly SlotId[] = ['source', 0, 1, 2];
  return slots.find((slot) => slotValue(setup, slot) === cardId) ?? null;
}

/**
 * 把某张卡放进某个槽。它原本占着别的槽时**两槽对调**，
 * 于是「施法卡与三张目标」永远是四张不同的卡——这正是「三张**其它**卡牌」的字面要求。
 */
function placeCard(setup: LabSetup, slot: SlotId, cardId: string): LabSetup {
  const from = findSlot(setup, cardId);
  if (from === null) {
    return withSlot(setup, slot, cardId);
  }
  if (from === slot) {
    return setup;
  }
  return withSlot(withSlot(setup, slot, cardId), from, slotValue(setup, slot));
}

/** 这张卡浮在桌上方吗。实验台与战斗共用同一份判据：原始 trait 里有「飞行」。 */
function isFlying(card: CardDefinition | undefined): boolean {
  return card !== undefined && card.rawTraits.includes(FLYING_TRAIT);
}

function liftOf(card: CardDefinition | undefined): number {
  return isFlying(card) ? FLYING_CARD_LIFT : 0;
}

/** 施法起点：卡面上方一点、朝施法者自己那侧偏出。与演出层的 `castPointOf` 同一套数值。 */
function castAt(position: Vec3, lift: number): Vec3 {
  return [position[0], lift + CAST_Y, position[2] + CAST_OFFSET];
}

/** 命中点：贴在这个槽的卡面上（飞行卡就落在空中那 0.475 上）。 */
function impactAt(position: Vec3, lift: number): Vec3 {
  return [position[0], lift + IMPACT_Y, position[2]];
}

/** 上排第 index 个槽的台面坐标。 */
function targetPosition(index: number): Vec3 {
  return [TARGET_XS[index] ?? SOURCE_X, 0, TARGET_Z];
}

export function EffectLabScene() {
  const [holoEnabled, setHoloEnabled] = useState(true);
  const [holoScale, setHoloScale] = useState(1);
  const [faceDown, setFaceDown] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>('formation');

  const [intensity, setIntensity] = useState(1);
  const [countScale, setCountScale] = useState(1);
  const [durationScale, setDurationScale] = useState(1);
  const [color, setColor] = useState<string>('');
  const [paused, setPaused] = useState(false);
  const [unyieldingPreview, setUnyieldingPreview] = useState(false);
  const [lastEffect, setLastEffect] = useState('（尚未触发）');
  const [particles, setParticles] = useState({ alive: 0, capacity: 0, peak: 0 });

  const profile = useSettingsStore((state) => state.profile);
  const theme = useSettingsStore((state) => state.tableTheme);
  const presentationSpeed = useSettingsStore((state) => state.presentationSpeed);
  const showPerf = useSettingsStore((state) => state.showPerf);

  const cards = useMemo(
    () =>
      [...new Set([...slice.cards.map((entry) => entry.cardId),
        ...cardDatabase.definitions.filter((card) => card.skills.some((skill) =>
          ['ranged', 'piercing', 'bombard', 'groupBombard', 'explodeOnDeath', 'instantDeath', 'spellReflect', 'grantDodge', 'directDamage', 'groupPhysicalDamage', 'slash', 'groupSlash', 'swordDance', 'groupSwordDance', 'sacrifice', 'execute', 'teleport', 'groupPiercing', 'criticalCollapse', 'unyielding'].includes(skill.family ?? ''))).map((card) => card.cardId)])]
        .map((id) => cardById.get(id))
        .filter((card): card is CardDefinition => card !== undefined),
    [],
  );

  /** 四个槽的牌。默认施法卡是切片第一张（数据自检与浏览器用例都按这张断言）。 */
  const [setup, setSetup] = useState<LabSetup>(() => ({
    source: cards[0]?.cardId ?? '',
    targets: DEFAULT_TARGET_IDS,
  }));

  const source = cardById.get(setup.source) ?? cards[0];
  const targets = useMemo(
    () =>
      setup.targets
        .map((id) => cardById.get(id))
        .filter((card): card is CardDefinition => card !== undefined),
    [setup.targets],
  );

  const sourcePosition = useMemo<Vec3>(
    () => (layout === 'formation' ? [SOURCE_X, 0, SOURCE_Z] : [0, 0, 0]),
    [layout],
  );

  /** 上排三个落点。单张大图模式下三张不渲染，特效就落在施法卡自己身上。 */
  const targetPoints = useMemo<readonly Vec3[]>(
    () =>
      layout === 'formation'
        ? targets.map((card, index) => impactAt(targetPosition(index), liftOf(card)))
        : [],
    [layout, targets],
  );

  // 粒子计数用低频采样读取：它是每帧被写的可变对象，直接接到状态会每帧重渲染
  useEffect(() => {
    const timer = window.setInterval(() => {
      setParticles({
        alive: particleStats.alive,
        capacity: particleStats.capacity,
        peak: particleStats.peak,
      });
    }, 120);
    return () => window.clearInterval(timer);
  }, []);

  const place = useCallback((slot: SlotId, cardId: string) => {
    setSetup((current) => placeCard(current, slot, cardId));
  }, []);

  /** 点 3D 里的卡＝把它换到施法位（与它原来占的槽对调）。 */
  const handleCardClick = useCallback(
    (clicked: CardDefinition) => {
      setSetup((current) => placeCard(current, 'source', clicked.cardId));
    },
    [],
  );

  const playTemplate = useCallback(
    (template: EffectTemplateId, label: string, overrideIntensity?: number, family?: string | null) => {
      if (family === 'unyielding') {
        setUnyieldingPreview((current) => !current);
        setLastEffect('不屈 · 切换施法卡持续遮罩');
        return;
      }
      const from = castAt(sourcePosition, liftOf(source));
      // 上排存在时：主目标是正上方那张（对位），另外两张走 `extraTargets`。
      // 打一张还是打三张**由配方按族名判定**（`group*` 才铺开），这里只给目标点——
      // 与战斗里 `eventEffects.ts` 的 `targetsOf` 给的是同一份东西：第一个是主目标，
      // 其余是额外目标。所以「对群打三张、对单只打对位」在实验台上看到的就是真实规则。
      const self = impactAt(sourcePosition, liftOf(source));
      const direct = template === 'ranged' || template === 'piercing' || template === 'groupPiercing';
      const selfBurst = template === 'injury' || template === 'deathBurst' || family === 'criticalCollapse';
      const primary: Vec3 = selfBurst ? self : direct ? [SOURCE_X, IMPACT_Y + 0.4, TARGET_Z - 1.35]
        : (targetPoints[ALIGNED_SLOT] ?? targetPoints[0] ?? self);
      const extra = targetPoints.filter((_, slot) => slot !== ALIGNED_SLOT);
      const spreads = template === 'deathBombard' || template.startsWith('group') || family?.startsWith('group') === true || family === 'teleport';
      const aimed =
        selfBurst ? '作用于自身' : template === 'groupPiercing' ? '战场五路平行贯穿，独立命中本体' : direct ? '越过对位命中本体' : targetPoints.length === 0 ? '单张大图：落在自己身上' : spreads ? '三张' : '只打对位';

      effectDirector.play({
        template,
        family: family ?? undefined,
        sourceInstanceId: source?.cardId,
        from: template === 'deathBombard' ? self : from,
        to: primary,
        extraTargets: extra,
        // 「原色」时用族自己的颜色（圣盾是金色），没登记的族交给模板自带配色
        color: color || (family ? FAMILY_TINT[family] : undefined) || undefined,
        intensity: overrideIntensity ?? intensity,
        countScale,
        // 演出速度只压缩播放时长，不影响任何规则结果（V-FX-5）
        durationScale: durationScale * SPEED_SCALE[presentationSpeed],
        onHit: () => setLastEffect(`${label} · 命中`),
      });
      setLastEffect(`${label} · 播放中（${aimed}）`);
    },
    [
      sourcePosition,
      source?.cardId,
      targetPoints,
      color,
      intensity,
      countScale,
      durationScale,
      presentationSpeed,
      source,
    ],
  );

  const playTrait = useCallback(
    (raw: string, family: string | null, param: number | null) => {
      const template = family ? FAMILY_TO_EFFECT[family] : undefined;
      if (!template) {
        setLastEffect(`${raw} · 没有对应的特效模板`);
        return;
      }
      // 族名要一路带下去：`群体振奋` 这类族的模板是 `buff`，靠族名才认得出是群体
      playTemplate(template, raw, param ?? 1, family);
    },
    [playTemplate, source],
  );

  if (!source) {
    return <div className="app-loading">切片数据为空，请先运行导入脚本。</div>;
  }

  const effectiveHolo = holoIntensityForRarity(source.rarity) * holoScale;
  const traits = source.skills.filter((skill) => skill.family);

  const staged: StagedCard[] =
    layout === 'formation'
      ? [
          { key: 'source', card: source, position: sourcePosition, flying: isFlying(source), unyielding: unyieldingPreview },
          ...targets.map((card, index) => ({
            key: `target-${index}`,
            card,
            position: targetPosition(index),
            flying: isFlying(card),
          })),
        ]
      : [{ key: 'source', card: source, position: [0, 0, 0], flying: isFlying(source), unyielding: unyieldingPreview }];

  const cardOption = (card: CardDefinition): ReactElement => (
    <option key={card.cardId} value={card.cardId}>
      {card.name.replace(/ /g, '')}（{card.cardId}）
    </option>
  );

  return (
    <WebGLGuard>
      <div className="lab">
        <Canvas
          // flat = 关闭渲染器自带的色调映射。
          // three 在渲染到屏幕时才应用色调映射，而挂了后处理链之后场景先渲到贴图上；
          // 于是「开不开后处理」会得到两套影调——实测差 10.9%。
          // 试过把 ACES 挂到后处理链尾，反而变成重复应用，反向差 23%。
          // 目前的取舍是关掉它，两条路径一致（差 1.4%）。
          flat
          shadows={profile.shadows ? { type: PCFShadowMap } : false}
          dpr={[1, profile.dprCap]}
          // 两排比原来一排深了 2 个世界单位：同一俯角、退远一点，前排才不会贴到画面下沿
          camera={{ position: [0, 3.5, 5.2], fov: 42, near: 0.1, far: 80 }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
        >
          <ambientLight intensity={0.85} />
          <hemisphereLight args={['#9fb6e0', '#3b4252', 0.85]} />
          <directionalLight
            position={[3, 6, 4]}
            intensity={1.5}
            castShadow
            shadow-mapSize-width={profile.shadowMapSize}
            shadow-mapSize-height={profile.shadowMapSize}
            shadow-camera-left={-6}
            shadow-camera-right={6}
            shadow-camera-top={6}
            shadow-camera-bottom={-6}
          />

          {/* 地面跟随台面主题，否则换主题时背景与地面会互相打架 */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
            <planeGeometry args={[22, 22]} />
            <meshStandardMaterial
              color={theme.table.color}
              roughness={theme.table.roughness}
            />
          </mesh>

          <LabStage
            staged={staged}
            faceDown={faceDown}
            holoEnabled={holoEnabled}
            holoScale={holoScale}
            paused={paused}
            capacity={profile.particleCapacity}
            onCardClick={handleCardClick}
          />

          {/*
            背景与雾来自台面主题：木桌是暖褐的暗、霓虹是紫黑、
            雪原是冷灰蓝。这两项一并换掉，整张桌子的气氛才会跟着主题走，
            而不是「桌子换了、空气没换」。
          */}
          <color attach="background" args={[theme.background]} />
          {/* 与战斗场景共用同一处尺度换算 */}
          <fog attach="fog" args={sceneFogArgs(theme.fog)} />

          <PerfSampler />
          <PostEffects profile={profile} theme={theme} />

          <OrbitControls
            target={[0, 0.2, 0]}
            minPolarAngle={0.15}
            maxPolarAngle={Math.PI / 2.1}
            minDistance={1.8}
            maxDistance={12}
            enablePan
          />
        </Canvas>

        <aside className="lab__panel">
          <h2 className="lab__title">实验台</h2>

          <section className="lab__section">
            <h3>第二行 · 施法卡（可任选）</h3>
            <div className="lab__row">
              <button
                type="button"
                onClick={() => {
                  const index = cards.findIndex((item) => item.cardId === source.cardId);
                  const next = cards[(index - 1 + cards.length) % cards.length];
                  if (next) {
                    place('source', next.cardId);
                  }
                }}
                title="上一张"
              >
                ←
              </button>
              <span className="lab__name">{source.name.replace(/ /g, '')}</span>
              <button
                type="button"
                onClick={() => {
                  const index = cards.findIndex((item) => item.cardId === source.cardId);
                  const next = cards[(index + 1) % cards.length];
                  if (next) {
                    place('source', next.cardId);
                  }
                }}
                title="下一张"
              >
                →
              </button>
            </div>
            <label className="lab__pick">
              <span>施法卡</span>
              <select value={source.cardId} onChange={(event) => place('source', event.target.value)}>
                {cards.map(cardOption)}
              </select>
            </label>
            <dl className="lab__meta">
              <dt>cardId</dt>
              <dd>
                <code>{source.cardId}</code>
              </dd>
              <dt>稀有度</dt>
              <dd>{source.rarity}</dd>
              <dt>ATK/HP/CD</dt>
              <dd>
                {source.atk}/{source.hp}/{source.cd}
              </dd>
              <dt>traits</dt>
              <dd>{source.rawTraits.join('、') || '—'}</dd>
            </dl>
          </section>

          <section className="lab__section">
            <h3>上排 · 三张目标（可任选）</h3>
            <ul className="lab__targets">
              {TARGET_SLOTS.map((slot) => {
                const id = setup.targets[slot];
                const target = cardById.get(id);
                return (
                  <li key={`target-${slot}`} className="lab__target">
                    <span className="lab__slot">{TARGET_LABELS[slot]}</span>
                    <select value={id} onChange={(event) => place(slot, event.target.value)}>
                      {cards.map(cardOption)}
                    </select>
                    {isFlying(target) ? <span className="lab__badge">飞行</span> : null}
                  </li>
                );
              })}
            </ul>
            <p className="lab__hint">
              特效从第二行的施法卡出发、落到这三张上：「对群」的技能打满三张，「对单」的只打
              「对位」那张（正前方）。打几张由技能族决定，这里没有覆盖开关。
              点 3D 里的任意一张 = 把它换到施法位（两槽对调）。
            </p>
          </section>

          <section className="lab__section">
            <h3>施法卡的 trait</h3>
            {traits.length === 0 ? (
              <p className="lab__hint">这张卡没有已注册的技能族 trait。</p>
            ) : (
              <div className="lab__buttons">
                {source.skills.map((skill, order) =>
                  skill.family ? (
                    <button
                      key={`${skill.raw}-${order}`}
                      type="button"
                      onClick={() => playTrait(skill.raw, skill.family, skill.param)}
                      title={`特效模板：${FAMILY_TO_EFFECT[skill.family] ?? '（无）'}`}
                    >
                      {skill.raw}
                    </button>
                  ) : null,
                )}
              </div>
            )}
            <p className="lab__hint">
              按 trait 的原始参数 n 当强度。目标那三张自己的 trait（防御、飞行、不死）不会在这里触发，
              它们影响的是「打上去之后怎样」——换掉上排的卡就能对着不同的规则试同一个技能。
            </p>
          </section>

          <section className="lab__section">
            <h3>攻击与特效</h3>
            <div className="lab__buttons">
              {TEMPLATE_LABELS.map((item) => (
                <button
                  /* 圣盾与护盾是同一个模板 id，key 得把族名带上，否则 React 会报重复 key */
                  key={item.family ?? item.id}
                  type="button"
                  onClick={() => playTemplate(item.id, item.label, undefined, item.family)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <section className="lab__section">
            <h3>特效参数</h3>
            <Slider
              label={`强度 n = ${intensity}`}
              min={1}
              max={8}
              step={1}
              value={intensity}
              onChange={setIntensity}
            />
            <Slider
              label={`数量 ×${countScale.toFixed(1)}`}
              min={0.2}
              max={2}
              step={0.1}
              value={countScale}
              onChange={setCountScale}
            />
            <Slider
              label={`时长 ×${durationScale.toFixed(1)}`}
              min={0.3}
              max={3}
              step={0.1}
              value={durationScale}
              onChange={setDurationScale}
            />
            <div className="lab__palette">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className={
                    color === preset.value ? 'lab__swatch lab__swatch--on' : 'lab__swatch'
                  }
                  style={{ background: preset.value }}
                  onClick={() => setColor(preset.value)}
                  title={preset.label}
                  aria-label={preset.label}
                />
              ))}
            </div>
          </section>

          <section className="lab__section">
            <h3>播放</h3>
            <label className="lab__toggle">
              <input
                type="checkbox"
                checked={paused}
                onChange={(event) => setPaused(event.target.checked)}
              />
              暂停（冻结粒子与时间轴，相机仍可操作）
            </label>
            <button
              type="button"
              className="lab__wide"
              onClick={() => {
                effectDirector.skipAll();
                setLastEffect('已跳过，补发全部完成回调');
              }}
            >
              立即结束全部特效（跳过）
            </button>
            <dl className="lab__meta">
              <dt>活跃粒子</dt>
              <dd>
                {particles.alive} / {particles.capacity}
              </dd>
              <dt>帧内峰值</dt>
              <dd>{particles.peak}</dd>
            </dl>
            {/* 浏览器用例按这个类断言「这次打了几张」——它是路由结果里唯一在 DOM 上可见的部分 */}
            <p className="lab__hint lab__last">最近：{lastEffect}</p>
          </section>

          <section className="lab__section">
            <h3>卡牌表现</h3>
            <label className="lab__toggle">
              <input
                type="checkbox"
                checked={layout === 'formation'}
                onChange={(event) => setLayout(event.target.checked ? 'formation' : 'single')}
              />
              阵型（第二行 1 张 + 上排 3 张；关闭则只留施法卡的大图）
            </label>
            <label className="lab__toggle">
              <input
                type="checkbox"
                checked={holoEnabled}
                onChange={(event) => setHoloEnabled(event.target.checked)}
              />
              全息层
            </label>
            <Slider
              label={`全息强度 ×${holoScale.toFixed(2)}（实际 ${effectiveHolo.toFixed(2)}）`}
              min={0}
              max={2}
              step={0.05}
              value={holoScale}
              onChange={setHoloScale}
            />
            <label className="lab__toggle">
              <input
                type="checkbox"
                checked={faceDown}
                onChange={(event) => setFaceDown(event.target.checked)}
              />
              盖牌（切换时播放翻面）
            </label>
          </section>

          <p className="lab__hint">
            拖动可环绕旋转：全息色带应随视角移动，特效的轨迹与命中点也应随视角保持正确。
            飞行卡在桌面上方 0.475 处缓慢起伏，对着它放单体技能就能看到「地对空」的落点差异。
          </p>
        </aside>

        <PerfOverlay visible={showPerf} />
      </div>
    </WebGLGuard>
  );
}

interface StagedCard {
  readonly unyielding?: boolean;
  readonly key: string;
  readonly card: CardDefinition;
  readonly position: Vec3;
  readonly flying: boolean;
}

interface LabStageProps {
  readonly staged: readonly StagedCard[];
  readonly faceDown: boolean;
  readonly holoEnabled: boolean;
  readonly holoScale: number;
  readonly paused: boolean;
  readonly capacity: number;
  readonly onCardClick: (card: CardDefinition) => void;
}

/** 卡牌陈列 + 粒子系统。 */
function LabStage({
  staged,
  faceDown,
  holoEnabled,
  holoScale,
  paused,
  capacity,
  onCardClick,
}: LabStageProps) {
  return (
    <>
      {staged.map((entry) => (
        <LabCard
          key={entry.key}
          card={entry.card}
          position={entry.position}
          flying={entry.flying}
          unyielding={entry.unyielding}
          faceDown={faceDown}
          holo={holoEnabled}
          holoScale={holoScale}
          paused={paused}
          onCardClick={onCardClick}
        />
      ))}
      <EffectSystem capacity={capacity} paused={paused} />
    </>
  );
}

interface LabCardProps {
  readonly unyielding?: boolean | undefined;
  readonly card: CardDefinition;
  /** 槽位在台面上的坐标；卡的**抬升**（飞行）由本组件自己叠上去。 */
  readonly position: Vec3;
  readonly flying: boolean;
  readonly faceDown: boolean;
  readonly holo: boolean;
  readonly holoScale: number;
  readonly paused: boolean;
  readonly onCardClick: (card: CardDefinition) => void;
}

/**
 * 一个槽位上的卡。
 *
 * `CardMesh` 内部每帧会覆写自己那一层的 **y 与 z**（悬停抬升、攻击前冲），
 * 但**不写 x**，所以槽位坐标必须由外面这层 group 给：x/z 定位、
 * y 承载「飞行卡浮在桌上方」这件事，两者互不打架。
 *
 * 飞行用战斗里的 `FLYING_CARD_LIFT`——同一条「卡是平放的，抬升就是离开台面」
 * 的约定，实验台上看到的落点差异才对得上战斗里的规则差异。
 */
function LabCard({
  card,
  unyielding,
  position,
  flying,
  faceDown,
  holo,
  holoScale,
  paused,
  onCardClick,
}: LabCardProps) {
  const groupRef = useRef<Group>(null);
  const base = flying ? FLYING_CARD_LIFT : 0;

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || paused) {
      // 暂停＝连浮动一起冻住，与粒子、时间轴同一条约定
      return;
    }
    const bob = flying
      ? Math.sin((clock.elapsedTime / FLY_BOB_PERIOD) * Math.PI * 2) * FLY_BOB_AMPLITUDE
      : 0;
    group.position.y = base + bob;
  });

  return (
    <group ref={groupRef} position={[position[0], base, position[2]]}>
      <CardMesh
        card={card}
        position={[0, 0, 0]}
        faceDown={faceDown}
        holo={holo}
        holoScale={holoScale}
        unyielding={unyielding}
        onClick={onCardClick}
      />
    </group>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="lab__slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
