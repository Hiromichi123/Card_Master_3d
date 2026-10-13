import { describe, expect, it } from 'vitest';
import { cardDatabase } from '../../src/data';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { normalizeProfile } from '../../src/domain/progression/saveTransfer';
import { migrateToCurrent } from '../../src/domain/progression/migrations';
import { SAVE_SCHEMA_VERSION } from '../../src/domain/progression/types';
import type { ProfileState } from '../../src/domain/progression/types';
import { emptyAbyssState, abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import { validateAbyssState } from '../../src/domain/progression/abyssValidation';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';

const now = new Date('2026-10-11T10:00:00Z');
const ctx = { contentVersion: cardDatabase.contentVersion, dayKey: '20261011', now, knownCardIds: new Set(cardDatabase.definitions.map(card => card.cardId)) };
const fresh = () => createInitialProfile({ ...ctx, starterCardIds: ['D_002'] });
function draft(): ProfileState {
  const profile = fresh();
  const planned = planAbyssAction(profile, { kind: 'start', expectedToken: abyssStateToken(profile) }, now);
  if ('rejected' in planned) throw new Error(planned.rejected);
  return applyEconomyTransaction(profile, planned.transaction).profile;
}

describe('schema6深渊存档', () => {
  it('新档空深渊，v5迁移不改变天梯/迷宫/主资源', () => {
    const current = fresh();
    expect(SAVE_SCHEMA_VERSION).toBe(8);
    expect(current.abyss).toEqual(emptyAbyssState());
    const old = { ...current, schemaVersion: 5, abyss: undefined, ladder: { ...current.ladder, points: 2400, claimedTierFloors: [0, 300] } };
    const migrated = migrateToCurrent(old, 5);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value).toEqual({ ...old, schemaVersion: SAVE_SCHEMA_VERSION, abyss: emptyAbyssState() });
    expect(migrated.warnings).toEqual(['已从 v5 迁移到 v6。', '已从 v6 迁移到 v7。', '已从 v7 迁移到 v8。']);
  });

  it('v1到v5完整爬链，导出导入保留固定起始候选', () => {
    for (let version = 1; version <= 5; version += 1) {
      const normalized = normalizeProfile({ ...fresh(), schemaVersion: version, abyss: undefined }, ctx);
      expect(normalized.ok).toBe(true);
      if (normalized.ok) expect(normalized.profile.abyss).toEqual(emptyAbyssState());
    }
    const profile = draft();
    const restored = normalizeProfile(JSON.parse(JSON.stringify(profile)), ctx);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.profile.abyss).toEqual(profile.abyss);
    expect(validateAbyssState(profile.abyss)).toBe(true);
  });

  it('新版缺深渊不能静默补空，规则/内容不兼容拒绝', () => {
    const profile = draft();
    const run = profile.abyss.run!;
    for (const abyss of [undefined, null, { ...profile.abyss, revision: -1 }, { ...profile.abyss, run: { ...run, rulesVersion: 2 } }, { ...profile.abyss, run: { ...run, contentVersion: 'future' } }]) {
      expect(normalizeProfile({ ...profile, abyss }, ctx).ok).toBe(false);
    }
  });

  it('重复实例/非法属性/非法traits/超长历史拒绝，不能刷新换新候选', () => {
    const profile = draft();
    const run = profile.abyss.run!;
    if (run.stage.kind !== 'starterDraft') throw new Error('not draft');
    const first = run.stage.choices[0]!;
    const card = first.cards[0]!;
    const cases = [
      [card, card, ...first.cards.slice(2)],
      [{ ...card, definition: { ...card.definition, atk: NaN } }, ...first.cards.slice(1)],
      [{ ...card, definition: { ...card.definition, hp: 0 } }, ...first.cards.slice(1)],
      [{ ...card, definition: { ...card.definition, skills: [{ raw: '无效', family: 'unknown', param: 1, resolution: 'implemented' }], rawTraits: ['无效'] } }, ...first.cards.slice(1)],
    ];
    for (const cards of cases) {
      const invalid = { ...profile.abyss, run: { ...run, stage: { ...run.stage, choices: [{ ...first, cards }, ...run.stage.choices.slice(1)] } } };
      expect(validateAbyssState(invalid)).toBe(false);
    }
    expect(validateAbyssState({ ...profile.abyss, history: Array.from({ length: 11 }, () => ({})) })).toBe(false);
    expect(validateAbyssState({ ...profile.abyss, knownEffectIds: ['unknown'] })).toBe(false);
  });
});
