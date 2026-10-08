import { ANIMATION_DURATION_SCALE } from '../rendering/anim/timing';
import { create } from 'zustand';

import {
  QUALITY_PROFILES,
  type QualityProfile,
  type QualityTier,
} from '../rendering/quality';
import {
  DEFAULT_CAMERA_MODE,
  type CameraModeId,
} from '../rendering/battle/cameraModes';
import { DEFAULT_THEME_ID, getTableTheme, type TableTheme } from '../rendering/table/themes';
import type { SettingsState } from '../domain/progression/types';

/**
 * 低频应用状态（PLAN 第 2 节：用 Zustand 管低频状态，高频更新直接走 three）。
 *
 * 这里只放「改一次、长期不变」的东西：画质、演出速度、镜头震动开关、音量。
 * 高频的（相机、粒子、悬停）一律不进 store——每帧 setState 是 R3F 的典型陷阱。
 *
 * 这些开关**只影响表现**：任何一项都不得改变战斗结果（`V-FX-5`）。
 *
 * **这个 store 是设置的运行期唯一真相**（2026-10-08）。存档里的 `profile.settings`
 * 只是它的持久化镜像：启动时 `state/settingsPersistence.hydrateSettings` 灌进来，
 * 之后每次改动由 `attachSettingsPersistence` 防抖写回。不要在别处再存一份设置值。
 *
 * ## 画质档：预设 + 四个可覆盖参数
 *
 * `quality` **不是**有效档位的全部——它只是「玩家上次点的那个预设」。
 * 真正决定画面的是四个参数（`dprCap` / `particleBudget` / `bloom` / `shadows`），
 * 它们初始等于预设值，玩家可以单独改其中一项（P7 清单要求 DPR 上限、粒子预算、
 * Bloom/阴影档可分别设置）。改过之后四个参数与预设不再相等，界面据此显示「自定义」。
 */

export type PresentationSpeed = 'normal' | 'fast' | 'skip';

/** 画质档的四个可覆盖参数。 */
export interface QualityKnobs {
  readonly dprCap: number;
  readonly particleBudget: QualityTier;
  readonly bloom: boolean;
  readonly shadows: boolean;
}

/** 某档预设对应的四个参数值。 */
export function knobsOf(tier: QualityTier): QualityKnobs {
  const preset = QUALITY_PROFILES[tier];
  return {
    dprCap: preset.dprCap,
    particleBudget: tier,
    bloom: preset.bloom,
    shadows: preset.shadows,
  };
}

/**
 * 由「预设 + 覆盖参数」算出有效的 `QualityProfile`。
 *
 * 分工：预设决定**性格**（`cardTier` 与 `bloomScale` 基准、阴影贴图边长），
 * 四个参数决定**这一档的具体取值**。
 */
export function resolveProfile(quality: QualityTier, knobs: QualityKnobs): QualityProfile {
  const preset = QUALITY_PROFILES[quality];
  return {
    dprCap: knobs.dprCap,
    particleCapacity: QUALITY_PROFILES[knobs.particleBudget].particleCapacity,
    bloom: knobs.bloom,
    // 关掉 Bloom 时强度归零（消费端只看 bloomScale，见 PostEffects）
    bloomScale: knobs.bloom ? preset.bloomScale : 0,
    shadows: knobs.shadows,
    shadowMapSize: preset.shadowMapSize,
    cardTier: preset.cardTier,
  };
}

/** 当前四个参数是否恰好等于某个预设——不等即界面上的「自定义」。 */
export function isPresetValues(quality: QualityTier, knobs: QualityKnobs): boolean {
  const preset = knobsOf(quality);
  return (
    preset.dprCap === knobs.dprCap &&
    preset.particleBudget === knobs.particleBudget &&
    preset.bloom === knobs.bloom &&
    preset.shadows === knobs.shadows
  );
}

const QUALITY_TIERS: readonly QualityTier[] = ['low', 'medium', 'high'];
const SPEEDS: readonly PresentationSpeed[] = ['normal', 'fast', 'skip'];

function safeTier(value: unknown, fallback: QualityTier): QualityTier {
  return typeof value === 'string' && (QUALITY_TIERS as readonly string[]).includes(value)
    ? (value as QualityTier)
    : fallback;
}

function safeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function safeUnit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

interface SettingsStateShape {
  readonly quality: QualityTier;
  /** 画质档的四个可覆盖参数（扁平存放，便于字段级 diff 与持久化）。 */
  readonly dprCap: number;
  readonly particleBudget: QualityTier;
  readonly bloom: boolean;
  readonly shadows: boolean;
  /** 由「预设 + 四个参数」现算出的有效档位。 */
  readonly profile: QualityProfile;
  /** 演出速度。规则层已经算完，这里只压缩播放时长。 */
  readonly presentationSpeed: PresentationSpeed;
  /** 镜头震动开关。`V-WORLD-5` 要求可关且不影响结果。 */
  readonly cameraShake: boolean;
  /** 是否显示性能读数条。 */
  readonly showPerf: boolean;
  /**
   * 减少动态。
   *
   * 天气层不会因此消失，只会**冻结**——静止的画面仍然是玩家选的那张台面，
   * 这条与原项目的处理一致。
   */
  readonly reduceMotion: boolean;
  /** 战斗台面主题 id。 */
  readonly tableThemeId: string;
  /** 解析后的主题对象，避免每帧重新查找。 */
  readonly tableTheme: TableTheme;
  /** 相机视角预设。 */
  readonly cameraModeId: CameraModeId;
  /** 主音量 0..1。 */
  readonly masterVolume: number;

  setQuality: (tier: QualityTier) => void;
  setDprCap: (value: number) => void;
  setParticleBudget: (tier: QualityTier) => void;
  setBloom: (enabled: boolean) => void;
  setShadows: (enabled: boolean) => void;
  setPresentationSpeed: (speed: PresentationSpeed) => void;
  setCameraShake: (enabled: boolean) => void;
  setShowPerf: (enabled: boolean) => void;
  setTableTheme: (id: string) => void;
  setCameraMode: (id: CameraModeId) => void;
  setReduceMotion: (enabled: boolean) => void;
  setMasterVolume: (value: number) => void;
  /** 把存档里的设置灌进来。**只由 `state/settingsPersistence` 调用。** */
  hydrateFromSave: (settings: SettingsState) => void;
}

export const useSettingsStore = create<SettingsStateShape>((set) => {
  /**
   * 改四个参数中的任意几个，并重算 `profile`。
   * 只在 store 内部用，避免每处 setter 各写一遍 resolve。
   */
  const applyKnobs = (
    state: SettingsStateShape,
    patch: Partial<QualityKnobs>,
  ): Partial<SettingsStateShape> => {
    const knobs: QualityKnobs = {
      dprCap: patch.dprCap ?? state.dprCap,
      particleBudget: patch.particleBudget ?? state.particleBudget,
      bloom: patch.bloom ?? state.bloom,
      shadows: patch.shadows ?? state.shadows,
    };
    return { ...knobs, profile: resolveProfile(state.quality, knobs) };
  };

  const medium = knobsOf('medium');

  return {
    quality: 'medium',
    ...medium,
    profile: resolveProfile('medium', medium),
    presentationSpeed: 'normal',
    cameraShake: true,
    showPerf: false,
    reduceMotion: false,
    cameraModeId: DEFAULT_CAMERA_MODE,
    tableThemeId: DEFAULT_THEME_ID,
    tableTheme: getTableTheme(DEFAULT_THEME_ID),
    masterVolume: 0.7,

    // 选预设 = 一次性把四个参数写回该档的值（并清掉「自定义」）
    setQuality: (tier) => set((state) => ({ quality: tier, ...applyKnobs(state, knobsOf(tier)) })),
    setDprCap: (value) =>
      set((state) => applyKnobs(state, { dprCap: Math.min(3, Math.max(1, value)) })),
    setParticleBudget: (tier) => set((state) => applyKnobs(state, { particleBudget: tier })),
    setBloom: (enabled) => set((state) => applyKnobs(state, { bloom: enabled })),
    setShadows: (enabled) => set((state) => applyKnobs(state, { shadows: enabled })),
    setPresentationSpeed: (presentationSpeed) => set({ presentationSpeed }),
    setCameraShake: (cameraShake) => set({ cameraShake }),
    setShowPerf: (showPerf) => set({ showPerf }),
    setTableTheme: (id) => set({ tableThemeId: id, tableTheme: getTableTheme(id) }),
    setReduceMotion: (reduceMotion) => set({ reduceMotion }),
    setCameraMode: (cameraModeId) => set({ cameraModeId }),
    setMasterVolume: (value) => set({ masterVolume: safeUnit(value, 0.7) }),

    hydrateFromSave: (settings) =>
      set(() => {
        const quality = safeTier(settings.quality, 'medium');
        const knobs: QualityKnobs = {
          dprCap:
            typeof settings.dprCap === 'number' && Number.isFinite(settings.dprCap)
              ? Math.min(3, Math.max(1, settings.dprCap))
              : knobsOf(quality).dprCap,
          particleBudget: safeTier(settings.particleBudget, quality),
          bloom: safeBool(settings.bloom, true),
          shadows: safeBool(settings.shadows, true),
        };
        // 空串或未知 id 都回落到引擎默认（getTableTheme 自己会把未知 id 解析成默认）
        const tableThemeId = settings.tableThemeId || DEFAULT_THEME_ID;
        return {
          quality,
          ...knobs,
          profile: resolveProfile(quality, knobs),
          presentationSpeed:
            typeof settings.presentationSpeed === 'string' &&
            (SPEEDS as readonly string[]).includes(settings.presentationSpeed)
              ? (settings.presentationSpeed as PresentationSpeed)
              : 'normal',
          cameraShake: safeBool(settings.cameraShake, true),
          reduceMotion: safeBool(settings.reduceMotion, false),
          showPerf: safeBool(settings.showPerf, false),
          tableThemeId,
          tableTheme: getTableTheme(tableThemeId),
          cameraModeId: settings.cameraModeId
            ? (settings.cameraModeId as CameraModeId)
            : DEFAULT_CAMERA_MODE,
          masterVolume: safeUnit(settings.masterVolume, 0.7),
        };
      }),
  };
});

/** 演出速度 → 时长倍数。跳过模式由 `skipAll` 直接补完，不走倍数。 */
export const SPEED_SCALE: Record<PresentationSpeed, number> = {
  normal: ANIMATION_DURATION_SCALE,
  fast: 0.45 * ANIMATION_DURATION_SCALE,
  skip: 0.05 * ANIMATION_DURATION_SCALE,
};
