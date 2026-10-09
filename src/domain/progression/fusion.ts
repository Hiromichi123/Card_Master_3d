import type { CardDefinition, CardRarity } from '../cards/types';
import type { Rng } from '../battle/rng';
import { reject, type Planned } from './plan';
import { pullOne, type CardPoolIndex, type RaritySlot } from './gacha';
import type { ProfileState } from './types';

export interface FusionSpec {
  readonly altarSlots: number;
  /** Retained for data compatibility; no global weights are granted. */
  readonly baseWeight: number;
  readonly sameRarityBonus: number;
  readonly rarerNeighborBonus: number;
  readonly commonNeighborBonus: number;
  readonly currencyCost: number;
  readonly rarityOrder: readonly CardRarity[];
}

export interface FusionResult {
  readonly operationId: string;
  readonly materials: readonly string[];
  readonly cardId: string;
  readonly rarity: CardRarity;
  readonly rngState: number;
}

export function fusionMaterialCounts(materials: readonly (string | null)[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of materials) if (id) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

/** Only each material's own tier and two tiers on each side may contribute; preview and draw share the same weights. */
export function fusionRaritySlots(materials: readonly string[], definitions: ReadonlyMap<string, CardDefinition>, pool: CardPoolIndex, spec: FusionSpec): readonly RaritySlot[] {
  if (!materials.length) return [];
  const weights = new Map<CardRarity, number>();
  const add = (rarity: CardRarity | undefined, amount: number): void => {
    if (rarity) weights.set(rarity, (weights.get(rarity) ?? 0) + amount);
  };
  for (const id of materials) {
    const card = definitions.get(id);
    if (!card || card.status !== 'complete') return [];
    const index = spec.rarityOrder.indexOf(card.rarity);
    if (index < 0) return [];
    add(card.rarity, spec.sameRarityBonus);
    for (let distance = 1; distance <= 2; distance++) {
      add(spec.rarityOrder[index - distance], spec.rarerNeighborBonus / distance);
      add(spec.rarityOrder[index + distance], spec.commonNeighborBonus / distance);
    }
  }
  return spec.rarityOrder.flatMap((rarity) => {
    const weight = weights.get(rarity) ?? 0;
    return weight > 0 && (pool.get(rarity)?.length ?? 0) > 0 ? [{ rarity, weight }] : [];
  });
}

export function planFusion(args: {
  readonly profile: ProfileState;
  readonly materials: readonly string[];
  readonly definitions: ReadonlyMap<string, CardDefinition>;
  readonly pool: CardPoolIndex;
  readonly spec: FusionSpec;
  readonly rng: Rng;
  readonly operationId: string;
}): Planned<FusionResult> {
  const { profile, materials, definitions, pool, spec, rng, operationId } = args;
  if (materials.length !== spec.altarSlots) return reject(`需要 ${spec.altarSlots} 张卡牌才能融合`);
  const counts = fusionMaterialCounts(materials);
  // Validate gross consumption before adding the reward, including same-card rewards.
  for (const [id, count] of Object.entries(counts)) {
    const card = definitions.get(id);
    if (!card || card.status !== 'complete' || !spec.rarityOrder.includes(card.rarity)) return reject('材料包含不可融合的卡牌');
    if ((profile.inventory[id] ?? 0) < count) return reject('材料数量不足，请重新选择');
  }
  if (profile.currencies.gold < spec.currencyCost) return reject('金币不足');
  const slots = fusionRaritySlots(materials, definitions, pool, spec);
  if (!slots.length) return reject('当前没有可产出的卡牌，材料不会被消耗');
  const drawn = pullOne(rng, slots, pool);
  const resultCard = definitions.get(drawn.cardId);
  if (!resultCard || resultCard.status !== 'complete' || resultCard.rarity !== drawn.rarity) return reject('无法获得有效卡牌，材料不会被消耗');
  const inventoryDelta: Record<string, number> = {};
  for (const [id, count] of Object.entries(counts)) inventoryDelta[id] = -count;
  inventoryDelta[drawn.cardId] = (inventoryDelta[drawn.cardId] ?? 0) + 1;
  return {
    transaction: { operationId, currencyDelta: { gold: -spec.currencyCost }, inventoryDelta },
    view: { operationId, materials: [...materials], cardId: drawn.cardId, rarity: drawn.rarity, rngState: rng.snapshot().state },
  };
}
