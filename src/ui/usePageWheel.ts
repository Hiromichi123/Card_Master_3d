import { useEffect, useRef, type RefObject } from 'react';

/**
 * **全页滚轮**：在容器（整屏）上滚一下就切一格。
 *
 * 与滚轮组件自己的 `onWheel` 不同，这个监听挂在整屏的根元素上——
 * 指针在页面的任何位置滚动都算数，不必先对准轮盘。
 *
 * 三处细节都不是可选的：
 *
 * 1. **`{ passive: false }` + `preventDefault()`**。默认的 wheel 监听是被动的，
 *    里面调 `preventDefault()` 会被忽略；不阻止的话页面（以及祖先滚动容器）
 *    会跟着一起滚。
 * 2. **累积阈值 + 冷却**。触控板一次划动会连发几十个 wheel 事件，
 *    每个都当成一格就会一路滚到底。这里的规则是「同方向累积超过阈值、
 *    且距上次触发超过冷却时间」才走一格。
 * 3. **换方向清零**。手抖来回滚时正负相抵，不该算作一次。
 *
 * `enabled` 为 false 时不响应（抽卡演出进行中要锁住）。
 */
export interface PageWheelOptions {
  /** 监听挂在哪个元素上。通常是这一屏的根节点。 */
  readonly ref: RefObject<HTMLElement | null>;
  readonly onStep: (delta: 1 | -1) => void;
  readonly enabled?: boolean;
  /** 触发一格所需的同方向累积滚动量（px）。 */
  readonly threshold?: number;
  /** 两次触发之间的最小间隔（ms）。 */
  readonly cooldownMs?: number;
  /**
   * 命中这个选择器的滚动**不由本钩子处理**（交给它自己的处理器）。
   *
   * 抽卡主界面用的就是这一条：滚轮组件自己带 `onWheel`，而事件会继续冒泡到
   * 整屏根节点；不排除的话指针在轮盘上滚一次会走两格。
   */
  readonly ignoreSelector?: string | undefined;
}

export function usePageWheel({
  ref,
  onStep,
  enabled = true,
  threshold = 36,
  cooldownMs = 220,
  ignoreSelector,
}: PageWheelOptions): void {
  // 回调与开关都走 ref：翻页只该发生在「滚了」的那一刻，不该因为 props 变化
  // 反复拆装监听（拆装会丢掉累积量，手感立刻变差）。
  const step = useRef(onStep);
  const active = useRef(enabled);
  const options = useRef({ threshold, cooldownMs, ignoreSelector });
  useEffect(() => {
    step.current = onStep;
    active.current = enabled;
    options.current = { threshold, cooldownMs, ignoreSelector };
  }, [onStep, enabled, threshold, cooldownMs, ignoreSelector]);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    let accumulated = 0;
    let lastAt = Number.NEGATIVE_INFINITY;

    const onWheel = (event: WheelEvent): void => {
      if (!active.current) {
        return;
      }
      const ignore = options.current.ignoreSelector;
      if (ignore && event.target instanceof Element && event.target.closest(ignore)) {
        // 这一段有自己的处理器；本钩子让开（仍然吃掉默认滚动，理由同下）
        event.preventDefault();
        return;
      }
      // 见文件头第 1 条：非被动监听下这一句才真的阻止页面滚动
      event.preventDefault();

      const now = event.timeStamp || performance.now();
      if (accumulated !== 0 && Math.sign(event.deltaY) !== Math.sign(accumulated)) {
        accumulated = 0;
      }
      accumulated += event.deltaY;
      if (Math.abs(accumulated) < options.current.threshold) {
        return;
      }
      if (now - lastAt < options.current.cooldownMs) {
        return;
      }
      lastAt = now;
      const delta: 1 | -1 = accumulated > 0 ? 1 : -1;
      accumulated = 0;
      step.current(delta);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ref]);
}
