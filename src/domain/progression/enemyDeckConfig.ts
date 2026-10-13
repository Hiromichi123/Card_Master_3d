import type { CardDefinition } from '../cards/types';
import { STANDARD_RARITIES } from '../cards/types';
import { createRng } from '../battle/rng';

export interface LadderEnemyPreset {
  readonly id: string; readonly name: string; readonly enabled: boolean;
  readonly minPoints: number; readonly maxPoints: number | null; readonly weight: number;
  readonly cardIds: readonly string[]; readonly replaceCount: number; readonly raritySteps: number;
}
export interface EnemyDeckConfig {
  readonly schemaVersion: 1;
  readonly campaign: Readonly<Record<string, readonly string[]>>;
  readonly ladderPresets: readonly LadderEnemyPreset[];
}
export interface GeneratedEnemyDeck {
  readonly presetId: string; readonly presetName: string; readonly cardIds: readonly string[];
  readonly changes: readonly { readonly slot: number; readonly from: string; readonly to: string }[];
}
export function cloneEnemyDeckConfig(config: EnemyDeckConfig): EnemyDeckConfig {
  return { schemaVersion: 1, campaign: Object.fromEntries(Object.entries(config.campaign).map(([id, cards]) => [id, [...cards]])),
    ladderPresets: config.ladderPresets.map(p => ({ ...p, cardIds: [...p.cardIds] })) };
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

export function parseEnemyDeckConfig(value: unknown, definitions: readonly CardDefinition[], stageIds: readonly string[]):
  { readonly ok: true; readonly config: EnemyDeckConfig } | { readonly ok: false; readonly message: string } {
  const reject = (message: string) => ({ ok: false as const, message });
  if (!record(value) || value.schemaVersion !== 1 || !record(value.campaign) || !Array.isArray(value.ladderPresets) || value.ladderPresets.length > 32) return reject('配置格式无效，需要schemaVersion 1、战役映射与最多32套天梯预设。');
  const cards = new Set(definitions.filter(c => c.status === 'complete').map(c => c.cardId)), stages = new Set(stageIds);
  const validDeck = (deck: unknown): deck is string[] => Array.isArray(deck) && deck.length >= 1 && deck.length <= 12 && deck.every(id => typeof id === 'string' && cards.has(id));
  const campaign: Record<string, readonly string[]> = {};
  for (const [id, deck] of Object.entries(value.campaign)) {
    if (!stages.has(id)) return reject(`未知战役关卡：${id}`);
    if (!validDeck(deck)) return reject(`${id}卡组需1–12张已完成卡牌，允许重复。`);
    campaign[id] = [...deck];
  }
  const presets: LadderEnemyPreset[] = [], ids = new Set<string>();
  for (const p of value.ladderPresets as unknown[]) {
    if (!record(p) || typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(p.id) || ids.has(p.id)
      || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 || typeof p.enabled !== 'boolean'
      || !integer(p.minPoints, 0, 1000000) || !(p.maxPoints === null || integer(p.maxPoints, p.minPoints, 1000000))
      || !integer(p.weight, 1, 100) || !integer(p.replaceCount, 0, 12) || !integer(p.raritySteps, 0, 3) || !validDeck(p.cardIds)) return reject('天梯预设无效：检查名称、唯一ID、积分区间、权重、卡组及浮动参数。');
    ids.add(p.id); presets.push({ id: p.id, name: p.name.trim(), enabled: p.enabled, minPoints: p.minPoints, maxPoints: p.maxPoints,
      weight: p.weight, cardIds: [...p.cardIds], replaceCount: p.replaceCount, raritySteps: p.raritySteps });
  }
  return { ok: true, config: { schemaVersion: 1, campaign, ladderPresets: presets } };
}

/** Explicit generation is also used by the editor; the authored preset never changes. */
export function generateFromEnemyPreset(preset: LadderEnemyPreset, definitions: readonly CardDefinition[], seed: number): GeneratedEnemyDeck {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('种子需0–4294967295之间的整数。');
  if (!integer(preset.replaceCount, 0, 12) || !integer(preset.raritySteps, 0, 3)) throw new Error('浮动替换数量或稀有度范围无效。');
  const byId = new Map(definitions.filter(c => c.status === 'complete').map(c => [c.cardId, c]));
  if (!preset.cardIds.length || preset.cardIds.length > 12 || preset.cardIds.some(id => !byId.has(id))) throw new Error('预设卡组需1–12张已完成卡牌。');
  const rng = createRng(seed), cardIds = [...preset.cardIds], changes: { slot: number; from: string; to: string }[] = [];
  const pool = [...byId.values()].sort((a, b) => a.cardId.localeCompare(b.cardId));
  const candidates = new Map<number, readonly CardDefinition[]>();
  for (let slot = 0; slot < cardIds.length; slot += 1) {
    const card = byId.get(cardIds[slot]!)!, rank = STANDARD_RARITIES.indexOf(card.rarity);
    // Event cards remain in their own event family; ordinary cards follow discrete rarity steps.
    candidates.set(slot, pool.filter(c => c.cardId !== card.cardId && (rank < 0 ? c.rarity === card.rarity
      : STANDARD_RARITIES.includes(c.rarity) && Math.abs(STANDARD_RARITIES.indexOf(c.rarity) - rank) <= preset.raritySteps)));
  }
  const slots = rng.shuffle([...candidates.keys()].filter(slot => candidates.get(slot)!.length > 0)).slice(0, preset.replaceCount);
  for (const slot of slots) {
    const from = cardIds[slot]!, to = rng.pick(candidates.get(slot)!).cardId;
    cardIds[slot] = to; changes.push({ slot, from, to });
  }
  return { presetId: preset.id, presetName: preset.name, cardIds, changes: changes.sort((a, b) => a.slot - b.slot) };
}

/** Ranked consumers choose only enabled presets covering the current points, then apply floating substitutions. */
export function generateConfiguredLadderEnemy(config: EnemyDeckConfig, definitions: readonly CardDefinition[], points: number, seed: number): GeneratedEnemyDeck {
  if (!integer(points, 0, 1000000) || !integer(seed, 0, 0xffffffff)) throw new Error('积分或种子超出有效整数范围。');
  const eligible = config.ladderPresets.filter(p => p.enabled && points >= p.minPoints && (p.maxPoints === null || points <= p.maxPoints));
  if (!eligible.length) throw new Error('当前积分没有已启用的天梯预设，请配置相应积分区间。');
  const rng = createRng(seed), total = eligible.reduce((n, p) => n + p.weight, 0);
  let ticket = rng.next() * total;
  const preset = eligible.find(p => { ticket -= p.weight; return ticket < 0; }) ?? eligible.at(-1)!;
  return generateFromEnemyPreset(preset, definitions, rng.int(0, 0xffffffff));
}
