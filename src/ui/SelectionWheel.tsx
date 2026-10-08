import { useEffect, useRef, useState } from 'react';

import { clampOffset, wheelBaseTop, wheelSelection, wheelTop, WHEEL_STEP } from './wheelMath';

/**
 * 倾斜立牌滚轮：一列斜着的卡片，选中项固定在正中并放大。
 *
 * 这是**活动大厅**（选活动模式）用的那一份，手感照抽卡主界面的卡池轮盘做
 * （`.gacha-dashboard`，在 `ui/GachaWheel.tsx` 里自成一体的那一套）。
 * 两处**刻意没有合并**：用户要求这一轮不动抽卡，所以抽卡那边保持原样，
 * 这边另起一个组件、`variant` 传 `activity-wheel`。
 *
 * ## 类名是**契约**，不要随手改
 *
 * 皮肤挂在 `variant` 派生的类名上（`.menu .activity-wheel__option` 等，
 * 见 `global.css`）。改类名等于把外观拆掉。
 *
 * 行为：点选、拖动吸附、方向键 / Home / End。**滚轮不在这里**——
 * 滚轮由 `usePageWheel` 挂在整屏上（见那个文件），所以指针不必对准轮盘。
 */
export interface WheelItem {
  readonly id: string;
  readonly name: string;
  /** 未实现的项：右上加「待开发」角标。 */
  readonly coming?: boolean | undefined;
  /** 额外挂到按钮上的 `data-*`，例如抽卡页的 `data-pool-id`。 */
  readonly data?: Record<string, string | number> | undefined;
}

export interface SelectionWheelProps {
  readonly items: readonly WheelItem[];
  readonly activeIndex: number;
  readonly onSelect: (index: number) => void;
  readonly still: boolean;
  /** 皮肤前缀：`gacha-dashboard` / `activity-wheel`。 */
  readonly variant: string;
  readonly ariaLabel: string;
  /** 选项下方的一行小字（活动大厅用来标「暂未开放」）。 */
  readonly renderBadge?: ((item: WheelItem) => React.ReactNode) | undefined;
  /**
   * 位移的单位。
   *
   * 滚轮的 `top` 由 JS 算成**设计单位**的数字，但两个调用方所在的坐标系不同：
   * 抽卡页整帧被 `transform: scale()` 缩放过，写 `px` 就跟着缩；
   * 活动大厅的 `.menu__stage` 不缩放、是靠 `calc(N * var(--ui))` 换算的，
   * 所以那一边要传 `'var(--ui)'`，`top` 才会写成 `calc(750 * var(--ui))`。
   */
  readonly lengthUnit?: string | undefined;
  /**
   * 舞台在设计单位里的高度。**必须与 CSS 里 `.xxx-wheel` 的 `height` 一致**：
   * 它同时决定「拖动换算系数」与「选中行的中线在哪」（见 `wheelBaseTop`）。
   */
  readonly stageHeight: number;
}

export function SelectionWheel({
  items, activeIndex, onSelect, still, variant, ariaLabel, renderBadge,
  lengthUnit = 'px', stageHeight,
}: SelectionWheelProps) {
  const [offset, setOffset] = useState(activeIndex * WHEEL_STEP);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ y: number; offset: number; option: number | null } | null>(null);
  useEffect(() => { setOffset(activeIndex * WHEEL_STEP); }, [activeIndex]);

  const baseTop = wheelBaseTop(stageHeight);
  const length = (value: number): string =>
    lengthUnit === 'px' ? `${value}px` : `calc(${value} * ${lengthUnit})`;

  const select = (index: number): void => {
    const next = Math.max(0, Math.min(items.length - 1, index));
    setOffset(next * WHEEL_STEP);
    onSelect(next);
  };

  return (
    <div className={`wheel ${variant}${still ? ' wheel--still' : ''}`}>
      <div
        className={`wheel__stage ${variant}__stage`}
        role="listbox"
        aria-label={ariaLabel}
        aria-activedescendant={`wheel-option-${activeIndex}`}
        tabIndex={0}
        onKeyDown={(event) => {
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            select(
              event.key === 'Home' ? 0
                : event.key === 'End' ? items.length - 1
                : activeIndex + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1),
            );
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const option = (event.target as HTMLElement).closest<HTMLElement>('[data-wheel-index]');
          drag.current = { y: event.clientY, offset, option: option ? Number(option.dataset.wheelIndex) : null };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          // 把客户端像素换算回设计单位：舞台高（设计单位）就是那个换算系数
          const scale = event.currentTarget.getBoundingClientRect().height / stageHeight;
          setOffset(clampOffset(
            drag.current.offset - (event.clientY - drag.current.y) / Math.max(0.01, scale),
            items.length,
          ));
        }}
        onPointerUp={(event) => {
          const start = drag.current;
          if (!start) return;
          drag.current = null;
          setDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          // 位移很小 = 点击而不是拖动：点哪张就选哪张
          select(
            Math.abs(event.clientY - start.y) < 6 && start.option !== null
              ? start.option
              : wheelSelection(offset, items.length),
          );
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
          setOffset(activeIndex * WHEEL_STEP);
        }}
      >
        <div className={`${variant}__selection`} aria-hidden="true" />
        {items.map((item, index) => (
          <button
            key={item.id}
            id={`wheel-option-${index}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={index === activeIndex}
            data-wheel-id={item.id}
            data-wheel-index={index}
            {...item.data}
            className={`wheel__card ${variant}__option${index === activeIndex ? ' wheel__card--on' : ''}`}
            style={{ top: length(wheelTop(index, offset, baseTop)), transition: dragging || still ? 'none' : undefined }}
            onClick={() => select(index)}
          >
            <span className="wheel__name">{item.name}</span>
            {renderBadge?.(item)}
          </button>
        ))}
      </div>
    </div>
  );
}
