import { create } from 'zustand';

import {
  QUALITY_PROFILES,
  type QualityProfile,
  type QualityTier,
} from '../rendering/quality';
import { DEFAULT_THEME_ID, getTableTheme, type TableTheme } from '../rendering/table/themes';

/**
 * 低频应用状态（PLAN 第 2 节：用 Zustand 管低频状态，高频更新直接走 three）。
 *
 * 这里只放「改一次、长期不变」的东西：画质档、演出速度、镜头震动开关。
 * 高频的（相机、粒子、悬停）一律不进 store——每帧 setState 是 R3F 的典型陷阱。
 *
 * 这些开关**只影响表现**：任何一项都不得改变战斗结果（`V-FX-5`）。
 */

export type PresentationSpeed = 'normal' | 'fast' | 'skip';

interface SettingsState {
  readonly quality: QualityTier;
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

  setQuality: (tier: QualityTier) => void;
  setPresentationSpeed: (speed: PresentationSpeed) => void;
  setCameraShake: (enabled: boolean) => void;
  setShowPerf: (enabled: boolean) => void;
  setTableTheme: (id: string) => void;
  setReduceMotion: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  quality: 'medium',
  profile: QUALITY_PROFILES.medium,
  presentationSpeed: 'normal',
  cameraShake: true,
  showPerf: false,
  reduceMotion: false,
  tableThemeId: DEFAULT_THEME_ID,
  tableTheme: getTableTheme(DEFAULT_THEME_ID),

  setQuality: (tier) => set({ quality: tier, profile: QUALITY_PROFILES[tier] }),
  setPresentationSpeed: (presentationSpeed) => set({ presentationSpeed }),
  setCameraShake: (cameraShake) => set({ cameraShake }),
  setShowPerf: (showPerf) => set({ showPerf }),
  setTableTheme: (id) => set({ tableThemeId: id, tableTheme: getTableTheme(id) }),
  setReduceMotion: (reduceMotion) => set({ reduceMotion }),
}));

/** 演出速度 → 时长倍数。跳过模式由 `skipAll` 直接补完，不走倍数。 */
export const SPEED_SCALE: Record<PresentationSpeed, number> = {
  normal: 1,
  fast: 0.45,
  skip: 0.05,
};
