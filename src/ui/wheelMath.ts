/**
 * 活动大厅滚轮（倾斜立牌）的位置算术。
 *
 * 抽卡主界面那边有一套自己的同名算法（`rendering/gacha/menuLayout.ts` 的
 * `DASHBOARD_STEP` / `dashboardSelection`）。两处**刻意保持独立**：
 * 用户明确要求这一轮不动抽卡，所以没有把抽卡那套抽出来共用。
 * 两边的数字碰巧一致（步距 140、中线 750），改这里不影响抽卡。
 */

/** 相邻两格在设计空间里的间距。 */
export const WHEEL_STEP = 140;

/** 选项在设计单位里的高度（与 CSS 里的 `height` 必须一致）。 */
export const WHEEL_ITEM_HEIGHT = 120;

/**
 * 选中行的中线离舞台顶边多远。
 *
 * **必须由舞台高度推出来**：选中项固定在正中，所以中线 = 舞台高 / 2。
 * 写死成 750 只在舞台恰好 1620 高时成立——活动大厅的舞台比这矮，
 * 写死会让选中项偏出可视区（那正是「显示不全」的来源之一）。
 */
export function wheelBaseTop(stageHeight: number): number {
  return Math.round(stageHeight / 2 - WHEEL_ITEM_HEIGHT / 2);
}

/** 某个选项的顶边（设计单位）。 */
export function wheelTop(index: number, offset: number, baseTop: number): number {
  return baseTop + index * WHEEL_STEP - offset;
}

/** 从已拖动的位移反推该吸附到哪一格。 */
export function wheelSelection(offset: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round(offset / WHEEL_STEP)));
}

/** 夹在合法区间内的偏移量。 */
export function clampOffset(offset: number, count: number): number {
  return Math.max(0, Math.min((count - 1) * WHEEL_STEP, offset));
}
