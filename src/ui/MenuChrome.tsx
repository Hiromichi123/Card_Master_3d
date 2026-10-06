import type { ReactNode } from 'react';

import { ComingSoonBadge } from './ComingSoonBadge';
import { DesignStage } from './DesignStage';

/**
 * 三个菜单（主菜单 / 选择对战模式 / 限时活动模式）共用的外壳。
 *
 * 旧版这三个场景是各写一遍的（`scenes/menu.py`、`scenes/battle_menu.py`、
 * `scenes/activity/activity_scene.py`），但外壳**完全一致**：
 * 一张视差背景、居中偏上的金色标题（+ 可选副标题）、左上角的货币与等级、
 * 以及「2880 × 1800 设计空间 + 整体等比缩放」的坐标系。
 * 抽出来一份，三处的比例才不会有哪一处先漂掉。
 *
 * 设计空间与缩放的理由见 `HubScene` 的注释（旧版 `config.py` 的
 * `AUTO_SCALE = min(比例)`）。这里只负责把框搭好，内容由各屏自己排。
 */
export interface MenuChromeProps {
  readonly backgroundUrl: string | null;
  readonly title: string;
  /** 标题下面的一行说明（活动大厅有，另两个没有）。 */
  readonly subtitle?: string | undefined;
  /** 标题之下的补充信息，例如主菜单的「当前出战」。 */
  readonly note?: ReactNode;
  /** 左上角的货币与等级。 */
  readonly status?: ReactNode;
  /** 设计空间里的内容：按钮列、特性卡、海报…… */
  readonly children: ReactNode;
  /** 标题字号（设计单位）。主菜单/对战模式是 96，活动大厅是 86。 */
  readonly titleSize?: number;
}

export function MenuChrome({
  backgroundUrl,
  title,
  subtitle,
  note,
  status,
  children,
  titleSize = 96,
}: MenuChromeProps) {
  return (
    <DesignStage backgroundUrl={backgroundUrl}>
      {status && <div className="menu__status">{status}</div>}

      <h1 className="menu__title" style={{ ['--title-size' as string]: titleSize }}>
        {title}
      </h1>
      {subtitle && <p className="menu__subtitle">{subtitle}</p>}
      {note}

      {children}
    </DesignStage>
  );
}

/** 一个菜单入口。三个菜单的按钮长得一样，样式由调用方给的 CSS 变量决定。 */
export interface MenuEntryProps {
  readonly label: string;
  readonly hint: string;
  /** 悬停时亮起的颜色（旧版每个入口一个色）。 */
  readonly glow: string;
  /** 第几行（阶梯：每往下一行左移）。 */
  readonly row: number;
  /** 常态就亮着（旧版 `persistent_glow`，对战菜单用它标「活动模式」）。 */
  readonly persistent?: boolean;
  readonly coming?: boolean;
  readonly onClick: () => void;
}

export function MenuEntryButton({
  label,
  hint,
  glow,
  row,
  persistent = false,
  coming = false,
  onClick,
}: MenuEntryProps) {
  return (
    <button
      type="button"
      className={
        persistent ? 'menu__entry menu__entry--persistent' : 'menu__entry'
      }
      style={{ ['--row' as string]: row, ['--glow' as string]: glow }}
      title={coming ? `${hint}（尚未实现）` : hint}
      onClick={onClick}
    >
      {/* 悬停时亮起的三层同心光晕；常态透明（`--persistent` 的除外） */}
      <span className="menu__entry-glow" aria-hidden="true" />
      <span className="menu__entry-tri menu__entry-tri--left" aria-hidden="true" />
      <span className="menu__entry-label">
        {label}
        {/* 明确标出「还没做」，而不是把入口藏起来或做成灰的 */}
        {coming && <ComingSoonBadge />}
      </span>
      <span className="menu__entry-tri menu__entry-tri--right" aria-hidden="true" />
    </button>
  );
}
