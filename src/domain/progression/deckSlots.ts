import { LADDER_TIERS } from './ladder';
import type { Deck, ProfileState } from './types';

export type NormalDeckIds = readonly [string, string, string];
export interface LadderState {
  readonly points: number;
  readonly deckId: string;
  /** 已领取的一次性段位奖励；降段不清除。 */
  readonly claimedTierFloors: readonly number[];
}

/** 只补槽位，不改旧牌组、库存或普通出战选择；固定时间使旧档迁移可重放。 */
export function initializeDeckSlots(decks: readonly Deck[], activeDeckId: string | null): {
  decks: readonly Deck[]; normalDeckIds: NormalDeckIds; ladder: LadderState;
} {
  const result = [...decks];
  const occupied = new Set(decks.map(deck => deck.id));
  const uniqueId = (base: string): string => {
    let id = base;
    for (let suffix = 2; occupied.has(id); suffix += 1) id = `${base}-${suffix}`;
    occupied.add(id);
    return id;
  };
  const active = decks.find(deck => deck.id === activeDeckId);
  const candidates = [...new Set([...(active ? [active.id] : []), ...decks.map(deck => deck.id)])];
  const normal = candidates.slice(0, 3);
  while (normal.length < 3) {
    const index = normal.length + 1;
    const id = uniqueId(`normal-${index}`);
    result.push({ id, name: `卡组${index}`, cardIds: [], updatedAt: '1970-01-01T00:00:00.000Z' });
    normal.push(id);
  }
  const deckId = uniqueId('ladder');
  result.push({
    id: deckId, name: '天梯赛卡组', cardIds: [...(active?.cardIds ?? [])],
    updatedAt: active?.updatedAt ?? '1970-01-01T00:00:00.000Z',
  });
  return { decks: result, normalDeckIds: [normal[0]!, normal[1]!, normal[2]!], ladder: { points: 0, deckId, claimedTierFloors: [] } };
}

export function ladderDeckOf(profile: ProfileState): Deck | null {
  return profile.decks.find(deck => deck.id === profile.ladder.deckId) ?? null;
}

export function isFixedDeck(profile: ProfileState, deckId: string): boolean {
  return profile.normalDeckIds.includes(deckId) || profile.ladder.deckId === deckId;
}

/** 槽位引用及v5领奖账本异常不能伪装成旧档缺省后再生成一套。 */
export function validDeckSlots(
  decks: readonly Deck[], normalDeckIds: unknown, ladder: unknown, activeDeckId: string | null,
): boolean {
  const ids = new Set(decks.map(deck => deck.id));
  if (ids.size !== decks.length || decks.some(deck => !deck.id)
    || !Array.isArray(normalDeckIds) || normalDeckIds.length !== 3
    || normalDeckIds.some(id => typeof id !== 'string' || !ids.has(id))
    || new Set(normalDeckIds).size !== 3
    || !ladder || typeof ladder !== 'object' || Array.isArray(ladder)) return false;
  const value = ladder as Record<string, unknown>;
  return typeof value.deckId === 'string' && ids.has(value.deckId) && !normalDeckIds.includes(value.deckId)
    && typeof value.points === 'number' && Number.isSafeInteger(value.points) && value.points >= 0
    && Array.isArray(value.claimedTierFloors)
    && new Set(value.claimedTierFloors).size === value.claimedTierFloors.length
    && [...value.claimedTierFloors].every(floor => LADDER_TIERS.some(tier => tier.floor === floor))
    && (activeDeckId === null || (ids.has(activeDeckId) && activeDeckId !== value.deckId));
}

export function migrateDeckSlots(value: Record<string, unknown>): Record<string, unknown> {
  const rawDecks = Array.isArray(value.decks) ? value.decks : [];
  const decks = rawDecks.filter((entry): entry is Deck =>
    typeof entry === 'object' && entry !== null && typeof (entry as Deck).id === 'string',
  ).map(deck => ({
    ...deck, cardIds: Array.isArray(deck.cardIds) ? deck.cardIds : [],
    updatedAt: typeof deck.updatedAt === 'string' ? deck.updatedAt : '1970-01-01T00:00:00.000Z',
  }));
  const active = typeof value.activeDeckId === 'string' ? value.activeDeckId : null;
  const slots = initializeDeckSlots(decks, active);
  return { ...value, schemaVersion: 4, ...slots, decks: [...rawDecks, ...slots.decks.slice(decks.length)] };
}
