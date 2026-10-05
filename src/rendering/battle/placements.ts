/**
 * 把显示状态铺到桌面上。
 *
 * 这是「规则数据 → 世界坐标」的唯一一处翻译，P1 的 `demoArrangement`
 * 就是它的前身（那个文件在 P3 落地后删除）。
 *
 * 不 import React——纯映射，出参直接喂给 `BattleBoard` 的 `placements`。
 */

import { cardById } from '../../data';
import type { CardDefinition, SideId } from '../../domain/cards/types';
import type { DisplayState } from '../presentation/displayState';
import { statsOf } from '../presentation/displayState';
import type { CardPlacement } from './BattleBoard';
import {
  BATTLE_CARD_SCALE,
  BATTLE_SLOT_COUNT,
  CARD_FLAT_ROTATION_X,
  HAND_CARD_SCALE,
  PILE_CARD_SCALE,
  PREP_CARD_SCALE,
  PREP_SLOT_COUNT,
  buildSlots,
  handCardTransform,
  pilePosition,
  type SlotZone,
} from './layout';
import { slotKey } from './SlotMarkers';

/**
 * 每侧下标 → `buildSlots()` 的全局下标。
 *
 * `SlotMarkers.slotKey()` 用的是全局下标，而引擎的 `prep`/`battle` 数组是每侧的，
 * 两者混用会让高亮亮在别人的槽上。`buildSlots()` 的顺序写死在这里一次：
 * 玩家战斗区(5) → 敌方战斗区(5) → 玩家准备区(8) → 敌方准备区(8)。
 */
export function globalSlotIndex(
  side: SideId,
  zone: SlotZone,
  perSideIndex: number,
): number {
  const base =
    zone === 'battle'
      ? side === 'player'
        ? 0
        : BATTLE_SLOT_COUNT
      : side === 'player'
        ? BATTLE_SLOT_COUNT * 2
        : BATTLE_SLOT_COUNT * 2 + PREP_SLOT_COUNT;
  return base + perSideIndex;
}

/** 每侧下标对应的槽位键，供 `placeable` / `targeted` 集合使用。 */
export function slotKeyFor(side: SideId, zone: SlotZone, perSideIndex: number): string {
  return slotKey(side, zone, globalSlotIndex(side, zone, perSideIndex));
}

/** 槽位中心的世界坐标。`slotIndex` 是**每侧**的下标。 */
export function slotPosition(
  side: SideId,
  zone: SlotZone,
  slotIndex: number,
): readonly [number, number, number] {
  const global = globalSlotIndex(side, zone, slotIndex);
  const slot = buildSlots()[global];
  return slot ? slot.position : [0, 0, 0];
}

/**
 * 手牌位在世界里的坐标。
 *
 * 演出层要拿它当「出牌」这一下的起手点，所以单独开一个只给点的版本——
 * 牌是斜着立起来的，但弹体从哪个位置发出只关心中心点。
 */
export function handPointOf(
  index: number,
  total: number,
  side: SideId,
): readonly [number, number, number] {
  return handCardTransform(index, total, side).position;
}

/** 一个牌堆 / 弃牌堆在桌上的表示。 */
export interface PileView {
  readonly side: SideId;
  readonly kind: 'deck' | 'discard';
  /** 牌堆是盖着的；弃牌堆画最上面那张明牌。 */
  readonly topCard: CardDefinition | null;
  readonly count: number;
}

export interface BoardView {
  readonly entries: readonly CardPlacement[];
  readonly placeable: ReadonlySet<string>;
  readonly targeted: ReadonlySet<string>;
  readonly piles: readonly PileView[];
}

export interface BuildBoardOptions {
  /** 当前选中的卡（`instanceId`）。 */
  readonly selectedInstanceId?: string | null | undefined;
  /** 现在能不能出牌：决定手牌是否可点。 */
  readonly playerCanPlay?: boolean | undefined;
  /** 选中手牌后，可放置的准备槽。 */
  readonly placeablePrepSlots?: readonly number[] | undefined;
}

const SIDES: readonly SideId[] = ['player', 'enemy'];

export function buildBoard(display: DisplayState, options: BuildBoardOptions = {}): BoardView {
  const entries: CardPlacement[] = [];

  for (const side of SIDES) {
    const zones = display.zones[side];

    zones.battle.forEach((instanceId, index) => {
      if (!instanceId) {
        return;
      }
      const placement = makePlacement(
        display,
        instanceId,
        slotPosition(side, 'battle', index),
        undefined,
        undefined,
        BATTLE_CARD_SCALE,
        false,
      );
      if (placement) {
        entries.push(placement);
      }
    });

    zones.prep.forEach((instanceId, index) => {
      if (!instanceId) {
        return;
      }
      const placement = makePlacement(
        display,
        instanceId,
        slotPosition(side, 'prep', index),
        undefined,
        undefined,
        PREP_CARD_SCALE,
        false,
      );
      if (placement) {
        entries.push(placement);
      }
    });

    zones.hand.forEach((instanceId, index) => {
      const hand = handCardTransform(index, zones.hand.length, side);
      const placement = makePlacement(
        display,
        instanceId,
        hand.position,
        hand.rotationY,
        hand.rotationX,
        HAND_CARD_SCALE,
        side === 'enemy',
        side === 'player' && options.playerCanPlay === true,
      );
      if (placement) {
        entries.push(placement);
      }
    });
  }

  const placeable = new Set<string>();
  for (const index of options.placeablePrepSlots ?? []) {
    placeable.add(slotKeyFor('player', 'prep', index));
  }

  return {
    entries,
    placeable,
    targeted: new Set<string>(),
    piles: buildPiles(display),
  };
}

/** 双方的牌堆与弃牌堆。牌堆盖着，弃牌堆露出最上面那张。 */
function buildPiles(display: DisplayState): PileView[] {
  const piles: PileView[] = [];
  for (const side of SIDES) {
    const zones = display.zones[side];
    const topId = zones.discard[zones.discard.length - 1];
    const topIdentity = topId ? display.instances[topId] : undefined;
    const topCard = topIdentity ? (cardById.get(topIdentity.definitionId) ?? null) : null;

    piles.push(
      { side, kind: 'deck', topCard: null, count: zones.deckCount },
      { side, kind: 'discard', topCard, count: zones.discard.length },
    );
  }
  return piles;
}

/** 牌堆/弃牌堆的位置与缩放。 */
export function pilePlacement(pile: PileView): {
  position: readonly [number, number, number];
  scale: number;
} {
  return { position: pilePosition(pile.side, pile.kind), scale: PILE_CARD_SCALE };
}

function makePlacement(
  display: DisplayState,
  instanceId: string,
  position: readonly [number, number, number],
  rotationY: number | undefined,
  rotationX: number | undefined,
  scale: number,
  faceDown: boolean,
  interactive = false,
): CardPlacement | null {
  const identity = display.instances[instanceId];
  if (!identity) {
    return null;
  }
  const card: CardDefinition | undefined = cardById.get(identity.definitionId);
  if (!card) {
    return null;
  }
  const stats = statsOf(display, instanceId);
  const emphasised = display.emphasised[instanceId];

  return {
    instanceId,
    card,
    position,
    rotationY: rotationY ?? undefined,
    rotationX: rotationX ?? CARD_FLAT_ROTATION_X,
    faceDown,
    interactive,
    scale,
    stats: stats ?? undefined,
    emphasisedStats: emphasised,
  };
}
