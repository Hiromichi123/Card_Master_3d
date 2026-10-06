import type { MazeNodeType } from '../domain/progression/maze';

/**
 * 迷宫地图的版面常量与几何。
 *
 * 数值来自旧版 `maze_scene.py` 的 `BASE_TILE_SIZE`（225）与 `BASE_TILE_GAP`（150），
 * 单位是**设计单位**（2880 × 1800 的设计框，见 `DesignStage`）。
 *
 * **旧版这里有个平方的坑**：`BASE_TILE_SIZE = 225 * UI_SCALE` 是类属性，
 * 之后又 `self.tile_size = int(self.BASE_TILE_SIZE * UI_SCALE)`——UI_SCALE 被乘了两次，
 * 于是窗口一变大格子就大得离谱。这里只乘一次（由 `--ui` 统一缩放）。
 */

/** 格距：格子 + 间隔。 */
export const MAZE_CELL = 375;
/** 节点方块的边长。 */
export const MAZE_TILE = 225;
/**
 * 平面倾斜角（清单要求「倾斜节点场景」；旧版其实是正对屏幕 + 假立体前脸）。
 *
 * CSS 里是 `rotateX(58deg)`：正值让平面的**北边（-y）远离观察者**，
 * 于是南边（+y）离得近、在屏幕上更靠下——与旧版「y 越大越靠下」一致。
 */
export const MAZE_TILT_DEG = 58;
/** 透视距离（设计单位）。越大越接近正投影；6000 是「看得出纵深、又不夸张」的值。 */
export const MAZE_PERSPECTIVE = 6000;
/** 节点方块的厚度（设计单位）。旧版的假前脸是 67.5（tile × 0.3），真立体用不到那么厚。 */
export const MAZE_TILE_DEPTH = 34;
/** 移动动画时长（毫秒），与旧版的 0.45s 一致。 */
export const MAZE_MOVE_MS = 450;

/**
 * 取景点：玩家的节点被摆在这里（设计单位）。
 *
 * 旧版 `_focus_on_world_point` 就是 `camera_offset = (W*0.5, H*0.45) - world`，
 * 也就是「横向居中、纵向 45%」。画布的 `perspective-origin` 必须与它一致，
 * 否则 JS 算出来的投影（标签层）与 CSS 渲染出来的位置（格子层）会差一截。
 */
export const MAZE_FOCUS: GridPoint = { x: 2880 * 0.5, y: 1800 * 0.45 };

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

/** 网格坐标 → 平面坐标（像素，设计单位）。入口 `(0,0)` 在平面原点。 */
export function projectNode(grid: readonly [number, number]): GridPoint {
  return { x: grid[0] * MAZE_CELL, y: grid[1] * MAZE_CELL };
}

/** 全部节点的包围盒（用来算拖动范围与初始取景）。 */
export function mapBounds(grids: readonly (readonly [number, number])[]): {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
} {
  const xs = grids.map((grid) => grid[0] * MAZE_CELL);
  const ys = grids.map((grid) => grid[1] * MAZE_CELL);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/**
 * 节点类型的外观（端口旧版 `node_type_styles` 的配色、透明度与文案）。
 *
 * 这些是**表现**，不是规则——改配色不影响任何数值。
 * `alpha` 是顶面的不透明度（旧版 `node_type_styles` 的 `alpha`，210–235）。
 */
export const NODE_STYLE: Readonly<
  Record<MazeNodeType, { readonly label: string; readonly color: string; readonly alpha: number }>
> = {
  entry: { label: '入口', color: '#aaffc8', alpha: 230 },
  normal: { label: '普通敌人', color: '#464b5a', alpha: 210 },
  elite: { label: '精英敌人', color: '#be78ff', alpha: 215 },
  boss: { label: '楼层Boss', color: '#ff5a5a', alpha: 235 },
  supply: { label: '商店补给', color: '#ffd778', alpha: 220 },
};

/** 图例的顺序（与旧版 `_draw_legend` 的 `types_order` 一致）。 */
export const LEGEND_ORDER: readonly MazeNodeType[] = ['entry', 'normal', 'elite', 'boss', 'supply'];

/** 未探索节点上的暗罩（旧版：`(10, 10, 20, 160)` 叠一层）。 */
export const UNEXPLORED_VEIL = 'rgba(10, 10, 20, 0.63)';

/**
 * 立体前脸的颜色：顶面色**每通道 −40**、alpha +10（旧版 `_draw_nodes` 的算法）。
 *
 * 各通道分别 clamp 到 0–255——`#464b5a` 减 40 会到负数，不 clamp 会算出色相漂移的颜色。
 */
export function frontFaceOf(color: string, alpha: number): { readonly color: string; readonly alpha: number } {
  const channels = [1, 3, 5].map((offset) =>
    Math.max(0, Math.min(255, Number.parseInt(color.slice(offset, offset + 2), 16) - 40)),
  );
  return {
    color: `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`,
    alpha: Math.min(255, alpha + 10),
  };
}

/** `#rrggbb` + 0–255 的 alpha → `rgba(...)`（几何层与标签层都要用）。 */
export function withAlpha(color: string, alpha: number): string {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  return `rgba(${channels.join(', ')}, ${(alpha / 255).toFixed(3)})`;
}

export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
  /** 这一点相对于取景点的**透视缩放**（取景点自身恒为 1）。 */
  readonly scale: number;
  /** 平面上的纵深位移（设计单位，正数 = 离观察者更近）。排序用。 */
  readonly depth: number;
}

/**
 * 「平面上的一点（可带离面高度 z）」→「屏幕上的相对位移」。
 *
 * 与 CSS 的 `perspective` + `rotateX` 是同一套数学，所以**标签层与光球（JS 算）
 * 与格子层（CSS 渲染）能对齐**：平面绕取景点处的 x 轴转 `tilt` 度，
 * 观察者在 z = perspective 处。平面内 `(x, y, z)` 先转过 tilt：
 *
 *     Y = y·cosθ − z·sinθ      Z = y·sinθ + z·cosθ      屏幕缩放 s = P / (P − Z)
 *
 * **z 为正 = 离观察者更近**：格子顶面抬到 `MAZE_TILE_DEPTH`、光球再高一点，
 * 于是它们在屏幕上比平面上的点更靠上（`−z·sinθ`）。
 * `P − Z` 小于 1 时说明这一点越过了观察者（设计上到不了：地图纵深远小于 P），
 * 此时夹住分母，避免负数缩放把元素翻过去。
 */
export function projectRel(
  rel: GridPoint & { readonly z?: number },
  tiltDeg: number = MAZE_TILT_DEG,
  perspective: number = MAZE_PERSPECTIVE,
): ProjectedPoint {
  const radians = (tiltDeg * Math.PI) / 180;
  const z = rel.z ?? 0;
  const depth = rel.y * Math.sin(radians) + z * Math.cos(radians);
  const denominator = Math.max(1, perspective - depth);
  const scale = perspective / denominator;
  return {
    x: rel.x * scale,
    y: (rel.y * Math.cos(radians) - z * Math.sin(radians)) * scale,
    scale,
    depth,
  };
}

/**
 * 平面上的一点 → 设计空间里的屏幕坐标。
 *
 * `cameraPos` 是**被摆在取景点上**的那个点（玩家的节点）：它自己恒在 `MAZE_FOCUS`，
 * 其余点按透视关系散开。格子层的 CSS 平移量取 `−cameraPos`，两者因此严格一致。
 */
export function projectToScreen(
  point: GridPoint & { readonly z?: number },
  cameraPos: GridPoint = MAZE_FOCUS,
): ProjectedPoint {
  const projected = projectRel({ x: point.x - cameraPos.x, y: point.y - cameraPos.y, z: point.z ?? 0 });
  return { ...projected, x: MAZE_FOCUS.x + projected.x, y: MAZE_FOCUS.y + projected.y };
}

/** 线性插值（旧版移动动画就是 `lerp`，没有缓动曲线）。 */
export function lerpPoint(from: GridPoint, to: GridPoint, t: number): GridPoint {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}
