/**
 * 时间。
 *
 * **领域层里唯一能拿到「现在」的地方。** 其余模块一律通过参数收到 `Clock`，
 * 于是它们不 import `Date`、不读系统时间，在 node 测试里可以注入固定日期。
 *
 * 这不是洁癖：商店货架、每日刷新、奖励去重全都跟日期有关，
 * 领域里任何一处直接 `new Date()` 都会让浏览器用例变成「今天恰好是什么货架」，
 * 迟早随机失败。
 */

/** 取当前时间。生产用 `systemClock`，测试与开发期覆盖注入固定值。 */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** 从固定日期构造一个 `Clock`。开发期用 `?day=YYYYMMDD` 覆盖。 */
export function fixedClock(date: Date): Clock {
  return () => new Date(date.getTime());
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * 本地日历的日键，`YYYYMMDD`。
 *
 * 用**本地**日历而不是 UTC：商店按日刷新是给玩家看的，
 * UTC 会让东八区的玩家在早上八点看到货架换掉。
 */
export function dayKeyOf(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

/** 解析 `YYYYMMDD`。格式不对返回 `null`，不抛——它来自 URL 参数。 */
export function parseDayKey(key: string): Date | null {
  if (!/^\d{8}$/.test(key)) {
    return null;
  }
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(4, 6));
  const day = Number(key.slice(6, 8));
  const date = new Date(year, month - 1, day);
  // 反查一遍，挡住 20260230 这种「格式对但日期不存在」的输入
  return dayKeyOf(date) === key ? date : null;
}
