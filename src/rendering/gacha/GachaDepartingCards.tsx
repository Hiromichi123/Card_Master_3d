import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import type { CardDefinition } from '../../domain/cards/types';
import { CardMesh } from '../cards/CardMesh';
import { gridSlots, SINGLE_CARD_SCALE, TEN_CARD_SCALE, UI_EXIT } from './choreography';

/** The previous result leaves before the new landing sequence; the board never remounts. */
export function GachaDepartingCards({ cards, elapsed }: {
  readonly cards: readonly CardDefinition[];
  readonly elapsed: Readonly<{ current: number }>;
}) {
  const scale = cards.length === 1 ? SINGLE_CARD_SCALE : TEN_CARD_SCALE;
  const slots = gridSlots(cards.length === 1 ? 1 : 10, scale);
  return <>{cards.map((card, index) => <Departing key={`${card.cardId}-${index}`} card={card}
    slot={slots[index] ?? [0, 0]} scale={scale} elapsed={elapsed} />)}</>;
}
function Departing({ card, slot, scale, elapsed }: {
  readonly card: CardDefinition; readonly slot: readonly [number, number]; readonly scale: number;
  readonly elapsed: Readonly<{ current: number }>;
}) {
  const group = useRef<Group>(null);
  useFrame(() => {
    const progress = Math.min(1, elapsed.current / UI_EXIT);
    if (!group.current) return;
    group.current.visible = progress < 1;
    group.current.position.set(slot[0] + (Math.sign(slot[0]) || 1) * progress * progress * 8, slot[1], 0);
    group.current.scale.setScalar(scale * (1 - progress * 0.2));
  });
  return <group ref={group} position={[slot[0], slot[1], 0]} scale={scale}>
    <CardMesh card={card} position={[0, 0, 0]} rotationX={0} interactive={false} showStats={false} glow glowScale={2.2} />
  </group>;
}
