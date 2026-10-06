import { nextLevelXp } from '../domain/progression/levels';
import type { LevelState } from '../domain/progression/types';

/** 等级与经验条。升级所需经验由 `levels.ts` 现算，不另存一份。 */
export function LevelBar({ level }: { level: LevelState }) {
  const need = nextLevelXp(level);
  const ratio = need > 0 ? Math.max(0, Math.min(1, level.xp / need)) : 0;

  return (
    <div className="level" aria-label="等级">
      <span className="level__tag">Lv.{level.level}</span>
      <span className="level__track">
        <span className="level__fill" style={{ width: `${ratio * 100}%` }} />
      </span>
      <span className="level__value">
        {level.xp} / {need}
      </span>
    </div>
  );
}
