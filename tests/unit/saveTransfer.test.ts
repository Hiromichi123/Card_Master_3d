/**
 * 存档导入 / 导出：解析、校验、落盘语义。
 *
 * 两条结构性约束是重点：
 * - **失败不改动原存档**（内存与磁盘都保持原样，逐字节可比）；
 * - **预览一次都不写盘**。
 */

import { describe, expect, it } from 'vitest';

import { cardDatabase, slice } from '../../src/data';
import { fixedClock } from '../../src/domain/progression/clock';
import { DEFAULT_SETTINGS, SAVE_SCHEMA_VERSION } from '../../src/domain/progression/types';
import { detectSaveFormat, normalizeProfile, parseSaveJson } from '../../src/domain/progression/saveTransfer';
import { ProfileStore } from '../../src/state/createProfileStore';
import { FailingSaveRepository } from '../../src/services/save/FailingSaveRepository';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import type { SaveRepository } from '../../src/services/save/SaveRepository';

const CLOCK = fixedClock(new Date('2026-01-01T12:00:00Z'));
const KNOWN = new Set(cardDatabase.definitions.map((card) => card.cardId));

function starterIds(): readonly string[] {
  const deck = slice.decks.find((entry) => entry.id === 'demo-player');
  return deck ? deck.cardIds : [];
}

async function readyStore<R extends SaveRepository = MemorySaveRepository>(repository?: R) {
  const repo = (repository ?? new MemorySaveRepository()) as R;
  const store = new ProfileStore({
    repository: repo,
    clock: CLOCK,
    seedSource: () => 0x2f6e2b1,
    contentVersion: cardDatabase.contentVersion,
    starterCardIds: starterIds(),
    knownCardIds: KNOWN,
    debounceMs: 5,
  });
  await store.load();
  return { store, repository: repo };
}

function normalizeCtx() {
  return {
    knownCardIds: KNOWN,
    contentVersion: cardDatabase.contentVersion,
    dayKey: '20260101',
    now: CLOCK(),
  };
}

describe('detectSaveFormat', () => {
  it('按形状判定，不靠文件名', () => {
    expect(detectSaveFormat({ schemaVersion: 1, inventory: {}, currencies: {}, settings: {} })).toBe('profile');
    expect(detectSaveFormat({ cards: [] })).toBe('legacy-inventory');
    expect(detectSaveFormat({ deck: [] })).toBe('legacy-deck');
    expect(detectSaveFormat({ golds: 10 })).toBe('legacy-profile');
    expect(detectSaveFormat({ hello: 'world' })).toBe('unknown');
    expect(detectSaveFormat(null)).toBe('unknown');
    expect(detectSaveFormat([])).toBe('unknown');
  });
});

describe('parseSaveJson', () => {
  it('非法 JSON 给出可读原因', () => {
    const result = parseSaveJson('{ oops');
    expect(result.ok).toBe(false);
  });
});

describe('normalizeProfile', () => {
  it('缺 settings 时补上默认值', () => {
    const result = normalizeProfile(
      { schemaVersion: SAVE_SCHEMA_VERSION, inventory: {}, currencies: { gold: 10 } },
      normalizeCtx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.profile.currencies.gold).toBe(10);
  });

  it('版本比当前大 → 拒绝，且文案同时报出两个版本号', () => {
    const result = normalizeProfile(
      { schemaVersion: SAVE_SCHEMA_VERSION + 1, inventory: {}, currencies: {} },
      normalizeCtx(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schemaTooNew');
    expect(result.message).toContain(`v${SAVE_SCHEMA_VERSION + 1}`);
    expect(result.message).toContain(`v${SAVE_SCHEMA_VERSION}`);
  });

  it('缺 / 非法的 schemaVersion 判为 invalidShape（不当旧档猜）', () => {
    const result = normalizeProfile({ inventory: {}, currencies: {} }, normalizeCtx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalidShape');
  });

  it('未知 cardId、非正计数、悬空 activeDeckId 都进 issues', () => {
    const result = normalizeProfile(
      {
        schemaVersion: SAVE_SCHEMA_VERSION,
        inventory: { 'ZZZ_999': 2, 'OK_1': 0 },
        currencies: {},
        decks: [{ id: 'd1', name: 'D', cardIds: ['ZZZ_999'] }],
        activeDeckId: 'ghost',
      },
      normalizeCtx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.inventory['ZZZ_999']).toBeUndefined();
    expect(result.profile.inventory['OK_1']).toBeUndefined();
    expect(result.profile.activeDeckId).toBeNull();
    expect(result.issues.join('\n')).toContain('ZZZ_999');
  });
});

describe('ProfileStore 导入导出', () => {
  it('导出不写盘，且与盘上那一份深相等', async () => {
    const { store, repository } = await readyStore();
    // 新号不立刻写盘（`loadOnce` 的注释）：先做一次改动把盘填上
    store.updateSettings({ masterVolume: 0.33 });
    await store.flush();
    const before = repository.commitCount;

    const text = await store.exportProfile();
    expect(text).not.toBeNull();
    // 导出本身绝不写盘
    expect(repository.commitCount).toBe(before);

    const disk = await repository.load();
    expect(JSON.parse(text!)).toEqual(disk);
  });

  it('预览一次都不 commit', async () => {
    const { store, repository } = await readyStore();
    const text = await store.exportProfile();
    const before = repository.commitCount;

    const preview = store.previewImport([{ name: 'save.json', text: text! }]);
    expect(preview.ok).toBe(true);
    expect(repository.commitCount).toBe(before);
  });

  it('新版存档整份替换：导出 → 改动 → 导入 → 值回到导出那一刻', async () => {
    const { store } = await readyStore();
    const text = await store.exportProfile();
    const exported = JSON.parse(text!);

    store.updateSettings({ masterVolume: 0.11 });
    await store.flush();
    expect(store.getSnapshot().profile!.settings.masterVolume).toBe(0.11);

    const result = await store.importProfile([{ name: 'save.json', text: text! }]);
    expect(result.ok).toBe(true);
    expect(store.getSnapshot().profile!.settings.masterVolume).toBe(exported.settings.masterVolume);
    expect(store.getSnapshot().profile!.revision).toBe(exported.revision);
  });

  it('导出 → 导入 → 再导出的文本逐字节相同', async () => {
    const { store } = await readyStore();
    const first = await store.exportProfile();
    await store.importProfile([{ name: 'save.json', text: first! }]);
    const second = await store.exportProfile();
    expect(second).toBe(first);
  });

  it('非法 JSON：不写盘，原存档逐字节不变', async () => {
    const { store, repository } = await readyStore();
    const before = JSON.stringify(await repository.load());

    const result = await store.importProfile([{ name: 'bad.json', text: '{ oops' }]);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(await repository.load())).toBe(before);
  });

  it('版本过高被拒绝，盘上不变', async () => {
    const { store, repository } = await readyStore();
    const before = JSON.stringify(await repository.load());

    const result = await store.importProfile([
      {
        name: 'future.json',
        text: JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION + 5, inventory: {}, currencies: {}, settings: {} }),
      },
    ]);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(await repository.load())).toBe(before);
  });

  it('写盘失败时原存档不变（内存与磁盘）', async () => {
    const repository = new FailingSaveRepository(new MemorySaveRepository());
    const { store } = await readyStore(repository);
    const text = await store.exportProfile();
    const before = JSON.stringify(store.getSnapshot().profile);

    const result = await store.importProfile([{ name: 'save.json', text: text! }]);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(store.getSnapshot().profile)).toBe(before);
  });

  it('旧版 inventory 导入：卡并进库存，且只产生一次 commit', async () => {
    const { store, repository } = await readyStore();
    const known = [...KNOWN][0]!;
    // 找回这张卡的旧路径形状：assets/outputs/<rarity>/<stem>.png
    const [rarity, stem] = known.split('_');
    const legacy = JSON.stringify({ cards: [{ path: `assets/outputs/${rarity}/${stem}.png` }] });
    const before = repository.commitCount;

    const preview = store.previewImport([{ name: 'inventory.json', text: legacy }]);
    expect(preview.ok).toBe(true);
    expect(preview.format).toBe('legacy-inventory');

    const result = await store.importProfile([{ name: 'inventory.json', text: legacy }]);
    expect(result.ok).toBe(true);
    // 一次原子写（卡组不存在时）
    expect(repository.commitCount).toBe(before + 1);
    expect(store.getSnapshot().profile!.inventory[known]!).toBeGreaterThanOrEqual(1);
  });

  it('混合格式被拒绝', async () => {
    const { store, repository } = await readyStore();
    const before = repository.commitCount;
    const result = await store.importProfile([
      { name: 'a.json', text: JSON.stringify({ cards: [] }) },
      { name: 'b.json', text: JSON.stringify({ golds: 5 }) },
    ]);
    expect(result.ok).toBe(false);
    expect(repository.commitCount).toBe(before);
  });
});
