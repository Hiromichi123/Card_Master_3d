import type { ReactNode } from 'react';

/**
 * 滚动容器。
 *
 * 需要单独一个组件，是因为整个应用的 `body` 是 `overflow: hidden`、
 * `#root` 是 `height: 100%`——屏幕自己不带滚动。
 *
 * **`min-height: 0` 是必须的**：它在一个 `flex-direction: column` 的父级里
 * 决定这个子元素能不能收缩到内容高度以下。少了它，256 张卡的图鉴会把容器
 * 撑到内容那么高，然后父级裁掉，滚动条根本不出现——而且不报错，
 * 只是「滑不动」。样式在 `.scroll` 里。
 */
export function ScrollArea({ children }: { children: ReactNode }) {
  return <div className="scroll">{children}</div>;
}
