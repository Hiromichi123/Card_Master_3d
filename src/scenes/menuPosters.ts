import { assetManifest, backgroundUrl } from '../data/assets';
import type { RouteId } from '../app/routes';

export interface MenuPoster {
  readonly id: string;
  readonly url: string;
  readonly route: RouteId;
  readonly title: string;
  readonly caption?: string;
  readonly badge?: string;
}

/** 海报图片与跳转始终绑定后过滤，缺一张素材不会把后面海报跳到错误页面。 */
export function menuPosterEntries(): readonly MenuPoster[] {
  const posters = assetManifest.shared.poster;
  const candidates: readonly (Omit<MenuPoster, 'url'> & { readonly url: string | null | undefined })[] = [
    { id: 'abyss', url: backgroundUrl('bg/activity_abyss_bg2'), route: 'abyss', title: '深渊降临', caption: '越过裂隙，直面无尽黑暗', badge: 'NEW' },
    { id: 'poster001', url: posters['poster001']?.url, route: 'gacha', title: '活动抽卡' },
    { id: 'poster002', url: posters['poster002']?.url, route: 'gacha', title: '限定卡池' },
    { id: 'chapter_1_enter', url: posters['chapter_1_enter']?.url, route: 'campaign', title: '第一章战役' },
    { id: 'chapter_2_enter', url: posters['chapter_2_enter']?.url, route: 'campaign', title: '第二章战役' },
    { id: 'chapter_3_enter', url: posters['chapter_3_enter']?.url, route: 'campaign', title: '第三章战役' },
  ];
  const entries = candidates.filter((entry): entry is MenuPoster => typeof entry.url === 'string' && entry.url.length > 0);
  if (entries.length) return entries;
  return Object.entries(posters).filter(([, entry]) => Boolean(entry.url))
    .map(([id, entry]) => ({ id, url: entry.url, route: 'campaign', title: '单人战役' }));
}

/** 登录过场只需预热图片，不复制一套与海报顺序有关的路由表。 */
export function menuPosters(): readonly string[] {
  return menuPosterEntries().map(entry => entry.url);
}
