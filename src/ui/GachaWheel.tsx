import { useEffect, useRef, useState } from 'react';
import type { GachaPool } from '../data';
import { ArtButtonSurface, artButtonStyle, gachaButtonArt } from './ArtButtonSurface';
import { DASHBOARD_STEP, dashboardSelection } from '../rendering/gacha/menuLayout';

export interface GachaWheelProps {
  readonly pools: readonly GachaPool[];
  readonly activeIndex: number;
  readonly onSelect: (index: number) => void;
  readonly still: boolean;
}

/** Original tilted vertical dashboard, with its selected row fixed at the midpoint. */
export function GachaWheel({ pools, activeIndex, onSelect, still }: GachaWheelProps) {
  const [offset, setOffset] = useState(activeIndex * DASHBOARD_STEP);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ y: number; offset: number; option: number | null } | null>(null);
  useEffect(() => { setOffset(activeIndex * DASHBOARD_STEP); }, [activeIndex]);
  const select = (index: number): void => {
    const next = Math.max(0, Math.min(pools.length - 1, index));
    setOffset(next * DASHBOARD_STEP);
    onSelect(next);
  };
  return (
    <div className={`wheel gacha-dashboard${still ? ' wheel--still' : ''}`}>
      <div className="wheel__stage gacha-dashboard__stage" role="listbox" aria-label="卡池"
        aria-activedescendant={`wheel-option-${activeIndex}`} tabIndex={0}
        onWheel={(event) => { select(activeIndex + (event.deltaY > 0 ? 1 : -1)); }}
        onKeyDown={(event) => {
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            select(event.key === 'Home' ? 0 : event.key === 'End' ? pools.length - 1 :
              activeIndex + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1));
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const option = (event.target as HTMLElement).closest<HTMLElement>('[data-pool-index]');
          drag.current = { y: event.clientY, offset, option: option ? Number(option.dataset.poolIndex) : null };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          // The dashboard is uniformly scaled with the 2880 × 1800 menu.
          const scale = event.currentTarget.getBoundingClientRect().height / 1620;
          setOffset(Math.max(0, Math.min((pools.length - 1) * DASHBOARD_STEP,
            drag.current.offset - (event.clientY - drag.current.y) / Math.max(0.01, scale))));
        }}
        onPointerUp={(event) => {
          const start = drag.current;
          if (!start) return;
          drag.current = null;
          setDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          select(Math.abs(event.clientY - start.y) < 6 && start.option !== null ? start.option : dashboardSelection(offset, pools.length));
        }}
        onPointerCancel={() => { drag.current = null; setDragging(false); setOffset(activeIndex * DASHBOARD_STEP); }}>
        <div className="gacha-dashboard__selection" aria-hidden="true" />
        {pools.map((pool, index) => (
          <button key={pool.id} id={`wheel-option-${index}`} type="button" role="option" tabIndex={-1}
            aria-selected={index === activeIndex} data-pool-id={pool.id} data-pool-index={index}
            className={`wheel__card gacha-dashboard__option art-button${index === activeIndex ? ' art-button--gold' : ''}${index === activeIndex ? ' wheel__card--on' : ''}`}
            style={{ ...artButtonStyle(gachaButtonArt(pool)), top: 750 + index * DASHBOARD_STEP - offset,
              transition: dragging || still ? 'none' : undefined }}
            onClick={() => select(index)}>
            <ArtButtonSurface />
            <span className="wheel__name art-button__label">{pool.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
