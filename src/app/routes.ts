/**
 * 路由表。
 *
 * 不引入路由库（PLAN 第 7 节：不预先引入大型插件框架）——这里就是一个字符串联合
 * 加一个 `useState`。屏幕是**挂载/卸载**而不是堆叠的，所以没有历史栈，
 * 也不需要 URL 同步。
 *
 * 与 P1–P3 时期相比只有两点变化：默认落在 `hub`（以前是数据自检），
 * 以及新增了游戏侧的六个屏幕。`probe` 与 `viewer` 两个开发工具留在导航里，
 * 因为既有浏览器用例靠名字点它们。
 */

export type RouteId =
  | 'hub'
  | 'campaign'
  | 'gacha'
  | 'collection'
  | 'deck'
  | 'shop'
  | 'settings'
  | 'battle'
  | 'probe'
  | 'viewer';

export interface RouteMeta {
  readonly id: RouteId;
  readonly label: string;
  readonly hint: string;
  /** 开发工具单独标出来，不跟游戏入口混在一起。 */
  readonly dev?: boolean;
}

/** 导航栏顺序。主菜单排在最前。 */
export const ROUTES: readonly RouteMeta[] = [
  { id: 'hub', label: '主菜单', hint: '回到主界面' },
  { id: 'campaign', label: '战役', hint: '三章十二关' },
  { id: 'gacha', label: '抽卡', hint: '八个卡池' },
  { id: 'collection', label: '图鉴', hint: '已拥有的卡牌' },
  { id: 'deck', label: '组卡', hint: '编辑出战卡组' },
  { id: 'shop', label: '商店', hint: '本日货架' },
  { id: 'probe', label: '数据自检', hint: '确认导入的数据被应用读到', dev: true },
  { id: 'viewer', label: '实验台', hint: '手动触发卡牌特性与攻击特效', dev: true },
];
