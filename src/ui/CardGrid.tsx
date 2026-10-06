import type { ReactNode } from 'react';

/**
 * 卡格网格。
 *
 * 用 CSS Grid + `auto-fill`，列宽按卡格尺寸给——
 * 不做虚拟滚动：一屏几十张、每张只是一个 `<img>`，用不着。
 * 真正需要注意的是**图片按需加载**（`loading="lazy"` 在 `CardTile` 里），
 * 那才是纹理预算的大头。
 */
export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="card-grid">{children}</div>;
}
