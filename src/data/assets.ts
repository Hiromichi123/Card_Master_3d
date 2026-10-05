import type { TextureTier } from '../services/AssetManager';

import manifestJson from './assets.manifest.json';

/**
 * 资源 manifest 的类型化访问（施工清单 P0-13 的产物）。
 *
 * manifest 由 `scripts/prepare-assets.py` 生成，是**唯一**的「资产 ID → URL」映射。
 * 运行时不扫描目录、不靠图片存在与否推断卡牌数据
 * （`docs/LEGACY_AUDIT.md` 第 5 节记录了这个旧问题）。
 *
 * 注意：默认只派生**切片 23 张**的卡面。非切片卡返回 `null`，
 * 由调用方决定怎么表现——不能假装它有贴图。
 */

interface FaceEntry {
  readonly url: string;
  readonly size: readonly [number, number];
  readonly bytes: number;
}

interface CardAssetEntry {
  readonly artId: string;
  readonly rarity: string;
  readonly sourceName: string;
  readonly face: Record<TextureTier, FaceEntry>;
  readonly art: FaceEntry | null;
}

interface Manifest {
  readonly contentVersion: string;
  readonly tiers: Record<TextureTier, number>;
  readonly tierMiB: Record<TextureTier, number>;
  readonly cards: Record<string, CardAssetEntry>;
  readonly shared: {
    readonly cardBack?: string;
    readonly ui: Record<string, FaceEntry>;
    readonly skill: Record<string, FaceEntry>;
    readonly poster: Record<string, FaceEntry>;
    readonly bg: Record<string, FaceEntry>;
    readonly menu: Record<string, FaceEntry>;
  };
}

const manifest = manifestJson as unknown as Manifest;

/** 公共卡背。所有卡共用一张，不按稀有度各做一份。 */
export const CARD_BACK_URL: string = manifest.shared.cardBack ?? '';

/** 卡背贴图在卡牌本地坐标下的纵横比修正用（卡背图与卡面同尺寸）。 */
export function cardFaceUrl(cardId: string, tier: TextureTier = 'battle'): string | null {
  return manifest.cards[cardId]?.face[tier]?.url ?? null;
}

/** 原画（未加边框的插画）。P4 重排卡框时使用。 */
export function cardArtUrl(cardId: string): string | null {
  return manifest.cards[cardId]?.art?.url ?? null;
}

export function hasCardTexture(cardId: string): boolean {
  return cardId in manifest.cards;
}

/** 关卡海报。manifest 的键是文件名主干，与 `stages.json` 的 posterId 后半段一致。 */
export function posterUrl(posterId: string): string | null {
  const stem = posterId.replace(/^poster\//, '');
  return manifest.shared.poster[stem]?.url ?? null;
}

/** 背景。`bgType` 形如 `bg/chapter_1_map`，manifest 键是 `chapter_1_map_bg`。 */
export function backgroundUrl(bgType: string | null | undefined): string | null {
  if (!bgType) {
    return null;
  }
  const stem = bgType.replace(/^bg\//, '');
  const candidates = [`${stem}_bg`, stem];
  for (const candidate of candidates) {
    const entry = manifest.shared.bg[candidate];
    if (entry) {
      return entry.url;
    }
  }
  return null;
}

/** 技能图标。键与旧版 `assets/skill/*.png` 的主干一致（如 `fire_ball`）。 */
export function skillIconUrl(name: string): string | null {
  return manifest.shared.skill[name]?.url ?? null;
}

/** UI 图标（金币/水晶/徽章/头像）。 */
export function uiIconUrl(name: string): string | null {
  return manifest.shared.ui[name]?.url ?? null;
}

export const assetManifest = manifest;
