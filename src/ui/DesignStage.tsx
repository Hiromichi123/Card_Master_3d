import type { ReactNode } from 'react';

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
}

export function DesignStage({ backgroundUrl, children, className = '' }: DesignStageProps) {
  const parallaxRef = useParallax();

  return (
    <div className={`menu ${className}`} ref={parallaxRef}>
      <CrossfadeBackground url={backgroundUrl} />
      <div className="menu__scrim" aria-hidden="true" />
      <div className="menu__stage">{children}</div>
    </div>
  );
}
