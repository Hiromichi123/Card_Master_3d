import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import type { CardDefinition } from '../../domain/cards/types';
import { useSettingsStore } from '../../state/settingsStore';
import { CardMesh } from '../cards/CardMesh';
import { damp } from '../anim/motion';
import { GACHA_MENU_HEIGHT, GACHA_MENU_WIDTH, type PreviewRect } from './menuLayout';
import { backdropSize, UI_EXIT } from './choreography';

interface Props {
  readonly cards: readonly CardDefinition[];
  readonly rects: readonly PreviewRect[];
  readonly hovered: number | null;
  readonly pointer: readonly [number, number];
  readonly aspect: number;
  readonly menuDistance: number;
  readonly elapsed: Readonly<{ current: number }>;
  readonly departing: boolean;
}

/** Main-menu entities live in the same persistent scene as the board and the pull. */
export function GachaMenuCards(props: Props) {
  return <>{props.cards.map((card, index) => {
    const rect = props.rects[index];
    return rect ? <PreviewCard key={`${card.cardId}-${index}`} {...props} card={card} rect={rect} index={index} /> : null;
  })}</>;
}

function PreviewCard({ cards, card, rect, index, hovered, pointer, aspect, menuDistance, elapsed, departing }: Props & {
  readonly card: CardDefinition; readonly rect: PreviewRect; readonly index: number;
}) {
  const ref = useRef<Group>(null);
  const enlargement = useRef(1);
  const still = useSettingsStore((state) => state.reduceMotion);
  const [viewWidth, viewHeight] = backdropSize(menuDistance, 42, aspect);
  const frameWidth = Math.min(viewWidth, viewHeight * GACHA_MENU_WIDTH / GACHA_MENU_HEIGHT);
  const frameHeight = frameWidth * GACHA_MENU_HEIGHT / GACHA_MENU_WIDTH;
  const baseScale = rect.width * frameWidth / GACHA_MENU_WIDTH;
  const x = ((rect.x + rect.width / 2) / GACHA_MENU_WIDTH - 0.5) * frameWidth;
  const y = (0.5 - (rect.y + rect.height / 2) / GACHA_MENU_HEIGHT) * frameHeight;
  const selected = hovered === index && !departing;
  useFrame((_, delta) => {
    const group = ref.current;
    if (!group) return;
    const progress = departing ? Math.min(1, elapsed.current / UI_EXIT) : 0;
    group.visible = progress < 1;
    enlargement.current = still ? (selected ? 1.15 : 1) : damp(enlargement.current, selected ? 1.15 : 1, 14, delta);
    const z = selected ? (cards.length + 1) * 0.016 + 0.06 : index * 0.016;
    // Compensate depth so original design-space card positions and sizes remain proportional.
    const correction = (menuDistance - z) / menuDistance;
    group.scale.setScalar(baseScale * correction * enlargement.current * (1 - progress * 0.2));
    group.position.set(x * correction + progress * progress * frameWidth, y * correction + (selected ? 10 * frameHeight / GACHA_MENU_HEIGHT : 0), z);
    group.rotation.x = still ? 0 : damp(group.rotation.x, selected ? -pointer[1] * 0.12 : 0, 14, delta);
    group.rotation.y = still ? 0 : damp(group.rotation.y, selected ? pointer[0] * 0.16 : 0, 14, delta);
  });
  return <group ref={ref} position={[x, y, index * 0.016]} scale={baseScale}>
    <CardMesh card={card} position={[0, 0, 0]} rotationX={0} interactive={false}
      showStats={false} statLayout="hand" textureTier="detail" glow glowScale={selected ? 1.3 : 1} />
  </group>;
}
