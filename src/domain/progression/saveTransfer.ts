/**
 * 存档的 JSON 导入 / 导出：**解析与校验**（纯函数，不碰 `File`、不写盘）。
 *
 * 与 `legacyImport.ts` 同一条纪律：调用方把已经读成**字符串**的内容传进来，
 * 于是整条链路在 node 里可测。文件 IO 留在界面层。
 *
 * 校验为什么落在这一层而不是 `SaveRepository`：`IndexedDbSaveRepository.load()`
 * 是**每次启动都跑**的热路径，它刻意不做校验、不补默认值；而导入是一次性的、
 * 由用户主动触发的操作，为它承担防御成本的不对称是刻意为之。一份缺
 * `settings.masterVolume` 的文档一旦写进盘，就会一直是一份坏存档。
 */

import { createInitialProfile } from './profile';
import { previewDeck, previewInventory, previewProfile } from './legacyImport';
import type { ImportSources } from './legacyImport';
import { migrateToCurrent } from './migrations';
import {
  DECK_LIMIT,
  DEFAULT_SETTINGS,
  SAVE_SCHEMA_VERSION,
  type Deck,
  type EconomyTransaction,
  type LegacyImportPreview,
  type ProfileState,
} from './types';

/** 一份已读成文本的候选文件。刻意不碰 `File`（那会把 DOM 拖进 domain 层）。 */
export interface ImportFile {
  readonly name: string;
  readonly text: string;
}

export type SaveFormat =
  | 'profile'
  | 'legacy-inventory'
  | 'legacy-profile'
  | 'legacy-deck'
  | 'unknown';

export type ImportFailureReason =
  | 'invalidJson'
  | 'unknownFormat'
  | 'mixedFormats'
  | 'schemaTooNew'
  | 'unsupportedSchema'
  | 'invalidShape'
  | 'busy'
  | 'saveFailed';

export interface ImportPreview {
  readonly ok: boolean;
  readonly format: SaveFormat | 'mixed';
  readonly message: string;
  readonly reason?: ImportFailureReason | undefined;
  /** 新版存档：**已补默认值、已校验**的候选（尚未写盘）。 */
  readonly profile: ProfileState | null;
  /** 旧版存档：直接来自 `legacyImport.ts` 的三个 preview。 */
  readonly legacy: readonly LegacyImportPreview[];
  /** 会丢 / 会被忽略的东西。**必须显示**——这是「未知项可见」的落点。 */
  readonly issues: readonly string[];
  readonly warnings: readonly string[];
  /** 一句话影响摘要，给确认对话框用：「+1 张 S_001、+300 金」。 */
  readonly summary: readonly string[];
}

export type ImportResult =
  | { readonly ok: true; readonly format: SaveFormat; readonly revision: number }
  | { readonly ok: false; readonly reason: ImportFailureReason; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 按**形状**判定格式，不靠文件名。顺序有意义：新档不可能有顶层 `cards`/`deck`。 */
export function detectSaveFormat(raw: unknown): SaveFormat {
  if (!isRecord(raw)) {
    return 'unknown';
  }
  if (isRecord(raw.inventory) && isRecord(raw.currencies) && isRecord(raw.settings)) {
    return 'profile';
  }
  if (Array.isArray(raw.cards)) {
    return 'legacy-inventory';
  }
  if (Array.isArray(raw.deck)) {
    return 'legacy-deck';
  }
  if (['golds', 'crystals', 'badges'].some((key) => typeof raw[key] === 'number')) {
    return 'legacy-profile';
  }
  return 'unknown';
}

/** 长得像新版存档、但 `schemaVersion` 非法（缺字段 / 不是整数）。 */
export function looksLikeProfile(raw: unknown): boolean {
  return isRecord(raw) && (isRecord(raw.inventory) || isRecord(raw.currencies));
}

export type ParseResult =
  | { readonly ok: true; readonly raw: unknown }
  | { readonly ok: false; readonly message: string };

export function parseSaveJson(text: string): ParseResult {
  try {
    return { ok: true, raw: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, message: `不是合法的 JSON：${error instanceof Error ? error.message : String(error)}` };
  }
}

export interface NormalizeContext {
  readonly knownCardIds: ReadonlySet<string>;
  readonly contentVersion: string;
  readonly dayKey: string;
  readonly now: Date;
}

export type NormalizeResult =
  | {
      readonly ok: true;
      readonly profile: ProfileState;
      readonly issues: string[];
      readonly warnings: string[];
    }
  | { readonly ok: false; readonly reason: ImportFailureReason; readonly message: string };

/**
 * 补默认值 + 逐字段校验，返回**完全成形**的 `ProfileState`。
 *
 * 不认识的东西一律进 `issues`（**不静默丢弃**），因为用户的预期是
 * 「导入之后我原来那些卡还在」——少了什么必须先看得见。
 */
export function normalizeProfile(raw: unknown, ctx: NormalizeContext): NormalizeResult {
  if (!isRecord(raw)) {
    return { ok: false, reason: 'invalidShape', message: '存档不是一个 JSON 对象。' };
  }
  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return {
      ok: false,
      reason: 'invalidShape',
      message: '这份 JSON 有 inventory / currencies，但没有合法的 schemaVersion——它不像一份能读的存档。',
    };
  }
  if (version > SAVE_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'schemaTooNew',
      message: `这份存档来自 v${version}，当前版本只认 v${SAVE_SCHEMA_VERSION}，读不了。请用更新的客户端打开，或换一份存档。`,
    };
  }
  const migrated = migrateToCurrent(raw, version);
  if (!migrated.ok) {
    return { ok: false, reason: 'unsupportedSchema', message: migrated.message };
  }

  const issues: string[] = [];
  const warnings: string[] = migrated.warnings.slice();
  const source = migrated.value as Record<string, unknown>;
  const base = createInitialProfile({
    contentVersion: ctx.contentVersion,
    dayKey: ctx.dayKey,
    starterCardIds: [],
    ownedCardIds: [],
    now: ctx.now,
  });

  // 货币
  const rawCurrency = isRecord(source.currencies) ? source.currencies : {};
  const currencies = {
    gold: Math.max(0, Math.trunc(finiteOr(rawCurrency.gold, base.currencies.gold))),
    crystal: Math.max(0, Math.trunc(finiteOr(rawCurrency.crystal, base.currencies.crystal))),
    badge: Math.max(0, Math.trunc(finiteOr(rawCurrency.badge, base.currencies.badge))),
  };

  // 库存
  const inventory: Record<string, number> = {};
  const rawInventory = isRecord(source.inventory) ? source.inventory : {};
  let droppedInventory = 0;
  for (const [cardId, value] of Object.entries(rawInventory)) {
    const count = Math.trunc(finiteOr(value, 0));
    if (count <= 0) {
      droppedInventory += 1;
      continue;
    }
    if (ctx.knownCardIds.size > 0 && !ctx.knownCardIds.has(cardId)) {
      issues.push(`库存里的 ${cardId} 在当前卡库里不存在，已跳过。`);
      continue;
    }
    inventory[cardId] = count;
  }
  if (droppedInventory > 0) {
    issues.push(`库存里有 ${droppedInventory} 条计数不是正整数的记录，已跳过。`);
  }

  // 卡组
  const decks: Deck[] = [];
  if (Array.isArray(source.decks)) {
    for (const entry of source.decks) {
      if (!isRecord(entry) || typeof entry.id !== 'string') {
        issues.push('有一个卡组缺少 id，已跳过。');
        continue;
      }
      const rawIds = Array.isArray(entry.cardIds) ? entry.cardIds.filter((id): id is string => typeof id === 'string') : [];
      const known = rawIds.filter((id) => ctx.knownCardIds.size === 0 || ctx.knownCardIds.has(id));
      if (known.length !== rawIds.length) {
        issues.push(`卡组「${typeof entry.name === 'string' ? entry.name : entry.id}」里有 ${rawIds.length - known.length} 张卡不在当前卡库，已去掉。`);
      }
      if (known.length > DECK_LIMIT) {
        issues.push(`卡组「${typeof entry.name === 'string' ? entry.name : entry.id}」超过 ${DECK_LIMIT} 张，已截断。`);
      }
      decks.push({
        id: entry.id,
        name: typeof entry.name === 'string' ? entry.name : entry.id,
        cardIds: known.slice(0, DECK_LIMIT),
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : ctx.now.toISOString(),
      });
    }
  } else if (source.decks !== undefined) {
    issues.push('decks 不是一个数组，已忽略。');
  }

  let activeDeckId = typeof source.activeDeckId === 'string' ? source.activeDeckId : null;
  if (activeDeckId && !decks.some((deck) => deck.id === activeDeckId)) {
    issues.push(`出战卡组 ${activeDeckId} 不存在，已置空。`);
    activeDeckId = null;
  }

  // 结算去重表
  const settledBattleIds = Array.isArray(source.settledBattleIds)
    ? source.settledBattleIds.filter((id): id is string => typeof id === 'string')
    : [];
  if (Array.isArray(source.settledBattleIds) && settledBattleIds.length !== source.settledBattleIds.length) {
    issues.push('settledBattleIds 里有非字符串项，已去掉。');
  }

  // 其余字段：形状不对就回落到默认值，不阻断导入
  const level = isRecord(source.level)
    ? {
        level: Math.max(1, Math.trunc(finiteOr(source.level.level, base.level.level))),
        xp: Math.max(0, finiteOr(source.level.xp, base.level.xp)),
        baseXp: Math.max(1, finiteOr(source.level.baseXp, base.level.baseXp)),
        xpMultiplier: Math.max(1, finiteOr(source.level.xpMultiplier, base.level.xpMultiplier)),
      }
    : base.level;

  const gacha = isRecord(source.gacha) && isRecord(source.gacha.pullsByPool)
    ? { pullsByPool: source.gacha.pullsByPool as Record<string, number> }
    : base.gacha;

  const shop = isRecord(source.shop)
    ? {
        dayKey: typeof source.shop.dayKey === 'string' ? source.shop.dayKey : ctx.dayKey,
        seed: Math.trunc(finiteOr(source.shop.seed, 0)),
        soldOut: Array.isArray(source.shop.soldOut)
          ? source.shop.soldOut.filter((id): id is string => typeof id === 'string')
          : [],
      }
    : base.shop;

  const campaign = isRecord(source.campaign)
    ? {
        clearedStages: Array.isArray(source.campaign.clearedStages)
          ? source.campaign.clearedStages.filter((id): id is string => typeof id === 'string')
          : [],
        currentChapterId: typeof source.campaign.currentChapterId === 'string' ? source.campaign.currentChapterId : null,
      }
    : base.campaign;

  // 设置：逐字段兜底（`useSettingsStore.hydrateFromSave` 还会再兜一层）
  const settings = { ...DEFAULT_SETTINGS, ...(isRecord(source.settings) ? source.settings : {}) };

  // 顶层不认识的字段：`ProfileState` 是强类型的，不能把陌生键带进内存
  const KNOWN_KEYS = new Set([
    'schemaVersion', 'contentVersion', 'revision', 'currencies', 'level', 'inventory', 'decks',
    'activeDeckId', 'gacha', 'shop', 'campaign', 'mazeRun', 'settings', 'settledBattleIds',
  ]);
  const unknownKeys = Object.keys(source).filter((key) => !KNOWN_KEYS.has(key));
  if (unknownKeys.length > 0) {
    issues.push(`已忽略不认识的字段：${unknownKeys.join('、')}。`);
  }

  return {
    ok: true,
    profile: {
      schemaVersion: SAVE_SCHEMA_VERSION,
      contentVersion: ctx.contentVersion,
      revision: Math.max(0, Math.trunc(finiteOr(source.revision, 0))),
      currencies,
      level,
      inventory,
      decks,
      activeDeckId,
      gacha,
      shop,
      campaign,
      mazeRun: null,
      settings,
      settledBattleIds,
    },
    issues,
    warnings,
  };
}

export interface LegacyPlan {
  readonly previews: readonly LegacyImportPreview[];
  readonly transaction: Omit<EconomyTransaction, 'operationId'>;
  readonly deck: Deck | null;
  readonly summary: readonly string[];
}

/** 旧版三份文件 → 预览 + 一笔可提交的增量事务。 */
export function planLegacyImport(
  files: readonly { readonly format: SaveFormat; readonly raw: unknown }[],
  sources: ImportSources,
): LegacyPlan {
  const previews: LegacyImportPreview[] = [];
  const inventoryDelta: Record<string, number> = {};
  const currencyDelta: { gold?: number; crystal?: number; badge?: number } = {};
  let deck: Deck | null = null;

  for (const file of files) {
    if (file.format === 'legacy-inventory') {
      const preview = previewInventory(file.raw, sources);
      previews.push(preview);
      for (const entry of preview.mapped) {
        inventoryDelta[entry.cardId] = (inventoryDelta[entry.cardId] ?? 0) + 1;
      }
    } else if (file.format === 'legacy-profile') {
      const preview = previewProfile(file.raw);
      previews.push(preview);
      currencyDelta.gold = (currencyDelta.gold ?? 0) + (preview.currencyDelta?.gold ?? 0);
      currencyDelta.crystal = (currencyDelta.crystal ?? 0) + (preview.currencyDelta?.crystal ?? 0);
      currencyDelta.badge = (currencyDelta.badge ?? 0) + (preview.currencyDelta?.badge ?? 0);
    } else if (file.format === 'legacy-deck') {
      const preview = previewDeck(file.raw, sources);
      previews.push(preview);
      const cardIds = preview.mapped.map((entry) => entry.cardId).slice(0, DECK_LIMIT);
      if (cardIds.length > 0) {
        deck = { id: 'legacy-import', name: '旧存档卡组', cardIds, updatedAt: new Date(0).toISOString() };
      }
    }
  }

  const summary: string[] = [];
  const cardCount = Object.values(inventoryDelta).reduce((sum, count) => sum + count, 0);
  if (cardCount > 0) {
    summary.push(`获得 ${cardCount} 张卡（${Object.keys(inventoryDelta).length} 种）`);
  }
  if ((currencyDelta.gold ?? 0) > 0) {
    summary.push(`+${currencyDelta.gold} 金币`);
  }
  if ((currencyDelta.crystal ?? 0) > 0) {
    summary.push(`+${currencyDelta.crystal} 水晶`);
  }
  if ((currencyDelta.badge ?? 0) > 0) {
    summary.push(`+${currencyDelta.badge} 徽章`);
  }
  if (deck) {
    summary.push(`导入 1 套卡组（${deck.cardIds.length} 张，单独保存）`);
  }

  return { previews, transaction: { currencyDelta, inventoryDelta }, deck, summary };
}
