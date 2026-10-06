import { useCallback, useEffect, useRef, useState } from 'react';

import { backgroundUrl } from '../data/assets';
import type { GachaPool } from '../data';
import {
  WHEEL_SPREAD_DEG,
  activeIndex,
  snapOffset,
  stepOffset,
  wheelSlots,
} from '../rendering/gacha/wheel';

/**
 * 卡池轮盘。
 *
 * 照旧版 `scenes/gacha/gacha_menu.py` 的手感：整排池子斜着像一列立牌，
 * 中间的放大高亮，拖动/滚轮/方向键切换，松手**吸附**到最近的一个，
 * 换池时背景交叉淡换。
 *
 * **用 DOM 不用 Canvas**：
 * 1. 演出阶段已经占一个 WebGL2 上下文，浏览卡池时再挂一个，等于在核显机器上常态两个；
 * 2. 池名、价格是中文排版（`V-CARD-9` 要求这类文字走 DOM）；
 * 3. 吸附/居中/淡换全是可断言的 DOM 状态，浏览器用例不用做像素推断；
 * 4. 8 个池是可聚焦、有名字的元素，方向键可达。
 *
 * **拖动期间是 React 状态重渲染**（8 个元素，一帧一次），不是写 CSS 变量：
 * 每张卡的位移/缩放要从角度算 `sin`/`cos`，而 CSS 的 `calc` 里没有三角函数，
 * 把角度写进变量也还是得有人算位置——那个人只能是 JS。8 个 div 的重渲染代价可以忽略。
 */
export interface GachaWheelProps {
  readonly pools: readonly GachaPool[];
  readonly activeIndex: number;
  /** 吸附到某个池之后回调（拖动中不回调）。 */
  readonly onSelect: (index: number) => void;
  /** 系统关了动效：不呼吸、不淡换。 */
  readonly still: boolean;
}

/** 拖动灵敏度：一像素对应多少度。太小拖不动，太大一碰就飞过去。 */
const DEG_PER_PX = 0.22;

export function GachaWheel({ pools, activeIndex: selected, onSelect, still }: GachaWheelProps) {
  const [offsetDeg, setOffsetDeg] = useState(() => selected * WHEEL_SPREAD_DEG);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startOffset: number } | null>(null);

  /*
    背景的两层。`top` 指向当前**显示**的那一层，另一层留着放下一张图——
    换池时先写进暗的那层再翻上来，任何一帧都有图可显示。
  */
  const [backdrop, setBackdrop] = useState<{ a: string | null; b: string | null; top: 'a' | 'b' }>(
    () => ({ a: backgroundUrl(pools[selected]?.bgType ?? '') ?? null, b: null, top: 'a' }),
  );

  /*
    外部改了选中项（例如键盘在别处切换）时把轮盘转过去。
    拖动过程中不受影响——那时外部的 selected 还没变。
  */
  useEffect(() => {
    setOffsetDeg(selected * WHEEL_SPREAD_DEG);
  }, [selected]);

  useEffect(() => {
    const url = backgroundUrl(pools[selected]?.bgType ?? '') ?? null;
    setBackdrop((current) => {
      if (current.top === 'a') {
        return current.a === url ? current : { a: current.a, b: url, top: 'b' };
      }
      return current.b === url ? current : { a: url, b: current.b, top: 'a' };
    });
  }, [selected, pools]);

  const commitOffset = useCallback(
    (next: number) => {
      const snapped = snapOffset(next, pools.length);
      setOffsetDeg(snapped);
      const index = activeIndex(pools.length, snapped);
      if (index >= 0 && index !== selected) {
        onSelect(index);
      }
    },
    [onSelect, pools.length, selected],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    dragRef.current = { startX: event.clientX, startOffset: offsetDeg };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    // 往右拖，内容跟着往右走 → 偏移量减少
    setOffsetDeg(drag.startOffset - (event.clientX - drag.startX) * DEG_PER_PX);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    commitOffset(offsetDeg);
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    // 一格一格走，不跟滚轮的分辨率（触控板一次能报几十个事件）
    const delta = event.deltaY > 0 || event.deltaX > 0 ? 1 : -1;
    commitOffset(stepOffset(offsetDeg, pools.length, delta));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      commitOffset(stepOffset(offsetDeg, pools.length, -1));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      commitOffset(stepOffset(offsetDeg, pools.length, 1));
    }
  };

  const slots = wheelSlots(pools.length, offsetDeg);

  return (
    <div className={still ? 'wheel wheel--still' : 'wheel'}>
      {/*
        背景两层叠着**交叉淡换**：换池时把新图放到当前没显示的那一层、再翻上来。

        写成一层换 `src` 的话，新图解码那一帧是空的，整个轮盘会闪一下。
        两层永远不会同时为空——「翻开」只是改透明度。
      */}
      <div className="wheel__backdrops" aria-hidden="true">
        <div
          className={backdrop.top === 'a' ? 'wheel__bg wheel__bg--on' : 'wheel__bg'}
          style={{ backgroundImage: backdrop.a ? `url(${backdrop.a})` : undefined }}
        />
        <div
          className={backdrop.top === 'b' ? 'wheel__bg wheel__bg--on' : 'wheel__bg'}
          style={{ backgroundImage: backdrop.b ? `url(${backdrop.b})` : undefined }}
        />
      </div>

      <div
        ref={stageRef}
        className="wheel__stage"
        role="listbox"
        aria-label="卡池"
        aria-activedescendant={`wheel-option-${selected}`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        {slots.map((slot) => {
          const pool = pools[slot.index];
          if (!pool) {
            return null;
          }
          return (
            <div
              key={pool.id}
              id={`wheel-option-${slot.index}`}
              role="option"
              aria-selected={slot.active}
              data-pool-id={pool.id}
              data-angle={slot.angleDeg.toFixed(2)}
              className={
                slot.active ? 'wheel__card wheel__card--on' : 'wheel__card'
              }
              style={{
                transform: `translateX(${slot.x.toFixed(1)}px) translateZ(${slot.z.toFixed(1)}px) rotateY(${(slot.angleDeg * 0.55).toFixed(2)}deg) scale(${slot.scale.toFixed(3)})`,
                opacity: slot.opacity,
                // 看不见的池不该抢点击（它们叠在一起，点到的是最上面那个）
                pointerEvents: slot.opacity <= 0 ? 'none' : 'auto',
              }}
              onClick={() => {
                if (!slot.active) {
                  commitOffset(slot.index * WHEEL_SPREAD_DEG);
                }
              }}
            >
              <span className="wheel__name">{pool.name}</span>
              <span className="wheel__price">
                单抽 {pool.singleCost}
                <span className="wheel__currency">{pool.currency === 'gold' ? '金币' : '水晶'}</span>
                ·十连 {pool.tenCost}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
