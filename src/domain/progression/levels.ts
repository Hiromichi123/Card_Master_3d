/**
 * 等级与经验。
 *
 * 曲线照搬旧版 `ui/system_ui.py:198-203`：
 * `next = ceil(baseXp * multiplier ^ (level - 1))`，即 100 → 120 → 144 → 173…
 * （1.2³ = 1.728，向上取整成 173，不是 172.8）。
 *
 * 旧版的升级是个 `while` 循环、每升一级重新算一次所需经验，
 * 所以一次拿到大量经验可以连升多级——这一点要保留。
 */

import type { LevelState } from './types';

/** 升到下一级还差多少经验。 */
export function nextLevelXp(level: LevelState): number {
  return Math.ceil(level.baseXp * level.xpMultiplier ** (level.level - 1));
}

/**
 * 加经验，返回新状态与升了几级。
 *
 * 循环每转一圈都用**更新后的** level 重算所需经验，
 * 所以「差 1 点升 3 级」这种输入也能正确连升。
 */
export function grantXp(level: LevelState, gain: number): {
  readonly level: LevelState;
  readonly levelsGained: number;
} {
  let current = level.level;
  let xp = Math.max(0, level.xp + Math.max(0, gain));
  let levelsGained = 0;

  // 上限只是防御性：经验给到天文数字时不要真的转到天荒地老
  while (levelsGained < 1000) {
    const need = Math.ceil(level.baseXp * level.xpMultiplier ** (current - 1));
    if (xp < need) {
      break;
    }
    xp -= need;
    current += 1;
    levelsGained += 1;
  }

  return {
    level: { ...level, level: current, xp },
    levelsGained,
  };
}
