import { Children, cloneElement, isValidElement, type ReactNode } from 'react';

interface MenuNodeProps { readonly label?: string; readonly className?: string; readonly children?: ReactNode }

function entryLabel(props: MenuNodeProps): string | null {
  if (typeof props.label === 'string') return props.label;
  for (const node of Children.toArray(props.children)) {
    if (isValidElement<MenuNodeProps>(node) && node.props.className === 'feature__title' && typeof node.props.children === 'string') return node.props.children;
  }
  return null;
}

/**
 * 把**还没做完**的模式从菜单里拿掉，避免点进去看到一个半成品。
 *
 * `迷宫` **不在**这份名单里：第一层已经做完并通过验收
 * （场景/走格子/楼层商店/结算，见 `docs/MAZE_FLOOR1.md` 与 `tests/browser/maze.spec.ts`），
 * 活动大厅的第一张卡就是它的入口。别把它加回来——加了就等于把做完的模式藏起来，
 * `tests/browser/maze.spec.ts` 会立刻红。
 *
 * 仍在开发中的是：本地 Draft，以及同机双人的「本地 任选对战」。
 */
export function visibleMenuContent(content: ReactNode): ReactNode {
  return Children.toArray(content).map((node) => {
    if (!isValidElement<MenuNodeProps>(node)) return node;
    const label = entryLabel(node.props);
    if (label && (label.toLowerCase().includes('draft'))) return null;
    return node.props.children === undefined ? node : cloneElement(node, { children: visibleMenuContent(node.props.children) });
  });
}
