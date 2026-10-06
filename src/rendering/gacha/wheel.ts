/**
 * 卡池轮盘的纯计算。
 *
 * 不 import three / 不碰 DOM：这一层只回答「第 k 个池现在在哪、多大、多亮、是不是正中」，
 * 由 `GachaWheel` 把这些数写成 CSS 3D 变换。放进纯函数是有理由的——
 * 吸附、环绕、可见范围这几件事全是数学，写进组件就只能靠截图和手感来验。
 *
 * **环绕周期是 `count * spread`，不是 360°。** 8 个池、间隔 30° 一共只铺 240°，
 * 按 360° 取模的话，从第 0 个往前一格会算到第 7 个头上却落在 −120°——
 * 轮盘转到头会「卡住」而不是绕回来。
 */

/** 相邻两个池的夹角。 */
export const WHEEL_SPREAD_DEG = 30;
/** 超过这个角度就不显示了：再远的东西挤在边缘只是一团糊。 */
export const WHEEL_VISIBLE_DEG = 75;
/** 排布的半径（px），越大越平、越像一排；越小越像转盘。 */
export const WHEEL_RADIUS_PX = 620;

/** 一个池在轮盘上的位置。 */
export interface WheelSlot {
  readonly index: number;
  /** 相对正中的角度，落在 (−period/2, period/2]。0 就是正中。 */
  readonly angleDeg: number;
  /** 横向偏移（px），正值在右边。 */
  readonly x: number;
  /** 纵深偏移（px），0 是最前，负值往里退。 */
  readonly z: number;
  readonly scale: number;
  readonly opacity: number;
  /** 是不是正中那一个。 */
  readonly active: boolean;
}

/** 折到 (−180, 180]。 */
export function normalizeDeg(deg: number): number {
  return wrapHalf(deg, 360);
}

/**
 * 折到 (−period/2, period/2]。
 *
 * 末尾那个 `=== 0 ? 0` 是把 `−0` 归一成 `0`：`-14` 吸附之后会得到 `−0`，
 * 而 `−0` 写进 CSS 是 `-0deg`、写进断言是 `Object.is(-0, 0) === false`——
 * 数值上没差，读起来是莫名其妙的。
 */
function wrapHalf(value: number, period: number): number {
  const half = period / 2;
  let wrapped = value % period;
  if (wrapped <= -half) {
    wrapped += period;
  }
  if (wrapped > half) {
    wrapped -= period;
  }
  return wrapped === 0 ? 0 : wrapped;
}

/** 轮盘的环绕周期。 */
export function wheelPeriod(count: number, spreadDeg: number = WHEEL_SPREAD_DEG): number {
  return Math.max(1, count) * spreadDeg;
}

/**
 * 摊开整圈。
 *
 * `offsetDeg` 是「转盘转了多少」：它增大时每个池的角度减小，
 * 于是画面上的内容往左走，和拖动方向一致。
 */
export function wheelSlots(
  count: number,
  offsetDeg: number,
  spreadDeg: number = WHEEL_SPREAD_DEG,
  radius: number = WHEEL_RADIUS_PX,
): readonly WheelSlot[] {
  const period = wheelPeriod(count, spreadDeg);
  const slots: WheelSlot[] = [];
  for (let index = 0; index < count; index += 1) {
    const angleDeg = wrapHalf(index * spreadDeg - offsetDeg, period);
    const t = Math.min(1, Math.abs(angleDeg) / WHEEL_VISIBLE_DEG);
    const radians = (angleDeg * Math.PI) / 180;
    slots.push({
      index,
      angleDeg,
      x: Math.sin(radians) * radius,
      z: (Math.cos(radians) - 1) * radius,
      // 边际的池缩到 0.62、暗到 0.25：再小就认不出是哪张卡，再亮就会和中间那个抢注意力
      scale: 1 - 0.38 * t,
      opacity: t >= 1 ? 0 : 1 - 0.75 * t,
      active: Math.abs(angleDeg) < spreadDeg / 2,
    });
  }
  return slots;
}

/**
 * 正中那一个的下标。空轮盘返回 −1。
 *
 * 与 `wheelSlots` 里 `angleDeg` 最小的那个是同一个（同一套取模），
 * 界面上用哪个都行——单测把这条一致性也钉住了。
 */
export function activeIndex(
  count: number,
  offsetDeg: number,
  spreadDeg: number = WHEEL_SPREAD_DEG,
): number {
  if (count <= 0) {
    return -1;
  }
  const stepped = Math.round(offsetDeg / spreadDeg);
  // JS 的 % 对负数给负值，补一次正模
  return ((stepped % count) + count) % count;
}

/** 把偏移吸附到整数格：松手之后不该停在两个池中间。 */
export function snapOffset(
  offsetDeg: number,
  count: number,
  spreadDeg: number = WHEEL_SPREAD_DEG,
): number {
  const period = wheelPeriod(count, spreadDeg);
  const snapped = Math.round(offsetDeg / spreadDeg) * spreadDeg;
  // 折回一个周期内，避免滚很久之后数字变得很大（下一次吸附还要用它）
  return wrapHalf(snapped, period);
}

/** 往前往后挪一格。`delta` 为 ±1，也可以给更大的步长。 */
export function stepOffset(
  offsetDeg: number,
  count: number,
  delta: number,
  spreadDeg: number = WHEEL_SPREAD_DEG,
): number {
  return snapOffset(offsetDeg + delta * spreadDeg, count, spreadDeg);
}
