import { assetManifest } from '../data/assets';
import type { RouteId } from '../app/routes';

/**
 * 菜单海报轮播的数据。
 *
 * 抽出来是因为**主菜单与对战模式菜单共用同一套海报与同一张跳转表**
 * （旧版 `menu.py` 与 `battle_menu.py` 里各抄了一份 `poster_to_scene`，
 * 而两份的内容是一样的：0 → 抽卡，1 → 对战菜单）。
 */
export function menuPosters(): readonly string[] {
  const poster = assetManifest.shared.poster;
  const pick = (keys: readonly string[]): string[] =>
    keys
      .map((key) => poster[key]?.url)
      .filter((url): url is string => typeof url === 'string' && url.length > 0);

  // manifest 的 poster 里有三类：`poster001/002`（旧版那两张活动海报，
  // 轮播本来就是给它们做的）、`chapter_*_enter`、以及 12 张关卡海报。
  // 取前两类共 5 张；一张都没有时退回全部，不留空。
  const preferred = pick([
    'poster001',
    'poster002',
    'chapter_1_enter',
    'chapter_2_enter',
    'chapter_3_enter',
  ]);
  if (preferred.length > 0) {
    return preferred;
  }
  return Object.keys(poster)
    .map((key) => poster[key]?.url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
}

/**
 * 第几张海报通向哪个页面（旧版 `poster_to_scene = {0: "gacha_menu", 1: "battle_menu"}`）。
 *
 * 旧版按**下标**映射两张海报；这里扩到五张，前两张活动海报通向抽卡，
 * 后面三张章节图通向战役。
 */
export const POSTER_ROUTES: readonly RouteId[] = [
  'gacha',
  'gacha',
  'campaign',
  'campaign',
  'campaign',
];
