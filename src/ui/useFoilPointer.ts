import { useEffect, useRef, type RefObject } from 'react';

import { damp } from '../rendering/anim/motion';
import { foilFromPointer } from '../rendering/cards/foilModel';

/**
 * 指针检视：鼠标在卡面上移动时，把检视状态写进元素的 CSS 自定义属性。
 *
 * 复用 `foilModel` 的映射，与 3D 卡的着色器共用同一套参数含义——
 * 图鉴这边指针在卡面上走，战斗那边相机绕着卡转，下游拿到的是同一个 `FoilView`。
 *
 * **不给每个卡格常驻一个 rAF 循环。** 图鉴一屏几十上百张，
 * 每张挂一个循环就是上百个回调在空转。这里只在指针进入时启动、
 * 并在数值收敛（以及指针离开）之后自己停掉——静止的卡片一帧都不跑。
 *
 * 用 `damp` 而不是 CSS `transition`：CSS 过渡对自定义属性无能为力
 * （除非注册 `@property`，那在各浏览器上还不齐），
 * 而且阻尼在中断时从当前位置接得上，过渡要处理打断。
 */

/** 收敛到这个距离以内就停掉循环，省掉空转。 */
const SETTLE_EPSILON = 0.0015;

export function useFoilPointer(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  /** 指针是否还在卡面上。离开后要回到中位。 */
  const hovering = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) {
      return;
    }

    const target = { x: 0.5, y: 0.5 };
    const current = { x: 0.5, y: 0.5 };
    let raf = 0;
    let last = 0;

    const write = (): boolean => {
      const view = foilFromPointer(current.x, current.y);
      element.style.setProperty('--foil-bg-x', `${(view.backgroundX * 100).toFixed(2)}%`);
      element.style.setProperty('--foil-bg-y', `${(view.backgroundY * 100).toFixed(2)}%`);
      element.style.setProperty('--foil-glare-x', `${(view.glareX * 100).toFixed(2)}%`);
      element.style.setProperty('--foil-glare-y', `${(view.glareY * 100).toFixed(2)}%`);
      element.style.setProperty('--foil-center', view.fromCenter.toFixed(3));
      element.style.setProperty('--foil-lit', view.lit.toFixed(3));
      /*
        倾斜角。检视不只是「反光在动」——卡片本身要跟着指针倒一点，
        否则再准的反光也像贴了张会动的贴纸。幅度刻意小：图鉴里
        一屏几十张卡，倒多了整页都在晃。
      */
      element.style.setProperty('--foil-tilt-y', `${((current.x - 0.5) * 18).toFixed(2)}deg`);
      element.style.setProperty('--foil-tilt-x', `${((0.5 - current.y) * 18).toFixed(2)}deg`);
      return true;
    };

    const frame = (now: number): void => {
      // 上一帧到现在的时间；第一帧没有基准，按 60fps 估
      const delta = last === 0 ? 1 / 60 : Math.min((now - last) / 1000, 0.05);
      last = now;

      current.x = damp(current.x, target.x, 14, delta);
      current.y = damp(current.y, target.y, 14, delta);
      write();

      const settled =
        Math.abs(current.x - target.x) < SETTLE_EPSILON &&
        Math.abs(current.y - target.y) < SETTLE_EPSILON;

      // 收敛且指针已离开：停下，等下一次进入再启动
      if (settled && !hovering.current) {
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
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }
      target.x = (event.clientX - rect.left) / rect.width;
      target.y = (event.clientY - rect.top) / rect.height;
      hovering.current = true;
      start();
    };

    const onLeave = (): void => {
      hovering.current = false;
      // 回到中位——停在一个偏斜的检视状态上会看起来像卡住了
      target.x = 0.5;
      target.y = 0.5;
      start();
    };

    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerleave', onLeave);
    return () => {
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
      if (raf !== 0) {
        cancelAnimationFrame(raf);
      }
    };
  }, [ref, enabled]);
}
