import { useEffect, useMemo, useRef, useState } from 'react';
import { cardById, type GachaPool } from '../data';
import type { CardDefinition } from '../domain/cards/types';
import type { ProfileState } from '../domain/progression/types';
import { menuFit, showcaseRects } from '../rendering/gacha/menuLayout';
import { useSettingsStore } from '../state/settingsStore';
import { useRarityIndex } from '../state/useRarityIndex';
import { CardShowcase } from './CardShowcase';
import { CurrencyBar } from './CurrencyBar';
import { ArtButtonSurface, artButtonStyle, gachaButtonArt } from './ArtButtonSurface';
import { GachaWheel } from './GachaWheel';
import { usePageWheel } from './usePageWheel';

interface Props {
  readonly pools: readonly GachaPool[];
  readonly pool: GachaPool;
  readonly poolIndex: number;
  readonly onSelectPool: (index: number) => void;
  readonly currencies: ProfileState['currencies'];
  readonly running: boolean;
  readonly error: string | null;
  readonly onPull: (count: 1 | 10) => void;
  readonly onReturn: (() => void) | undefined;
  readonly leaving: boolean;
  readonly exitSeconds: number;
  readonly onHoverCard: (index: number | null) => void;
  readonly onCardPointer: (pointer: readonly [number, number]) => void;
}

/** All UI and 3D positions share the original design frame, fitted with a uniform scale. */
export function GachaMenu({ pools, pool, poolIndex, onSelectPool, currencies,
  running, error, onPull, onReturn, leaving, exitSeconds, onHoverCard, onCardPointer }: Props) {
  const buttonArt = artButtonStyle(gachaButtonArt(pool));
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const still = useSettingsStore((state) => state.reduceMotion);
  const rarityIndex = useRarityIndex();
  const cards = useMemo(() => pool.showcaseCards.map((id) => cardById.get(id))
    .filter((card): card is CardDefinition => card !== undefined), [pool]);
  const rects = useMemo(() => showcaseRects(cards.length), [cards.length]);
  const cardIds = useMemo(() => cards.map((card) => card.cardId), [cards]);
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const measure = (): void => { setScale(menuFit(container.clientWidth, container.clientHeight)); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setDetail(null); onHoverCard(null); onCardPointer([0, 0]); }, [pool, onHoverCard, onCardPointer]);

  /*
    全页滚轮：指针在页面**任何位置**滚动都切卡池。
    轮盘本身带 `onWheel`（`GachaWheel`），事件会冒泡到这里，所以用
    `ignoreSelector` 把落在轮盘内的滚动让给它——否则在轮盘上滚一次走两格。
    演出进行中与卡牌详情打开时不响应。
  */
  usePageWheel({
    ref,
    enabled: !running && detail === null,
    ignoreSelector: '.wheel__stage',
    onStep: (delta) => {
      const next = Math.max(0, Math.min(pools.length - 1, poolIndex + delta));
      if (next !== poolIndex) {
        onSelectPool(next);
      }
    },
  });

  return (
    <div ref={ref} className={`gacha-menu${still ? ' gacha-menu--still' : ''}${leaving ? ' gacha-menu--leaving' : ''}`} style={{ ['--gacha-exit-duration' as string]: `${exitSeconds}s` }}>
      {scale > 0 && <div className={`gacha-menu__frame${running ? ' gacha-menu__frame--busy' : ''}`} style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        <header className="gacha-menu__heading">
          <h1 className="gacha__pool-name">{pool.name}</h1>
          <p className="gacha__desc">{pool.description}</p>
        </header>
        <div className="gacha-menu__currency"><CurrencyBar currencies={currencies} /></div>
        <GachaWheel pools={pools} activeIndex={poolIndex} onSelect={(index) => { if (!running) onSelectPool(index); }} still={still} />
        <div className="gacha-menu__card-controls" aria-label="卡池预览">
          {cards.map((card, index) => {
            const rect = rects[index]!;
            return <button key={`${card.cardId}-${index}`} type="button" className="gacha-menu__card-hit" disabled={running}
              aria-label={`${card.name} · ${card.rarity}，查看详情`} data-card-id={card.cardId}
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: index + 1,
                outlineColor: rarityIndex.colorOf(card.rarity) }}
              onPointerEnter={() => { onHoverCard(index); onCardPointer([0, 0]); }}
              onPointerMove={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                onCardPointer([(event.clientX - bounds.left) / bounds.width * 2 - 1, (event.clientY - bounds.top) / bounds.height * 2 - 1]);
              }}
              onPointerLeave={() => onHoverCard(null)} onFocus={() => onHoverCard(index)} onBlur={() => onHoverCard(null)}
              onClick={() => { onHoverCard(null); setDetail(card.cardId); }} />;
          })}
        </div>
        <div className="gacha__buttons gacha-menu__actions">
          <button type="button" className="btn art-button art-button--gold" style={buttonArt} disabled={running} data-testid="pull-1" onClick={() => onPull(1)}>
            <span className="gacha-menu__cost">{pool.singleCost} {pool.currency === 'gold' ? '金币' : '水晶'}</span><ArtButtonSurface /><span className="art-button__label">单 抽</span>
          </button>
          <button type="button" className="btn btn--primary art-button art-button--gold" style={buttonArt} disabled={running} data-testid="pull-10" onClick={() => onPull(10)}>
            <span className="gacha-menu__cost">{pool.tenCost} {pool.currency === 'gold' ? '金币' : '水晶'}</span><ArtButtonSurface /><span className="art-button__label">十 连 抽</span>
          </button>
          <button type="button" className="btn gacha-menu__return art-button" style={buttonArt} onClick={onReturn} disabled={running || !onReturn}><ArtButtonSurface /><span className="art-button__label">返回主菜单</span></button>
        </div>
        {error && <p className="gacha__error gacha-menu__error" role="status">{error}</p>}
      </div>}
      {detail && <CardShowcase cardId={detail} cardIds={cardIds} onSelect={setDetail} onClose={() => setDetail(null)} />}
    </div>
  );
}
