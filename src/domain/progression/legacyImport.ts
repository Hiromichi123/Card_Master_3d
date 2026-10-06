/**
 * 旧存档导入的**预览**。
 *
 * 导入是用户主动的一次操作（PLAN 第 6 节）：选文件 → 看到「能认出来的」与
 * 「认不出来的」→ 自己决定要不要提交。所以这个模块只做纯函数式的转换，
 * **不读文件、不写文件、不碰 `File`**——调用方把已经解析好的 JSON 传进来。
 *
 * 旧版的存档路径是 `assets/outputs/<稀有度>/<编号>.png`，直接映射成
 * `<稀有度>_<编号>` 就是稳定的 cardId。映射不出来的（改名、缺文件、格式不对）
 * 一律进 `unknown` 并带上原因，**不静默丢弃**——那正是「导入之后少了 30 张卡
 * 但没人知道为什么」的来源。
 */

import type { Currencies } from './types';
import type { LegacyImportPreview } from './types';

/** 旧版路径 → cardId。只认 `assets/outputs/<rarity>/<stem>.<ext>` 这一种形状。 */
export function cardIdFromLegacyPath(rawPath: string): string | null {
  const normalized = rawPath.replace(/\\/g, '/');
  const match = /(?:^|\/)outputs\/([^/]+)\/([^/]+?)\.[A-Za-z0-9]+$/.exec(normalized);
  if (!match) {
    return null;
  }
  const [, rarity, stem] = match;
  if (!rarity || !stem) {
    return null;
  }
  return `${rarity}_${stem}`;
}

export interface ImportSources {
  /** 认识哪些 cardId。用来判断映射结果是否真的存在。 */
  readonly knownCardIds: ReadonlySet<string>;
}

function mapPaths(
  paths: readonly string[],
  known: ReadonlySet<string>,
): Pick<LegacyImportPreview, 'mapped' | 'unknown'> {
  const mapped: { rawPath: string; cardId: string }[] = [];
  const unknown: { rawPath: string; reason: string }[] = [];

  for (const rawPath of paths) {
    const cardId = cardIdFromLegacyPath(rawPath);
    if (!cardId) {
      unknown.push({ rawPath, reason: '路径形状不认识' });
    } else if (!known.has(cardId)) {
      unknown.push({ rawPath, reason: `映射到 ${cardId}，但卡库里没有这张` });
    } else {
      mapped.push({ rawPath, cardId });
    }
  }
  return { mapped, unknown };
}

/**
 * 旧版 `data/inventory.json`。
 *
 * 形状：`{ cards: [{path, rarity}], card_count: {path: int}, ... }`。
 * **用 `cards` 而不是 `card_count`**：前者是完整多重集（重复的卡重复出现），
 * 后者是它的派生计数；两者不一致时以前者为准（旧版 `remove_card` 会改前者、
 * 有时忘了改后者）。
 */
export function previewInventory(raw: unknown, sources: ImportSources): LegacyImportPreview {
  const payload = raw as { cards?: unknown };
  const paths: string[] = [];
  if (Array.isArray(payload?.cards)) {
    for (const entry of payload.cards) {
      const path = (entry as { path?: unknown })?.path;
      if (typeof path === 'string') {
        paths.push(path);
      }
    }
  }
  return {
    sourceKind: 'inventory',
    sourcePath: 'data/inventory.json',
    ...mapPaths(paths, sources.knownCardIds),
  };
}

/** 旧版 `data/profile.json`：货币与等级。`golds`/`crystals`/`badges` 是旧名字。 */
export function previewProfile(raw: unknown): LegacyImportPreview {
  const payload = raw as Record<string, unknown>;
  const num = (key: string): number => {
    const value = payload?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  };
  const currencyDelta: Partial<Currencies> = {
    gold: num('golds'),
    crystal: num('crystals'),
    badge: num('badges'),
  };
  return {
    sourceKind: 'profile',
    sourcePath: 'data/profile.json',
    mapped: [],
    unknown: [],
    currencyDelta,
  };
}

/** 旧版 `data/deck/player_deck/deck.json`：`{ deck: [{path, rarity}] }`。 */
export function previewDeck(raw: unknown, sources: ImportSources): LegacyImportPreview {
  const payload = raw as { deck?: unknown };
  const paths: string[] = [];
  if (Array.isArray(payload?.deck)) {
    for (const entry of payload.deck) {
      // 早期存档直接存字符串路径，后期才是对象
      if (typeof entry === 'string') {
        paths.push(entry);
      } else {
        const path = (entry as { path?: unknown })?.path;
        if (typeof path === 'string') {
          paths.push(path);
        }
      }
    }
  }
  return {
    sourceKind: 'deck',
    sourcePath: 'data/deck/player_deck/deck.json',
    ...mapPaths(paths, sources.knownCardIds),
  };
}

/** 预览里有没有值得提交的东西。 */
export function previewImpact(preview: LegacyImportPreview): {
  readonly cards: readonly { cardId: string; count: number }[];
  readonly currency: Partial<Currencies>;
  readonly hasUnknown: boolean;
} {
  const counts = new Map<string, number>();
  for (const entry of preview.mapped) {
    counts.set(entry.cardId, (counts.get(entry.cardId) ?? 0) + 1);
  }
  return {
    cards: [...counts].map(([cardId, count]) => ({ cardId, count })),
    currency: preview.currencyDelta ?? {},
    hasUnknown: preview.unknown.length > 0,
  };
}
