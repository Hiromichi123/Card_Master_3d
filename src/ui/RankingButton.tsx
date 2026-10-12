import type { CSSProperties } from 'react';
import { cardArtUrl, cardFaceUrl } from '../data/assets';
import { useSettingsStore } from '../state/settingsStore';
import { ArtButtonSurface } from './ArtButtonSurface';
import './hubMenu.css';
import './rankingButton.css';

export interface RankingButtonProps {
  readonly onClick: () => void;
  readonly className?: string;
}

/** 两个入口共用同一插画、金框及三柱领奖台，不增加装饰Canvas。 */
export function RankingButton({ onClick, className = '' }: RankingButtonProps) {
  const still = useSettingsStore(state => state.reduceMotion);
  const art = cardArtUrl('SSS_001') ?? cardFaceUrl('SSS_001', 'battle');
  return <button type="button" className={`hub-button art-button hub-main__button hub-button--ranking ranking-button ${className}`}
    data-still={still} data-unavailable={false} title="天梯、收藏与深渊排行榜 · 本地演示榜" onClick={onClick}
    style={{ '--hub-color': '#dec184', '--hub-from': 'rgba(24, 32, 43, .92)', '--hub-to': 'rgba(34, 38, 43, .86)',
      '--button-art': art ? `url("${art}")` : 'none' } as CSSProperties}>
    <ArtButtonSurface />
    <span className="hub-logo-anchor" aria-hidden="true">
      <svg className="ranking-button__logo" viewBox="0 0 100 100" fill="none" strokeLinejoin="round">
        <path d="M12 49h21v34H12z" fill="#ac9364" stroke="#ffe3a4" strokeWidth="2" />
        <path d="m33 49 8-6v34l-8 6z" fill="#655036" stroke="#cdb37c" strokeWidth="2" />
        <path d="M40 22h21v61H40z" fill="#e2c17b" stroke="#fff1c7" strokeWidth="2" />
        <path d="m61 22 8-6v61l-8 6z" fill="#99713d" stroke="#dfc286" strokeWidth="2" />
        <path d="M69 39h19v44H69z" fill="#ac9364" stroke="#ffe3a4" strokeWidth="2" />
        <path d="m88 39 7-6v44l-7 6z" fill="#655036" stroke="#cdb37c" strokeWidth="2" />
        <path d="M8 86h87v6H8z" fill="#d2b477" stroke="#ffe3a4" strokeWidth="2" />
        <path d="m40 22 8-6h21l-8 6zM12 49l8-6h21l-8 6zM69 39l7-6h19l-7 6z" fill="#eddaa8" />
      </svg>
    </span>
    <span className="hub-button__copy"><strong>排行榜</strong></span>
  </button>;
}
