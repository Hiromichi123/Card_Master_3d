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
  | 'fusion'
  | 'collection'
  | 'deck'
  | 'shop'
  /** 选择对战模式。旧版 `battle_menu.py`，从主菜单的「进入战斗」进。 */
  | 'battlemenu'
  /** 28 张候选交替选卡 → 同机双人战桌。 */
  | 'localBattle'
  /** 限时活动模式（活动大厅）。旧版 `activity/activity_scene.py`。 */
  | 'activity'
  /** 迷宫第一层。旧版 `activity/maze_scene.py`，从活动大厅的第一张卡进。 */
  | 'maze'
  /** 活动商店。与『商店』同一块屏、不同货架，从活动大厅进。 */
  | 'activityShop'
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
  { id: 'fusion', label: '融合工坊', hint: '五槽祭坛，五张换一张' },
  /*
    「组卡」改名「配置」，并移到图鉴**之前**：先决定带什么上场，再回头清点自己有什么，
    这个顺序和玩家实际的动线一致。`RouteId` 仍是 `'deck'`——改名只动标签，
    所有按 id 的分支（`App.tsx`、`HubScene`）都不用跟着改。
  */
  { id: 'deck', label: '配置', hint: '编辑当前出战卡组' },
  { id: 'collection', label: '图鉴', hint: '已拥有的卡牌' },
  { id: 'shop', label: '商店', hint: '本日货架' },
  { id: 'probe', label: '数据自检', hint: '确认导入的数据被应用读到', dev: true },
  { id: 'viewer', label: '实验台', hint: '手动触发卡牌特性与攻击特效', dev: true },
];
