import { useEffect, useRef, type RefObject } from 'react';

import { damp } from '../rendering/anim/motion';
import { useSettingsStore } from '../state/settingsStore';

/**
 * 视差背景：鼠标偏离屏幕中心多少，背景就往反方向偏多少。
 *
 * 照旧版 `ui/background.py` 的 `ParallaxBackground`：
 * 偏移量 = 鼠标相对中心的归一化位置 × 最大偏移（**边缘处 ±50px**），
 * 再用一个阻尼跟过去（旧版是 `offset += (target - offset) * 5 * dt`，
 * 这里的 `damp` 是同一件事的与帧率无关的写法）。
 *
 * 写成钩子而不是塞进主菜单：这是「背景跟着鼠标动」这一件事的完整实现，
 * 里面的性能取舍也是通用的——**只在指针移动时启动 rAF，收敛后自己停下**，
 * 静止的画面一帧都不跑（与 `useFoilPointer` 同一套做法）。
 * 一直挂着 `pointermove` 监听、每帧重算一遍，才是这类效果常见的浪费。
 *
 * 把偏移写成 CSS 变量（`--parallax-x/y`）而不是直接改 `transform`：
 * 背景元素的 `transform` 留给样式表（那里还有缩放），变量只承载「动了多少」。
 */
export function useParallax(maxOffsetPx = 50, rate = 5): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduceMotion = useSettingsStore((state) => state.reduceMotion);

  useEffect(() => {
    const element = ref.current;
    if (!element || reduceMotion) {
      return;
    }

    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    let raf = 0;
    let last = 0;

    const write = (): void => {
      element.style.setProperty('--parallax-x', `${current.x.toFixed(2)}px`);
      element.style.setProperty('--parallax-y', `${current.y.toFixed(2)}px`);
    };

    const frame = (now: number): void => {
      const delta = last === 0 ? 1 / 60 : Math.min((now - last) / 1000, 0.05);
      last = now;
      current.x = damp(current.x, target.x, rate, delta);
      current.y = damp(current.y, target.y, rate, delta);
      write();

      const settled =
        Math.abs(current.x - target.x) < 0.05 && Math.abs(current.y - target.y) < 0.05;
      if (settled) {
        current.x = target.x;
        current.y = target.y;
        write();
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    const start = (): void => {
      if (raf === 0) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    const onMove = (event: PointerEvent): void => {
      const halfWidth = window.innerWidth / 2;
      const halfHeight = window.innerHeight / 2;
      // 偏离中心越远偏移越大，边缘处正好是 ±maxOffset
      target.x = ((event.clientX - halfWidth) / halfWidth) * maxOffsetPx;
      target.y = ((event.clientY - halfHeight) / halfHeight) * maxOffsetPx;
      start();
    };

    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf !== 0) {
        cancelAnimationFrame(raf);
      }
    };
  }, [maxOffsetPx, rate, reduceMotion]);

  return ref;
}
