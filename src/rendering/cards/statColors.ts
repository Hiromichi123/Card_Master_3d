/**
 * 攻 / 血 / 冷却的配色。
 *
 * **单独放一个文件是为了两边共用。** 战斗卡面用 Canvas 现画徽标（`statBadge.ts`），
 * 展示位的介绍栏是 DOM——同一张卡的攻击在战斗里是红的、在介绍里却是别的颜色，
 * 是玩家一眼就会看出来的不一致。取值只写这一份。
 *
 * 这里**不依赖 three**：引入 `statBadge.ts` 只为拿个色值的话，
 * 会把整套 three 拉进 DOM 那条引用链。
 */

export type StatKind = 'atk' | 'hp' | 'cd';

export interface StatColor {
  /** 数字主体的颜色。 */
  readonly fg: string;
  /** 数字外围那圈细光晕。 */
  readonly halo: string;
  /** 「刚变化过」的高亮色。 */
  readonly ring: string;
}

/**
 * **标准红 / 绿 / 蓝**。
 *
 * 攻=红、血=绿、冷却=蓝，是最不需要解释的一套约定。
 * `halo` 比主色亮一档——卡面是任意插画，只靠描边会在浅色区域糊掉，
 * 靠光晕才能在深浅两种底子上都跳出来。
 */
export const STAT_COLORS: Record<StatKind, StatColor> = {
  atk: { fg: '#ff2d2d', halo: 'rgba(255, 90, 90, 0.42)', ring: '#ffd0d0' },
  hp: { fg: '#12c24a', halo: 'rgba(70, 230, 130, 0.42)', ring: '#c4f7d6' },
  cd: { fg: '#2b6cff', halo: 'rgba(90, 150, 255, 0.42)', ring: '#cddcff' },
};

/** 取数字主色。 */
export function statColor(kind: StatKind): string {
  return STAT_COLORS[kind].fg;
}
