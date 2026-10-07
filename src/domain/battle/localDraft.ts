import type { BattleConfig } from '../battle/types';
import { createRng } from '../battle/rng';
import { RARITY_TO_LEVEL, type CardDefinition, type SideId } from '../cards/types';

export const DRAFT_POOL_SIZE = 28;
export const DRAFT_DECK_SIZE = 12;
export const DRAFT_ROW_COUNTS = [9, 10, 9] as const;

// Original utils/draft_manager.py: each ordinary rarity weighs 8; #elna weighs 4.
const WEIGHTS: Readonly<Record<string, number>> = {
  SSS: 8, 'SS+': 8, SS: 8, 'S+': 8, S: 8, 'A+': 8, A: 8,
  'B+': 8, B: 8, 'C+': 8, C: 8, D: 8, '#elna': 4,
};

export interface LocalDraft {
  readonly seed: number;
  readonly pool: readonly string[];
  readonly owners: Readonly<Record<string, SideId>>;
  readonly decks: Readonly<Record<SideId, readonly string[]>>;
  readonly currentSide: SideId;
}

/** Weighted rarity choice followed by uniform card choice, without replacement. */
export function createLocalDraft(definitions: readonly CardDefinition[], seed: number): LocalDraft {
  const rng = createRng(seed);
  const bins = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const card of definitions) {
    if (card.status !== 'complete' || !card.art.sourcePresent || !WEIGHTS[card.rarity] || seen.has(card.cardId)) continue;
    seen.add(card.cardId);
    const bin = bins.get(card.rarity) ?? [];
    bin.push(card.cardId);
    bins.set(card.rarity, bin);
  }
  if (seen.size < DRAFT_POOL_SIZE) throw new Error('完整卡牌不足 28 张，无法开始本地选卡。');
  const pool: string[] = [];
  while (pool.length < DRAFT_POOL_SIZE) {
    const entries = [...bins.entries()].filter(([, cards]) => cards.length > 0);
    let roll = rng.next() * entries.reduce((sum, [rarity]) => sum + (WEIGHTS[rarity] ?? 0), 0);
    let chosen = entries[entries.length - 1]!;
    for (const entry of entries) {
      roll -= WEIGHTS[entry[0]] ?? 0;
      if (roll < 0) { chosen = entry; break; }
    }
    const index = rng.int(0, chosen[1].length - 1);
    pool.push(chosen[1].splice(index, 1)[0]!);
  }
  return { seed, pool, owners: {}, decks: { player: [], enemy: [] }, currentSide: 'player' };
}

export function draftComplete(draft: LocalDraft): boolean {
  return draft.decks.player.length === DRAFT_DECK_SIZE && draft.decks.enemy.length === DRAFT_DECK_SIZE;
}

export function pickLocalDraft(draft: LocalDraft, cardId: string): LocalDraft {
  const side = draft.currentSide;
  if (draftComplete(draft) || !draft.pool.includes(cardId) || draft.owners[cardId] || draft.decks[side].length >= DRAFT_DECK_SIZE) return draft;
  return {
    ...draft,
    owners: { ...draft.owners, [cardId]: side },
    decks: { ...draft.decks, [side]: [...draft.decks[side], cardId] },
    currentSide: side === 'player' ? 'enemy' : 'player',
  };
}

/** Like the original upper AI: prefer the rarest available card, then pool order. */
export function chooseDraftCard(draft: LocalDraft, definitions: ReadonlyMap<string, CardDefinition>): string | null {
  let chosen: string | null = null;
  let best = Infinity;
  for (const cardId of draft.pool) {
    if (draft.owners[cardId]) continue;
    const card = definitions.get(cardId);
    if (!card) continue;
    const rank = RARITY_TO_LEVEL[card.rarity];
    if (rank < best) { chosen = cardId; best = rank; }
  }
  return chosen;
}

export function draftBattleConfig(draft: LocalDraft): BattleConfig {
  if (!draftComplete(draft)) throw new Error('双方必须各选满 12 张卡牌。');
  return {
    seed: (draft.seed ^ 0x3dca12) >>> 0,
    playerDeck: draft.decks.player,
    enemyDeck: draft.decks.enemy,
    label: '本地选卡对战',
  };
}
