/**
 * 设置的两条线（`src/state/settingsPersistence.ts` 与重塑后的 `settingsStore`）。
 *
 * 要证的不是「功能正常」，而是几条结构性约束：
 * - 老存档缺新字段时**水合不许崩**，用默认值兜底；
 * - store 的改动**合并成一次写盘**（沿用 `saveStore.test.ts` 那条纪律）；
 * - 「预设 vs 自定义」的判定只由四个参数决定。
 *
 * store 是模块级单例，用例之间会互相污染——每个用例前后都把它拨回 `DEFAULT_SETTINGS`。
 */

import { afterEach, describe, expect, it } from 'vitest';

import { cardDatabase, slice } from '../../src/data';
import { fixedClock } from '../../src/domain/progression/clock';
import { DEFAULT_SETTINGS, type ProfileState } from '../../src/domain/progression/types';
import { ProfileStore } from '../../src/state/createProfileStore';
import { MemorySaveRepository } from '../../src/services/save/MemorySaveRepository';
import { attachSettingsPersistence, hydrateSettings } from '../../src/state/settingsPersistence';
import { isPresetValues, knobsOf, useSettingsStore } from '../../src/state/settingsStore';
import { DEFAULT_THEME_ID } from '../../src/rendering/table/themes';
import { DEFAULT_CAMERA_MODE } from '../../src/rendering/battle/cameraModes';

const CLOCK = fixedClock(new Date('2026-01-01T12:00:00Z'));

function starterIds(): readonly string[] {
  const deck = slice.decks.find((entry) => entry.id === 'demo-player');
  return deck ? deck.cardIds : [];
}

async function readyStore() {
  const repository = new MemorySaveRepository();
  const store = new ProfileStore({
    repository,
    clock: CLOCK,
    seedSource: () => 0x2f6e2b1,
    contentVersion: cardDatabase.contentVersion,
    starterCardIds: starterIds(),
    debounceMs: 5,
  });
  await store.load();
  return { store, repository };
}

function profileOf(store: ProfileStore): ProfileState {
  const profile = store.getSnapshot().profile;
  if (!profile) {
    throw new Error('存档还没就绪');
  }
  return profile;
}

afterEach(() => {
  useSettingsStore.getState().hydrateFromSave(DEFAULT_SETTINGS);
});

describe('水合：存档 → store', () => {
  it('老存档缺新字段时用默认值兜底，不崩', async () => {
    const { store } = await readyStore();
    const base = profileOf(store);
    // 模拟一份 schema 扩字段之前存下的 settings：只有最初的 8 项
    const legacySettings = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    for (const key of ['tableThemeId', 'cameraModeId', 'reduceMotion', 'showPerf']) {
      delete legacySettings[key];
    }
    hydrateSettings({ ...base, settings: legacySettings } as unknown as ProfileState);

    const state = useSettingsStore.getState();
    expect(state.tableThemeId).toBe(DEFAULT_THEME_ID);
    expect(state.cameraModeId).toBe(DEFAULT_CAMERA_MODE);
    expect(state.reduceMotion).toBe(false);
    expect(state.showPerf).toBe(false);
  });

  it('存档里是空串的台面/视角 id 解析成引擎默认', async () => {
    const { store } = await readyStore();
    const base = profileOf(store);
    hydrateSettings({
      ...base,
      settings: { ...DEFAULT_SETTINGS, tableThemeId: '', cameraModeId: '' },
    });

    const state = useSettingsStore.getState();
    expect(state.tableThemeId).toBe(DEFAULT_THEME_ID);
    expect(state.cameraModeId).toBe(DEFAULT_CAMERA_MODE);
  });

  it('画质档的四个参数被原样水合，profile 由它们现算', async () => {
    const { store } = await readyStore();
    const base = profileOf(store);
    hydrateSettings({
      ...base,
      settings: { ...DEFAULT_SETTINGS, quality: 'high', dprCap: 1.25, particleBudget: 'low', bloom: false },
    });

    const state = useSettingsStore.getState();
    expect(state.dprCap).toBe(1.25);
    expect(state.profile.dprCap).toBe(1.25);
    // 粒子容量取 particleBudget（低），不是 quality（高）
    expect(state.profile.particleCapacity).toBe(250);
    // 关掉 Bloom 时强度归零
    expect(state.profile.bloom).toBe(false);
    expect(state.profile.bloomScale).toBe(0);
  });
});

describe('写穿：store → 存档', () => {
  it('多次改动合并成一次写盘，且值真的落进 profile.settings', async () => {
    const { store, repository } = await readyStore();
    hydrateSettings(profileOf(store));
    const detach = attachSettingsPersistence(store);
    const before = repository.commitCount;

    useSettingsStore.getState().setMasterVolume(0.25);
    useSettingsStore.getState().setQuality('high');
    useSettingsStore.getState().setCameraShake(false);
    await store.flush();
    detach();

    expect(repository.commitCount).toBe(before + 1);
    const settings = profileOf(store).settings;
    expect(settings.masterVolume).toBe(0.25);
    expect(settings.quality).toBe('high');
    // setQuality 把四个参数一起写成预设值
    expect(settings.dprCap).toBe(2);
    expect(settings.particleBudget).toBe('high');
    expect(settings.cameraShake).toBe(false);
  });

  it('水合本身不触发写盘（attach 记下的基线是水合后的值）', async () => {
    const { store, repository } = await readyStore();
    hydrateSettings(profileOf(store));
    const before = repository.commitCount;
    const detach = attachSettingsPersistence(store);
    await store.flush();
    detach();
    expect(repository.commitCount).toBe(before);
  });

  it('取消订阅之后改动不再写盘', async () => {
    const { store, repository } = await readyStore();
    hydrateSettings(profileOf(store));
    const detach = attachSettingsPersistence(store);
    detach();
    const before = repository.commitCount;

    useSettingsStore.getState().setMasterVolume(0.1);
    await store.flush();
    expect(repository.commitCount).toBe(before);
    expect(profileOf(store).settings.masterVolume).not.toBe(0.1);
  });
});

describe('预设 vs 自定义', () => {
  it('四个参数恰好等于预设时判为预设', () => {
    expect(isPresetValues('medium', knobsOf('medium'))).toBe(true);
    expect(isPresetValues('low', knobsOf('low'))).toBe(true);
  });

  it('单独改一个参数即判为自定义', () => {
    expect(isPresetValues('medium', { ...knobsOf('medium'), dprCap: 1 })).toBe(false);
    expect(isPresetValues('medium', { ...knobsOf('medium'), bloom: false })).toBe(false);
  });

  it('选预设会把四个参数一次写回，重新变回预设', async () => {
    const { store } = await readyStore();
    hydrateSettings(profileOf(store));
    const settings = useSettingsStore.getState();

    settings.setDprCap(1);
    expect(isPresetValues(useSettingsStore.getState().quality, {
      dprCap: useSettingsStore.getState().dprCap,
      particleBudget: useSettingsStore.getState().particleBudget,
      bloom: useSettingsStore.getState().bloom,
      shadows: useSettingsStore.getState().shadows,
    })).toBe(false);

    useSettingsStore.getState().setQuality('medium');
    const after = useSettingsStore.getState();
    expect(after.dprCap).toBe(1.5);
    expect(after.profile.dprCap).toBe(1.5);
  });
});
