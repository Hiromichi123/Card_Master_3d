import { useEffect, useState } from 'react';
import type { CardDefinition } from '../../domain/cards/types';
import type { TextureTier } from '../../services/AssetManager';
import { cardFaceUrlForDefinition } from '../../data/assets';
import { abyssFaceRequest, acquireAbyssFace, releaseAbyssFace } from './abyssCardFace';

/** Normal cards keep their original URL; only cultivated Abyss faces get a derived image. */
export function useAbyssCardFace(card: CardDefinition | undefined, tier: TextureTier): string | null {
  const source = card ? cardFaceUrlForDefinition(card, tier) : null;
  const request = card ? abyssFaceRequest(card, tier) : null;
  const key = request?.key ?? source;
  const [derived, setDerived] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (!request) return;
    let active = true;
    void acquireAbyssFace(request).then(url => { if (active) setDerived({ key: request.key, url }); });
    return () => { active = false; releaseAbyssFace(request.key); };
  }, [key]);
  return derived && derived.key === key ? derived.url : source;
}
