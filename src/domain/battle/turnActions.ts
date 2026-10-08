import type { CardDefinition, SideId } from '../cards/types';
import type { BattleState } from './types';

export const COOLDOWN_CARD_ID = '@battle/cooldown';
/** A battle-only resource: never enters collections, decks, or the discard pile. */
export const COOLDOWN_CARD: CardDefinition = {
  cardId: COOLDOWN_CARD_ID, rarity: 'S', name: '冷却牌', level: 3,
  atk: 0, hp: 0, cd: 0, rawTraits: [], skills: [], status: 'complete',
  description: '消耗此牌：指定己方等待区的一张卡，冷却减少 1。最低为 0，不占普通出牌额度。',
  art: { artId: 'battle/cooldown', sourcePresent: false },
};
export const isCooldownCard = (definitionId: string): boolean => definitionId === COOLDOWN_CARD_ID;

/** currentSide always remains the host; response input belongs to the guest. */
export function inputSideOf(state: BattleState): SideId {
  return state.phase === 'awaitingResponse'
    ? (state.currentSide === 'player' ? 'enemy' : 'player') : state.currentSide;
}
export function readyCardIds(state: BattleState, side: SideId): string[] {
  return state.zones[side].prep.filter((id): id is string =>
    id !== null && (state.instances[id]?.cd ?? 1) <= 0);
}
export function insertionSlots(state: BattleState, side: SideId): number[] {
  const count = state.zones[side].battle.filter(Boolean).length;
  return count < state.rules.battleSlots ? Array.from({ length: count + 1 }, (_, i) => i) : [];
}
