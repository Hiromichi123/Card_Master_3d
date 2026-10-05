import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PCFShadowMap, Vector3 } from 'three';

import { cardById, slice } from '../data';
import type { CardDefinition } from '../domain/cards/types';
import { CardMesh } from '../rendering/cards/CardMesh';
import { holoIntensityForRarity } from '../rendering/cards/HoloLayer';
import { effectDirector } from '../rendering/effects/effectDirector';
import { particleStats } from '../rendering/effects/particleStats';
import { EffectSystem } from '../rendering/effects/EffectSystem';
import { FAMILY_TO_EFFECT, type EffectTemplateId } from '../rendering/effects/templates';
import { WebGLGuard } from './WebGLGuard';

/**
 * 实验台（原「开发查看器」）。
 *
 * 存在的理由：卡牌质感与特效都是**视角与时间相关**的。战斗全景里卡牌只有
 * 几十像素、特效一闪而过，既看不出全息色带是否跟视角走，也看不出火球
 * 「有没有轨迹与命中」。把它们放到能慢慢看、能反复触发的地方，
 * `V-HOLO-*` / `V-FX-*` / `V-REF-*` 才可验证。
 *
 * 面板可以手动触发两类东西：
 * - **攻击与特效模板**：普通攻击、火球、冰封、闪电（含群体版）、护盾、治疗、祝福等；
 * - **当前卡自己的 trait**：经 `FAMILY_TO_EFFECT` 映射到模板，并用该 trait 的参数
 *   `n` 作为强度。「这张卡打出来是什么样」因此是直接可看的。
 */

const TEMPLATE_LABELS: { id: EffectTemplateId; label: string }[] = [
  { id: 'normalAttack', label: '普通攻击' },
  { id: 'fireball', label: '火球' },
  { id: 'iceSeal', label: '冰封' },
  { id: 'lightning', label: '闪电' },
  { id: 'groupFireball', label: '群体火球' },
  { id: 'groupIceSeal', label: '群体冰封' },
  { id: 'groupLightning', label: '群体闪电' },
  { id: 'shield', label: '护盾 / 防御' },
  { id: 'heal', label: '治愈 / 恢复' },
  { id: 'buff', label: '祝福 / 振奋' },
  { id: 'debuff', label: '诅咒 / 吸血' },
  { id: 'flow', label: '抽卡 / 转移' },
  { id: 'status', label: '沉默 / 飞行' },
];

const GROUP_TEMPLATES = new Set<EffectTemplateId>([
  'groupFireball',
  'groupIceSeal',
  'groupLightning',
]);

/** 预设主题色：颜色是给「看效果」用的，不需要任意取色器。 */
const COLOR_PRESETS: { label: string; value: string }[] = [
  { label: '金', value: '#ffb445' },
  { label: '冰', value: '#8fd4ff' },
  { label: '雷', value: '#cfe6ff' },
  { label: '护', value: '#7fb2ff' },
  { label: '愈', value: '#8bf5c0' },
  { label: '咒', value: '#b46bff' },
  { label: '血', value: '#ff5a6e' },
];

const CARD_ROW_X = [-1.25, 0, 1.25];

/** 施法者起点：在牌列前方偏上，让轨迹有明显的高度差。 */
const CASTER_ORIGIN: readonly [number, number, number] = [0, 1.5, 2.8];

type LayoutMode = 'single' | 'row';

export function EffectLabScene() {
  const [index, setIndex] = useState(0);
  const [layout, setLayout] = useState<LayoutMode>('row');
  const [holoEnabled, setHoloEnabled] = useState(true);
  const [holoScale, setHoloScale] = useState(1);
  const [faceDown, setFaceDown] = useState(false);

  const [intensity, setIntensity] = useState(1);
  const [countScale, setCountScale] = useState(1);
  const [durationScale, setDurationScale] = useState(1);
  const [color, setColor] = useState<string>('#ffb445');
  const [paused, setPaused] = useState(false);
  const [lastEffect, setLastEffect] = useState('（尚未触发）');
  const [particles, setParticles] = useState({ alive: 0, capacity: 0, peak: 0 });

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

  const cards = useMemo(
    () =>
      slice.cards
        .map((entry) => cardById.get(entry.cardId))
        .filter((card): card is CardDefinition => card !== undefined),
    [],
  );

  const card = cards[index];

  const step = (delta: number): void => {
    setIndex((current) => {
      const next = current + delta;
      if (next < 0) {
        return cards.length - 1;
      }
      if (next >= cards.length) {
        return 0;
      }
      return next;
    });
  };

  const handleCardClick = useCallback(
    (clicked: CardDefinition) => {
      const position = cards.findIndex((item) => item.cardId === clicked.cardId);
      if (position >= 0) {
        setIndex(position);
      }
    },
    [cards],
  );

  const playTemplate = useCallback(
    (template: EffectTemplateId, label: string, overrideIntensity?: number) => {
      /**
       * 目标点恒为原点。
       *
       * 两种布局里**当前选中的卡都摆在 x=0**：单卡模式只有一张；三张一排时
       * `LabStage` 把选中的那张放在正中。所以这里不能用 `CARD_ROW_X[index]`——
       * `index` 是切片列表里的下标，不是牌列里的槽位，
       * 那样会把特效打到旁边那张卡上（并让轨迹看起来方向不对）。
       */
      const extras =
        layout === 'row' && GROUP_TEMPLATES.has(template)
          ? CARD_ROW_X.filter((x) => x !== 0).map((x) => [x, 0, 0] as [number, number, number])
          : [];

      effectDirector.play({
        template,
        from: CASTER_ORIGIN,
        to: [0, 0, 0],
        extraTargets: extras,
        color,
        intensity: overrideIntensity ?? intensity,
        countScale,
        durationScale,
        onHit: () => setLastEffect(`${label} · 命中`),
      });
      setLastEffect(`${label} · 播放中`);
    },
    [layout, index, color, intensity, countScale, durationScale],
  );

  const playTrait = useCallback(
    (raw: string, family: string | null, param: number | null) => {
      const template = family ? FAMILY_TO_EFFECT[family] : undefined;
      if (!template) {
        setLastEffect(`${raw} · 没有对应的特效模板`);
        return;
      }
      playTemplate(template, raw, param ?? 1);
    },
    [playTemplate],
  );

  if (!card) {
    return <div className="app-loading">切片数据为空，请先运行导入脚本。</div>;
  }

  const effectiveHolo = holoIntensityForRarity(card.rarity) * holoScale;
  const traits = card.skills.filter((skill) => skill.family);

  return (
    <WebGLGuard>
      <div className="lab">
        <Canvas
          shadows={{ type: PCFShadowMap }}
          dpr={[1, 2]}
          camera={{ position: [0, 3.2, 4.6], fov: 42, near: 0.1, far: 80 }}
          onCreated={({ gl }) => gl.setClearColor('#0d1018')}
        >
          <ambientLight intensity={0.85} />
          <hemisphereLight args={['#9fb6e0', '#3b4252', 0.85]} />
          <directionalLight
            position={[3, 6, 4]}
            intensity={1.5}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-6}
            shadow-camera-right={6}
            shadow-camera-top={6}
            shadow-camera-bottom={-6}
          />

          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
            <planeGeometry args={[22, 22]} />
            <meshStandardMaterial color="#2b3140" roughness={0.95} />
          </mesh>

          <LabStage
            card={card}
            layout={layout}
            faceDown={faceDown}
            holoEnabled={holoEnabled}
            holoScale={holoScale}
            paused={paused}
            onCardClick={handleCardClick}
          />

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
            <div className="lab__row">
              <button type="button" onClick={() => step(-1)} title="上一张">
                ←
              </button>
              <span className="lab__name">{card.name.replace(/ /g, '')}</span>
              <button type="button" onClick={() => step(1)} title="下一张">
                →
              </button>
            </div>
            <dl className="lab__meta">
              <dt>cardId</dt>
              <dd>
                <code>{card.cardId}</code>
              </dd>
              <dt>稀有度</dt>
              <dd>{card.rarity}</dd>
              <dt>ATK/HP/CD</dt>
              <dd>
                {card.atk}/{card.hp}/{card.cd}
              </dd>
              <dt>traits</dt>
              <dd>{card.rawTraits.join('、') || '—'}</dd>
            </dl>
          </section>

          <section className="lab__section">
            <h3>攻击与特效</h3>
            <div className="lab__buttons">
              {TEMPLATE_LABELS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => playTemplate(item.id, item.label)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <section className="lab__section">
            <h3>当前卡的 trait</h3>
            {traits.length === 0 ? (
              <p className="lab__hint">这张卡没有已注册的技能族 trait。</p>
            ) : (
              <div className="lab__buttons">
                {card.skills.map((skill, order) =>
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
            <p className="lab__hint">最近：{lastEffect}</p>
          </section>

          <section className="lab__section">
            <h3>卡牌表现</h3>
            <label className="lab__toggle">
              <input
                type="checkbox"
                checked={layout === 'row'}
                onChange={(event) => setLayout(event.target.checked ? 'row' : 'single')}
              />
              三张一排（关闭则单张大图）
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
          </p>
        </aside>
      </div>
    </WebGLGuard>
  );
}

interface LabStageProps {
  readonly card: CardDefinition;
  readonly layout: LayoutMode;
  readonly faceDown: boolean;
  readonly holoEnabled: boolean;
  readonly holoScale: number;
  readonly paused: boolean;
  readonly onCardClick: (card: CardDefinition) => void;
}

/** 卡牌陈列 + 粒子系统。 */
function LabStage({
  card,
  layout,
  faceDown,
  holoEnabled,
  holoScale,
  paused,
  onCardClick,
}: LabStageProps) {
  const staged = useMemo(() => {
    const list = slice.cards
      .map((entry) => cardById.get(entry.cardId))
      .filter((item): item is CardDefinition => item !== undefined);
    const index = list.findIndex((item) => item.cardId === card.cardId);

    if (layout === 'single') {
      return [{ card, x: 0 }];
    }
    // 三张一排：中间是当前选中的卡，两侧取相邻切片卡，
    // 这样群体特效有真实的落点，而不是打向空气
    return CARD_ROW_X.map((x, offset) => {
      const candidate = list[(index + offset - 1 + list.length) % list.length];
      return { card: candidate ?? card, x };
    });
  }, [card, layout]);

  return (
    <>
      {staged.map((entry) => (
        <CardMesh
          key={`${entry.card.cardId}-${entry.x}`}
          card={entry.card}
          position={[entry.x, 0, 0]}
          faceDown={faceDown}
          holo={holoEnabled}
          holoScale={holoScale}
          onClick={onCardClick}
        />
      ))}
      <EffectSystem capacity={3000} paused={paused} />
    </>
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

/** 施法者起点的世界坐标。 */
export function labCasterOrigin(): Vector3 {
  return new Vector3(CASTER_ORIGIN[0], CASTER_ORIGIN[1], CASTER_ORIGIN[2]);
}
