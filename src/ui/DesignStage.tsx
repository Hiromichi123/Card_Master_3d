import { useCallback, type ReactNode, type RefObject } from 'react';

import { useParallax } from './useParallax';
import { CrossfadeBackground } from './SceneBackground';

/**
 * 「2880 × 1800 设计空间 + 整体等比缩放」的舞台。
 *
 * 旧版 `config.py` 把这一套用在了**所有**带背景的界面上：
 * `AUTO_SCALE = min(屏幕宽/设计宽, 屏幕高/设计高)`，`WINDOW_WIDTH = 设计宽 × AUTO_SCALE`，
 * 之后所有布局都写在设计空间里（`WINDOW_WIDTH * 0.62` 这类比例的分母是设计框，不是视口）。
 *
 * 这里就是那一层：视差背景 + 压暗 + 设计框。菜单（`MenuChrome`）、
 * 两个商店都用它，于是「换一个屏幕比例，版面比例不变」这件事只有一处实现。
 *
 * 视差背景**铺满视口**而不是放进设计框：窗口比设计比例更宽时，
 * 放进框里会在两侧露出底色。
 */
export interface DesignStageProps {
  readonly backgroundUrl: string | null;
  readonly className?: string | undefined;
  readonly children: ReactNode;
  /**
   * 屏幕根节点（`.menu`）的 ref。
   *
   * 给「全页滚轮」用（`ui/usePageWheel`）：滚轮监听要挂在**铺满视口**的这一层上，
   * 而不是里面那个 2880×1800 的设计框——挂在框上时，窗口比设计比例宽出来的
   * 两侧留白里滚就不生效。
   */
  readonly rootRef?: RefObject<HTMLDivElement | null> | undefined;
}

export function DesignStage({
  backgroundUrl,
  children,
  className = '',
  rootRef,
}: DesignStageProps) {
  const parallaxRef = useParallax();
  /*
    视差与调用方的 ref 都挂在同一个节点上。用回调 ref 合并而不是嵌套一层
    包装元素：多一层会改掉 `.menu` 的定位上下文。
    两个 ref 对象都稳定，于是这个回调也稳定，不会每次渲染都重挂（重挂会
    让视差在那个 effect 里拿到的 `element` 失效）。
  */
  const assignRef = useCallback(
    (node: HTMLDivElement | null) => {
      parallaxRef.current = node;
      if (rootRef) {
        rootRef.current = node;
      }
    },
    [parallaxRef, rootRef],
  );

  return (
    <div className={`menu ${className}`} ref={assignRef}>
      <CrossfadeBackground url={backgroundUrl} />
      <div className="menu__scrim" aria-hidden="true" />
      <div className="menu__stage">{children}</div>
    </div>
  );
}
