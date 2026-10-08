/**
 * 存档迁移链。
 *
 * **今天是空表**（只有 v1，没有任何需要迁移的旧格式），但接缝先留在这里：
 * `saveTransfer.normalizeProfile` 已经按「逐版爬升」的方式调用它，将来把
 * `SAVE_SCHEMA_VERSION` 提到 2 时，只要往 `MIGRATIONS` 里补一条 `1 → 2`，
 * 导入旧存档就会自动带上「已从 v1 迁移到 v2」的提示，不必改导入逻辑。
 *
 * 爬链时**缺一环就拒绝**，绝不猜着读：这正是「导入之后少了 30 张卡但没人知道
 * 为什么」的来源（与 `legacyImport.ts` 开头那条纪律一致）。
 */

import { SAVE_SCHEMA_VERSION } from './types';

export type Migration = (value: Record<string, unknown>) => Record<string, unknown>;

/** fromVersion → 把它升到 fromVersion + 1。 */
export const MIGRATIONS: Record<number, Migration> = {};

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
