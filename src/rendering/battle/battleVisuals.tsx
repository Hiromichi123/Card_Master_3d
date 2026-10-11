import { createContext, useContext, useMemo } from 'react';
import { useSettingsStore } from '../../state/settingsStore';
import { QUALITY_PROFILES, type QualityProfile, type QualityTier } from '../quality';
import { getTableTheme, type TableTheme } from '../table/themes';

export interface BattleVisuals {
  readonly theme: TableTheme;
  readonly quality: QualityTier;
  readonly profile: QualityProfile;
  readonly lockedTheme: boolean;
}

/** Local rendering overrides never mutate or persist the player's global preferences. */
export const BattleVisualContext = createContext<BattleVisuals | null>(null);
const ABYSS_PROFILE: QualityProfile = { ...QUALITY_PROFILES.high, shadowMapSize: 4096 };

export function useBattleVisuals(themeId?: string): BattleVisuals {
  const inherited = useContext(BattleVisualContext);
  const savedTheme = useSettingsStore(state => state.tableTheme);
  const savedQuality = useSettingsStore(state => state.quality);
  const savedProfile = useSettingsStore(state => state.profile);
  const resolved = useMemo<BattleVisuals>(() => {
    const theme = themeId ? getTableTheme(themeId) : savedTheme;
    const high = theme.geometry === 'abyss';
    return { theme, quality: high ? 'high' : savedQuality, profile: high ? ABYSS_PROFILE : savedProfile, lockedTheme: !!themeId };
  }, [themeId, savedTheme, savedQuality, savedProfile]);
  return !themeId && inherited ? inherited : resolved;
}
