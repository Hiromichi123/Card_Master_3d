import { describe, expect, it } from 'vitest';
import { cardById, cardDatabase, fusionSpec } from '../../src/data';
import { createRng } from '../../src/domain/battle/rng';
import { fusionRaritySlots, planFusion } from '../../src/domain/progression/fusion';
import { buildCardPool, probabilityRows } from '../../src/domain/progression/gacha';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { isRejection } from '../../src/domain/progression/plan';
import { ProfileStore } from '../../src/state/createProfileStore';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import { FailingSaveRepository } from '../../src/services/save/FailingSaveRepository';
import type { SaveRepository } from '../../src/services/save/SaveRepository';
import { fusionMaterialPose, fusionResultPose, fusionSlotPosition, FUSION_SECONDS } from '../../src/rendering/fusion/motion';

const pool = buildCardPool(cardDatabase.definitions);
const material = pool.get('D')![0]!;
const materials = Array.from({ length: 5 }, () => material);
const profile = (copies = 5) => createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261006',
  now: new Date('2026-10-06T00:00:00Z'), starterCardIds: [], ownedCardIds: Array.from({ length: copies }, () => material) });
const args = () => ({ profile: profile(), materials, definitions: cardById, pool, spec: fusionSpec, rng: createRng(31), operationId: 'fusion-1' });

describe('bounded five-card fusion rules', () => {
  it('limits low-tier materials to nearby rarities and uses the displayed normalized odds for drawing', () => {
    const slots = fusionRaritySlots(materials, cardById, pool, fusionSpec);
    expect(slots.find((slot) => slot.rarity === 'D')!.weight).toBeCloseTo(5);
    expect(slots.find((slot) => slot.rarity === 'C')!.weight).toBeCloseTo(1.75);
    expect(slots.map((slot) => slot.rarity)).toEqual(['C+', 'C', 'D']);
    expect(slots.find((slot) => slot.rarity === 'C+')!.weight).toBeCloseTo(.875);
    const rows = probabilityRows(slots);
    expect(rows.reduce((sum, row) => sum + row.percent, 0)).toBeCloseTo(100);
    const total = slots.reduce((sum, slot) => sum + slot.weight, 0);
    expect(rows.find((row) => row.rarity === 'D')!.percent).toBeCloseTo(5 / total * 100);
  });

  it('rejects a pool containing only far higher tiers without consuming randomness or materials', () => {
    const rng = createRng(31);
    const plan = planFusion({ ...args(), rng, pool: new Map([['SSS', pool.get('SSS')!]]) });
    expect(isRejection(plan)).toBe(true);
    expect(rng.snapshot().draws).toBe(0);
  });

  it('combines consumption and same-card output into one delta without adding a currency cost', () => {
    const plan = planFusion({ ...args(), pool: new Map([['D', [material]]]) });
    expect(isRejection(plan)).toBe(false);
    if (isRejection(plan)) throw new Error(plan.rejected);
    expect(plan.view.cardId).toBe(material);
    expect(plan.transaction.inventoryDelta[material]).toBe(-4);
    const outcome = applyEconomyTransaction(profile(), plan.transaction);
    expect(outcome.applied).toBe(true);
    expect(outcome.profile.inventory[material]).toBe(1);
    expect(outcome.profile.currencies).toEqual(profile().currencies);
  });

  it('validates five gross copies before reward netting and rejects incomplete or empty material sets', () => {
    const rng = createRng(31);
    expect(isRejection(planFusion({ ...args(), profile: profile(4), pool: new Map([['D', [material]]]), rng }))).toBe(true);
    expect(rng.snapshot().draws).toBe(0);
    expect(isRejection(planFusion({ ...args(), materials: materials.slice(0, 4) }))).toBe(true);
    expect(isRejection(planFusion({ ...args(), materials: ['missing', ...materials.slice(1)] }))).toBe(true);
  });

  it('excludes empty output tiers, rejects no output, and produces the same result for the same seed', () => {
    const slots = fusionRaritySlots(materials, cardById, new Map([['D', [material]]]), fusionSpec);
    expect(probabilityRows(slots)).toEqual([{ rarity: 'D', weight: 5, percent: 100 }]);
    expect(isRejection(planFusion({ ...args(), pool: new Map() }))).toBe(true);
    expect(planFusion(args())).toEqual(planFusion(args()));
  });
});

async function storeFor(repository: SaveRepository): Promise<ProfileStore> {
  const store = new ProfileStore({ repository, clock: () => new Date('2026-10-06T00:00:00Z'), seedSource: () => 31,
    contentVersion: cardDatabase.contentVersion, starterCardIds: [] });
  await store.load(); return store;
}

describe('fusion transaction persistence', () => {
  it('commits five consumed and one obtained in a single write, persists after reload and rejects a duplicate operation', async () => {
    const repository = new MemorySaveRepository(profile());
    const store = await storeFor(repository);
    const plan = (current: ReturnType<typeof profile>) => planFusion({ ...args(), profile: current });
    const outcome = await store.commitEconomic(plan);
    expect(outcome.ok).toBe(true); expect(repository.commitCount).toBe(1);
    expect(Object.values(repository.peek()!.inventory).reduce((sum, count) => sum + count, 0)).toBe(1);
    expect((await store.commitEconomic(plan)).ok).toBe(false);
    expect(repository.commitCount).toBe(1);
    store.dispose();
    const reloaded = await storeFor(repository);
    expect(reloaded.getSnapshot().profile!.inventory).toEqual(repository.peek()!.inventory);
    reloaded.dispose();
  });

  it('leaves all five materials and the entire profile unchanged when saving fails', async () => {
    const inner = new MemorySaveRepository(profile());
    const store = await storeFor(new FailingSaveRepository(inner));
    const before = store.getSnapshot().profile;
    const outcome = await store.commitEconomic((current) => planFusion({ ...args(), profile: current }));
    expect(outcome.ok).toBe(false); expect(store.getSnapshot().profile).toBe(before);
    expect(inner.peek()!.inventory[material]).toBe(5); expect(inner.commitCount).toBe(0);
    store.dispose();
  });
});

it('keeps five distinct altar slots, converges the materials and finishes with a front-facing entity', () => {
  const slots = Array.from({ length: 5 }, (_, i) => fusionSlotPosition(i));
  expect(new Set(slots.map((slot) => `${slot[0]},${slot[1]}`)).size).toBe(5);
  for (let i = 0; i < 5; i++) {
    expect(fusionMaterialPose(i, 0).visible).toBe(true);
    expect(fusionMaterialPose(i, 0.9).visible).toBe(false);
  }
  expect(fusionResultPose(0.9).visible).toBe(false);
  expect(fusionResultPose(FUSION_SECONDS)).toMatchObject({ visible: true, rotationY: 0, scale: 1.28 });
});
