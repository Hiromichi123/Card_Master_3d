import { create } from 'zustand';
import { DEFAULT_AI, normalizeAiSettings } from '../domain/battle/ai/types';
import { useSettingsStore } from './settingsStore';
import { useAiModelStore } from './aiModelStore';

/** Only the active development admin may override normal player AI settings. */
export const useAdminAiStore = create<{ enabled: boolean }>(() => ({ enabled: false }));
export const adminAiEnabled = () => import.meta.env.DEV && useAdminAiStore.getState().enabled;
export function battleAiSettings() {
  if (!adminAiEnabled()) return DEFAULT_AI;
  const s = useSettingsStore.getState();
  return normalizeAiSettings({ difficulty: s.aiDifficulty, style: s.aiStyle, policy: s.aiPolicy });
}
export const battleAiModel = () => adminAiEnabled() ? useAiModelStore.getState().model : null;
