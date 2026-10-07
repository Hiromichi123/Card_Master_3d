import '../ui/localBattle.css';
import { Canvas, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { OrthographicCamera } from 'three';

import { cardById, cardDatabase } from '../data';
import { backgroundUrl } from '../data/assets';
import type { BattleConfig } from '../domain/battle/types';
import type { SideId } from '../domain/cards/types';
import {
  chooseDraftCard, createLocalDraft, draftBattleConfig, draftComplete,
  DRAFT_DECK_SIZE, DRAFT_ROW_COUNTS, pickLocalDraft, type LocalDraft,
} from '../domain/battle/localDraft';
import { CardMesh } from '../rendering/cards/CardMesh';
import { useSettingsStore } from '../state/settingsStore';
import { CardShowcase } from '../ui/CardShowcase';
import { DesignStage } from '../ui/DesignStage';
import { BattleScene } from './BattleScene';
import { definitionsFor } from './campaignFlow';
import { WebGLGuard } from './WebGLGuard';

// Original draft_scene.py geometry in the shared 2880 × 1800 design space.
const WIDTH = 216;
const HEIGHT = 324;
const GAP = 25;
const CANVAS_TOP = 300;
const CANVAS_HEIGHT = 1150;
const SIDE_NAME: Record<SideId, string> = { player: '下方', enemy: '上方' };

function newDraft(): LocalDraft {
  return createLocalDraft(cardDatabase.definitions, crypto.getRandomValues(new Uint32Array(1))[0]!);
}

function draftPositions(): readonly { x: number; y: number }[] {
  return DRAFT_ROW_COUNTS.flatMap((count, row) => {
    const start = (2880 - count * WIDTH - (count - 1) * GAP) / 2;
    const top = 1800 * 0.40 + (row - 1) * (HEIGHT + GAP);
    return Array.from({ length: count }, (_, column) => ({ x: start + column * (WIDTH + GAP), y: top }));
  });
}

function DraftCamera() {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  useLayoutEffect(() => {
    if (!(camera instanceof OrthographicCamera)) return;
    camera.left = -1440; camera.right = 1440;
    camera.top = CANVAS_HEIGHT / 2; camera.bottom = -CANVAS_HEIGHT / 2;
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

export function LocalBattleScene({ onReturn }: { readonly onReturn: () => void }) {
  const [draft, setDraft] = useState<LocalDraft>(newDraft);
  const [upperAI, setUpperAI] = useState(false);
  const [battle, setBattle] = useState<BattleConfig | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const profile = useSettingsStore((state) => state.profile);
  const positions = useMemo(draftPositions, []);
  const complete = draftComplete(draft);

  const pick = useCallback((cardId: string) => {
    setDraft((current) => upperAI && current.currentSide === 'enemy' ? current : pickLocalDraft(current, cardId));
    setHovered(null);
  }, [upperAI]);

  useEffect(() => {
    if (!upperAI || complete || battle || preview || draft.currentSide !== 'enemy') return;
    const timer = window.setTimeout(() => {
      setDraft((current) => {
        if (current.currentSide !== 'enemy') return current;
        const cardId = chooseDraftCard(current, cardById);
        return cardId ? pickLocalDraft(current, cardId) : current;
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [upperAI, draft, complete, battle, preview]);

  useEffect(() => {
    if (!complete || battle || preview) return;
    const timer = window.setTimeout(() => setBattle(draftBattleConfig(draft)), 650);
    return () => window.clearTimeout(timer);
  }, [complete, battle, draft, preview]);

  const restart = useCallback(() => {
    setBattle(null); setPreview(null); setHovered(null); setDraft(newDraft());
  }, []);

  useEffect(() => {
    if (battle) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !preview) onReturn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [battle, preview, onReturn]);

  if (battle) return <BattleScene key={draft.seed}
    config={battle} definitions={definitionsFor([...battle.playerDeck, ...battle.enemyDeck])}
    localMultiplayer autoEnemy={upperAI} autoStart
    onExit={restart} onLeave={onReturn} exitLabel="重新选卡" />;

  const lock = complete || preview !== null || (upperAI && draft.currentSide === 'enemy');
  return <><DesignStage className="local-draft" backgroundUrl={backgroundUrl('battle_bg')}>
    <header className="local-draft__heading">
      <h1>双方交替选择12张卡牌进入战斗</h1>
      <p aria-live="polite" className={`local-draft__turn local-draft__turn--${draft.currentSide}`}>
        {complete ? '选卡完成，准备开战…' : `为${SIDE_NAME[draft.currentSide]}选择卡牌${upperAI && draft.currentSide === 'enemy' ? ' · AI 选择中…' : ''}`}
      </p>
    </header>
    {(['enemy', 'player'] as const).map((side) => <section key={side}
      className={`local-draft__deck local-draft__deck--${side}`}>
      <strong>{SIDE_NAME[side]}卡组</strong>
      <span>{draft.decks[side].length}/{DRAFT_DECK_SIZE}</span>
      <progress value={draft.decks[side].length} max={DRAFT_DECK_SIZE} aria-label={`${SIDE_NAME[side]}选卡进度`} />
    </section>)}
    <button type="button" className="local-draft__ai btn" aria-pressed={upperAI}
      disabled={complete} onClick={() => setUpperAI((current) => !current)}>
      上方 AI：{upperAI ? '开' : '关'}
    </button>

    <div className="local-draft__canvas" style={{ top: `calc(${CANVAS_TOP} * var(--ui))`, height: `calc(${CANVAS_HEIGHT} * var(--ui))` }}>
      <WebGLGuard><Canvas flat orthographic dpr={[1, profile.dprCap]}
        camera={{ position: [0, 0, 3000], near: 0.1, far: 6000 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}>
        <DraftCamera />
        <ambientLight intensity={1.2} />
        <directionalLight position={[600, 900, 1500]} intensity={1.8} />
        {draft.pool.map((cardId, index) => {
          const card = cardById.get(cardId);
          const position = positions[index];
          if (!card || !position) return null;
          const owner = draft.owners[cardId];
          return <group key={cardId} position={[
            position.x + WIDTH / 2 - 1440,
            CANVAS_HEIGHT / 2 - (position.y - CANVAS_TOP + HEIGHT / 2),
            hovered === cardId && !owner ? 24 : 0,
          ]} onContextMenu={(event) => {
            event.stopPropagation(); event.nativeEvent.preventDefault(); setPreview(cardId);
          }}>
            <CardMesh key={`${cardId}-${owner ?? 'pool'}`} card={card} position={[0, 0, 0]}
              rotationX={0} scale={WIDTH} textureTier="battle" showStats={false}
              holo={!owner} glow glowScale={owner ? 0.35 : 1}
              interactive={!owner && !lock} onClick={() => pick(cardId)}
              onHoverChange={(_, over) => setHovered(over ? cardId : null)} />
            {owner && <mesh position={[0, 0, 5]} raycast={() => {}}>
              <planeGeometry args={[WIDTH, HEIGHT]} />
              <meshBasicMaterial color="#182235" transparent opacity={0.65} depthWrite={false} />
            </mesh>}
          </group>;
        })}
      </Canvas></WebGLGuard>
    </div>
    {draft.pool.map((cardId, index) => {
      const owner = draft.owners[cardId];
      const position = positions[index];
      if (!owner || !position) return null;
      return <span key={cardId} className={`local-draft__picked local-draft__picked--${owner}`}
        style={{ left: `calc(${position.x + WIDTH / 2} * var(--ui))`, top: `calc(${position.y + HEIGHT / 2} * var(--ui))` }}>
        {SIDE_NAME[owner]}已选
      </span>;
    })}
    <div className="local-draft__accessible">
      {draft.pool.map((cardId) => <button type="button" key={cardId}
        disabled={Boolean(draft.owners[cardId]) || lock} onClick={() => pick(cardId)}
        onFocus={() => setHovered(cardId)} onBlur={() => setHovered(null)}>
        选择 {cardById.get(cardId)?.name ?? cardId}
      </button>)}
    </div>
    <footer className="local-draft__footer">
      <p>左键选卡 · 右键查看详情 · 各选满 12 张后自动开战</p>
      <p>28 张候选不重复，保留 4 张未选牌 · 不消耗馆藏卡牌</p>
    </footer>
    <div className="local-draft__actions">
      <button type="button" className="btn" onClick={restart}>重新选卡</button>
      <button type="button" className="btn" onClick={onReturn}>返回对战菜单</button>
    </div>
  </DesignStage>
    {preview && <CardShowcase cardId={preview} cardIds={draft.pool}
      onSelect={setPreview} onClose={() => setPreview(null)} />}
  </>;
}
