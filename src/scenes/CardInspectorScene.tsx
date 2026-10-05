import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo, useState } from 'react';

import { cardById, slice } from '../data';
import type { CardDefinition } from '../domain/cards/types';
import { CardMesh } from '../rendering/cards/CardMesh';
import { holoIntensityForRarity } from '../rendering/cards/HoloLayer';
import { WebGLGuard } from './WebGLGuard';

/**
 * 卡牌检视器（开发查看器的一部分）。
 *
 * 为什么必须单独做这个：全息反光是**视角相关**的，战斗全景里卡牌只有几十像素，
 * 既看不出色带是否跟着视角移动，也判断不了「有没有淹没插画」。
 * 把这个判断放进一张能环绕旋转的大卡上，`V-HOLO-1` 与 `V-HOLO-2` 才可验证。
 *
 * 特效参数（颜色/强度/数量/持续时间、暂停、逐步查看命中）随后续的粒子系统一起补。
 */
export function CardInspectorScene() {
  const [index, setIndex] = useState(0);
  const [holoEnabled, setHoloEnabled] = useState(true);
  const [holoScale, setHoloScale] = useState(1);
  const [faceDown, setFaceDown] = useState(false);

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

  if (!card) {
    return <div className="app-loading">切片数据为空，请先运行导入脚本。</div>;
  }

  const baseIntensity = holoIntensityForRarity(card.rarity);
  const effectiveIntensity = baseIntensity * holoScale;

  return (
    <WebGLGuard>
      <div className="inspector">
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [0, 2.4, 3.4], fov: 38, near: 0.1, far: 60 }}
          onCreated={({ gl }) => gl.setClearColor('#0d1018')}
        >
          <ambientLight intensity={0.85} />
          <hemisphereLight args={['#9fb6e0', '#3b4252', 0.85]} />
          <directionalLight position={[2.5, 5, 3]} intensity={1.5} castShadow />

          {/* 卡牌平放在原点。环绕相机 = 改变视角，用来验证反光是否跟着视角走 */}
          <CardMesh
            card={card}
            position={[0, 0, 0]}
            faceDown={faceDown}
            holo={holoEnabled}
            holoScale={holoScale}
            interactive={false}
          />

          {/* 桌面参考面，给卡牌一个投影面 */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
            <planeGeometry args={[14, 14]} />
            <meshStandardMaterial color="#2b3140" roughness={0.95} />
          </mesh>

          <OrbitControls
            target={[0, 0, 0]}
            minPolarAngle={0.15}
            maxPolarAngle={Math.PI / 2.15}
            minDistance={2}
            maxDistance={8}
            enablePan={false}
          />
        </Canvas>

        <aside className="inspector__panel">
          <h2 className="inspector__title">卡牌检视</h2>

          <div className="inspector__row">
            <button type="button" onClick={() => step(-1)}>
              ←
            </button>
            <span className="inspector__name">{card.name.replace(/ /g, '')}</span>
            <button type="button" onClick={() => step(1)}>
              →
            </button>
          </div>

          <dl className="inspector__meta">
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

          <label className="inspector__toggle">
            <input
              type="checkbox"
              checked={holoEnabled}
              onChange={(event) => setHoloEnabled(event.target.checked)}
            />
            全息层
          </label>

          <label className="inspector__slider">
            <span>
              全息强度 ×{holoScale.toFixed(2)}
              <em>
                实际 {effectiveIntensity.toFixed(2)}（{card.rarity} 基准{' '}
                {baseIntensity.toFixed(2)}）
              </em>
            </span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={holoScale}
              onChange={(event) => setHoloScale(Number(event.target.value))}
            />
          </label>

          <label className="inspector__toggle">
            <input
              type="checkbox"
              checked={faceDown}
              onChange={(event) => setFaceDown(event.target.checked)}
            />
            盖牌（切换时播放翻面）
          </label>

          <p className="inspector__hint">
            拖动可环绕旋转：色带应随视角移动，而不是固定在卡面上。把强度拉到 2×
            可以看清上界，再回到 1× 判断名称是否仍可读。
          </p>
        </aside>
      </div>
    </WebGLGuard>
  );
}
