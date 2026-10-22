import enemyConfig from '../../src/data/enemy-deck-config.json';
import { cardDatabase, stages } from '../../src/data';
import { parseEnemyDeckConfig } from '../../src/domain/progression/enemyDeckConfig';
import { campaignChapters } from '../../src/scenes/campaignFlow';
import { describe, expect, it } from 'vitest';
import { assetUrl, rebaseAssetTree } from '../../src/services/assetUrl';
import { canonicalJson } from '../../src/services/save/canonicalJson';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { planStageLaunch } from '../../src/domain/progression/campaign';

describe('static release contracts', () => {
  it('publishes valid enemy presets and playable enemy decks across all six chapters', () => {
    const stageIds = stages.chapters.flatMap(c => c.stages.map(s => s.id));
    const parsed = parseEnemyDeckConfig(enemyConfig, cardDatabase.definitions, stageIds);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.message);
    const published = campaignChapters(parsed.config.campaign).flatMap(c => c.stages);
    expect(published).toHaveLength(24);
    for (const stage of published) expect(stage.enemyDeck.length, stage.id).toBeGreaterThan(0);
    expect(parsed.config.ladderPresets).toHaveLength(3);
  });
  it('rebases local resource trees without corrupting external/blob URLs or mutating the original', () => {
    const source = { art: '/assets/card/c/001.webp', blob: 'blob:local', remote: 'https://example.com/a', items: ['/assets/bg/a.webp'] };
    const next = rebaseAssetTree(source, '/game/');
    expect(next.art).toBe('/game/assets/card/c/001.webp');
    expect(next.items[0]).toBe('/game/assets/bg/a.webp');
    expect(next.blob).toBe(source.blob); expect(next.remote).toBe(source.remote);
    expect(source.art).toBe('/assets/card/c/001.webp');
    expect(assetUrl('/assets/a', './')).toBe('./assets/a');
  });
  it('canonical save exports ignore object insertion order while retaining every value and array order', () => {
    const a = { inventory: { B: 1, A: 2 }, slots: ['B', 'A'] };
    const b = { slots: ['B', 'A'], inventory: { A: 2, B: 1 } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(JSON.parse(canonicalJson(a))).toEqual(a);
    expect(canonicalJson(a)).not.toBe(canonicalJson({ ...b, slots: ['A', 'B'] }));
  });
  it('cannot start or earn a battle reward from an unconfigured enemy deck', () => {
    const profile = createInitialProfile({ contentVersion: 'test', dayKey: '20261022', starterCardIds: [], now: new Date('2026-10-22T00:00:00Z') });
    expect(planStageLaunch({ profile, stageId: '4-1', chapterId: '4', stageName: 'Pending stage', playerDeck: ['D_001'], enemyDeck: [], rewardSpec: null, launchSeq: 1 }))
      .toMatchObject({ rejected: '这一关没有配置敌方牌组' });
  });
});
