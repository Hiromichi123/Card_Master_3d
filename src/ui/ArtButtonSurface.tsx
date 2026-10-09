import type { CSSProperties } from 'react';
import type { GachaPool } from '../data';
import { cardArtUrl, cardFaceUrl } from '../data/assets';
import './artButtons.css';

/** One decorative surface for lobby navigation, pull actions and pool selector buttons. */
export function ArtButtonSurface() {
  return <span className="art-button__surface" aria-hidden="true">
    <span className="art-button__image" /><span className="art-button__grain" />
    <span className="art-button__engraving" />
  </span>;
}

export function artButtonStyle(url: string | null): CSSProperties {
  return { '--button-art': url ? `url("${url}")` : 'none' } as CSSProperties;
}

export function gachaButtonArt(pool: GachaPool): string | null {
  const id = pool.showcaseCards.find((cardId) => cardId.startsWith('SSS_')) ?? pool.showcaseCards[0];
  return id ? cardArtUrl(id) ?? cardFaceUrl(id, 'battle') : null;
}
