import { DEFAULT_SETTINGS, type ProfileState, type SettingsState } from '../domain/progression/types';
import type { ProfileStore } from './createProfileStore';
import { useSettingsStore } from './settingsStore';

/**
 * 设置的两条线：**存档 ⇄ zustand**。
 *
 * 为什么要单独一个模块：zustand `useSettingsStore` 是设置的运行期唯一真相，
 * 但它是纯内存的；存档里的 `profile.settings` 是它的持久化镜像。两个方向各自
 * 只有一件事要做，放在这里让「谁在什么时候同步」一眼可见：
 *
 * - `hydrateSettings`：存档 → store。**启动时一次**，以及**导入存档之后一次**。
 * - `attachSettingsPersistence`：store → 存档。订阅 zustand，只把**变化**的字段
 *   拼成一笔补丁交给 `ProfileStore.updateSettings`（它自带防抖合并，
 *   见 `createProfileStore.flushDebounced`）。
 *
 * `ProfileStore` 用类型 import：这里只调它的方法，不需要它的运行时值，
 * 也避免与 `createProfileStore` 形成运行时环。
 */

type StoreState = ReturnType<typeof useSettingsStore.getState>;

/**
 * 需要持久化的字段。`profile`（有效档位）与 `tableTheme`（解析后的对象）都是派生值，
 * 不落盘——它们由其余字段现算，存下来只会成为第二个真相。
 */
const PERSISTED_KEYS = [
  'quality',
  'dprCap',
  'particleBudget',
  'bloom',
  'shadows',
  'cameraShake',
  'presentationSpeed',
  'masterVolume',
  'tableThemeId',
  'cameraModeId',
  'reduceMotion',
  'showPerf',
] as const satisfies readonly (keyof SettingsState)[];

function pick(state: StoreState): SettingsState {
  return {
    quality: state.quality,
    dprCap: state.dprCap,
    particleBudget: state.particleBudget,
    bloom: state.bloom,
    shadows: state.shadows,
    cameraShake: state.cameraShake,
    presentationSpeed: state.presentationSpeed,
    masterVolume: state.masterVolume,
    tableThemeId: state.tableThemeId,
    cameraModeId: state.cameraModeId,
    reduceMotion: state.reduceMotion,
    showPerf: state.showPerf,
  };
}

/**
 * 存档 → store。
 *
 * **必须兜底**：`IndexedDbSaveRepository.load()` 原样返回磁盘上的对象，
 * 不补默认值也不校验（`IndexedDbSaveRepository.ts` 刻意如此，那条是热路径）。
 * 老存档缺新字段、或字段是脏值时，`DEFAULT_SETTINGS` 与 store 内的 `safe*` 一起托底。
 */
export function hydrateSettings(profile: ProfileState): void {
  const stored = profile.settings ?? {};
  const merged: SettingsState = { ...DEFAULT_SETTINGS, ...stored };
  useSettingsStore.getState().hydrateFromSave(merged);
}

/**
 * store → 存档。返回取消订阅的函数（供 effect 清理）。
 *
 * **调用顺序**：先 `hydrateSettings`，再 `attachSettingsPersistence`。
 * 后者记下的「上一帧值」是水合之后的值，因此水合本身不会触发一次多余的写盘。
 */
export function attachSettingsPersistence(store: ProfileStore): () => void {
  let last = pick(useSettingsStore.getState());
  return useSettingsStore.subscribe((state) => {
    const next = pick(state);
    const patch: Record<string, unknown> = {};
    let changed = false;
    for (const key of PERSISTED_KEYS) {
      if (next[key] !== last[key]) {
        patch[key] = next[key];
        changed = true;
      }
    }
    last = next;
    if (changed) {
      store.updateSettings(patch as Partial<SettingsState>);
    }
  });
}
