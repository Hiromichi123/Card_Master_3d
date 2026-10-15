/**
 * 存档迁移链。
 *
 * v1 → v2 为原存档补充主界面剧情/签到奖励账本。
 * 自动加载和 JSON 导入共用此迁移；旧库存、牌组、设置和通关进度均保留。
 *
 * 爬链时**缺一环就拒绝**，绝不猜着读：这正是「导入之后少了 30 张卡但没人知道
 * 为什么」的来源（与 `legacyImport.ts` 开头那条纪律一致）。
 */

import { SAVE_SCHEMA_VERSION } from './types';
import { emptyRewards } from './rewardState';
import { initialActivity } from './playerActivity';
import { emptyMailbox } from './mailbox';
import { emptyActivityProgress } from './activityModes';
import { emptyMazeProgress } from './mazeProgress';
import { migrateDeckSlots } from './deckSlots';
import { emptyAbyssState } from './abyssRun';
import { isShopDayKey, shopStateForDay } from './shop';

/** 旧档的日键可能仍是建号日期，不能用它丢弃后续购买的售罄记录。 */
const migrateDailyShop: Migration = value => {
  const raw = value.shop;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...value, schemaVersion: 7 };
  }
  const shop = raw as Record<string, unknown>;
  const soldOut = Array.isArray(shop.soldOut)
    ? shop.soldOut.filter((id): id is string => typeof id === 'string') : [];
  const days = [shop.dayKey, ...soldOut.map(id => id.split('|')[0])]
    .filter((day): day is string => typeof day === 'string' && isShopDayKey(day));
  const dayKey = days.sort().at(-1);
  return { ...value, schemaVersion: 7, shop: dayKey ? shopStateForDay(dayKey, soldOut) : raw };
};

export type Migration = (value: Record<string, unknown>) => Record<string, unknown>;

/** fromVersion → 把它升到 fromVersion + 1。 */
export const MIGRATIONS: Record<number, Migration> = {
  1: value => ({ ...value, schemaVersion: 2, rewards: value.rewards ?? emptyRewards() }),
  2: value => ({ ...value, schemaVersion: 3, mazeProgress: emptyMazeProgress() }),
  3: migrateDeckSlots,
  4: value => ({
    ...value, schemaVersion: 5,
    // 非法天梯对象原样留给后续校验，不能补成一份可重复领奖的新档。
    ladder: typeof value.ladder === 'object' && value.ladder !== null && !Array.isArray(value.ladder)
      ? { ...value.ladder, claimedTierFloors: [] } : value.ladder,
  }),
  5: value => ({ ...value, schemaVersion: 6, abyss: emptyAbyssState() }),
  6: migrateDailyShop,
  7: value => ({ ...value, schemaVersion: 8, activity: value.activity ?? initialActivity({ gacha: value.gacha, ladder: value.ladder, abyss: value.abyss }) }),
  8: value => ({ ...value, schemaVersion: 9, mailbox: value.mailbox ?? emptyMailbox() }),
  9: value => ({ ...value, schemaVersion: 10, activityModes: value.activityModes ?? emptyActivityProgress() }),
};

export type MigrateResult =
  | { readonly ok: true; readonly value: unknown; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly message: string };

export function migrateToCurrent(raw: unknown, fromVersion: number): MigrateResult {
  const warnings: string[] = [];
  let value = raw;
  for (let version = fromVersion; version < SAVE_SCHEMA_VERSION; version += 1) {
    const step = MIGRATIONS[version];
    if (!step || typeof value !== 'object' || value === null || Array.isArray(value)) {
      return {
        ok: false,
        message: `这份存档是 v${fromVersion}，缺 v${version} → v${version + 1} 的迁移步骤，无法读取。`,
      };
    }
    value = step(value as Record<string, unknown>);
    warnings.push(`已从 v${version} 迁移到 v${version + 1}。`);
  }
  return { ok: true, value, warnings };
}
