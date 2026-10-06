/**
 * 迷宫版面的几何。
 *
 * 这里量的是**「JS 算出来的投影」与「CSS 渲染出来的位置」是不是同一套数学**：
 * 格子层用 CSS 的 `perspective` + `rotateX`，标签层与光球用 `projectToScreen`，
 * 两边对不上就会表现为「名字慢慢飘离格子」——那种偏移肉眼不容易发现，
 * 但用取景点、南北两侧的缩放、离面高度三项就能钉住。
 */

import { describe, expect, it } from 'vitest';

import {
  LEGEND_ORDER,
  MAZE_CELL,
  MAZE_FOCUS,
  MAZE_PERSPECTIVE,
  MAZE_TILE,
  MAZE_TILE_DEPTH,
  MAZE_TILT_DEG,
  NODE_STYLE,
  frontFaceOf,
  lerpPoint,
  mapBounds,
  projectNode,
  projectRel,
  projectToScreen,
  withAlpha,
} from '../../src/scenes/mazeLayout';

const RADIANS = (MAZE_TILT_DEG * Math.PI) / 180;

describe('迷宫版面：投影与 CSS 对齐', () => {
  it('取景点上的点恒落在取景点，缩放恒为 1', () => {
    const projected = projectToScreen({ x: 1234, y: -567 }, { x: 1234, y: -567 });
    expect(projected.x).toBeCloseTo(MAZE_FOCUS.x, 6);
    expect(projected.y).toBeCloseTo(MAZE_FOCUS.y, 6);
    expect(projected.scale).toBeCloseTo(1, 6);
  });

  it('平面内的横向位移不受倾斜影响（x 只乘透视缩放）', () => {
    expect(projectRel({ x: 100, y: 0 }).x).toBeCloseTo(100, 6);
    // 纵向位移被 cosθ 压扁，再乘自己那一点的透视缩放
    const south = projectRel({ x: 0, y: 1000 });
    expect(south.y).toBeCloseTo(1000 * Math.cos(RADIANS) * south.scale, 6);
  });

  it('北边（-y）更远、更小；南边（+y）更近、更大', () => {
    const north = projectRel({ x: 0, y: -1000 });
    const south = projectRel({ x: 0, y: 1000 });
    expect(north.depth).toBeLessThan(0);
    expect(south.depth).toBeGreaterThan(0);
    expect(north.scale).toBeLessThan(1);
    expect(south.scale).toBeGreaterThan(1);
    expect(north.scale).toBeCloseTo(MAZE_PERSPECTIVE / (MAZE_PERSPECTIVE + 1000 * Math.sin(RADIANS)), 6);
  });

  it('离面高度把点抬上屏幕（`z` 为正 = 离观察者更近）', () => {
    const flat = projectRel({ x: 0, y: 0 });
    const lifted = projectRel({ x: 0, y: 0, z: MAZE_TILE_DEPTH });
    expect(lifted.y).toBeLessThan(0);
    // 抬高同时也把这一点推近观察者，所以还要乘它自己的透视缩放
    expect(lifted.y).toBeCloseTo(-MAZE_TILE_DEPTH * Math.sin(RADIANS) * lifted.scale, 6);
    expect(lifted.scale).toBeGreaterThan(flat.scale);
  });

  it('纵深越过观察者时分母被夹住，不会翻出负数缩放', () => {
    const absurd = projectRel({ x: 0, y: 10 * MAZE_PERSPECTIVE });
    expect(absurd.scale).toBeGreaterThan(0);
  });

  it('移动插值是线性的（旧版就是 lerp，没有缓动）', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 750, y: -375 };
    expect(lerpPoint(from, to, 0)).toEqual(from);
    expect(lerpPoint(from, to, 1)).toEqual(to);
    expect(lerpPoint(from, to, 0.5)).toEqual({ x: 375, y: -187.5 });
  });
});

describe('迷宫版面：节点外观与坐标', () => {
  it('网格坐标按格距换算，入口在平面原点', () => {
    expect(projectNode([0, 0])).toEqual({ x: 0, y: 0 });
    expect(projectNode([2, -3])).toEqual({ x: 2 * MAZE_CELL, y: -3 * MAZE_CELL });
  });

  it('包围盒取的是平面坐标（不是格子坐标）', () => {
    expect(mapBounds([[0, 0], [2, 1], [-1, 3]])).toEqual({
      minX: -MAZE_CELL,
      maxX: 2 * MAZE_CELL,
      minY: 0,
      maxY: 3 * MAZE_CELL,
    });
  });

  it('立面色 = 顶面色每通道 −40、alpha +10（旧版 `_draw_nodes` 的算法）', () => {
    expect(frontFaceOf('#464b5a', 210)).toEqual({ color: '#1e2332', alpha: 220 });
    // 暗色通道减到负数要夹在 0，否则会算出别处的颜色
    expect(frontFaceOf('#0a0a14', 250)).toEqual({ color: '#000000', alpha: 255 });
  });

  it('rgba 拼装保留 0–255 的 alpha', () => {
    expect(withAlpha('#aaffc8', 230)).toBe('rgba(170, 255, 200, 0.902)');
  });

  it('图例顺序与旧版 `_draw_legend` 的 types_order 一致', () => {
    expect([...LEGEND_ORDER]).toEqual(['entry', 'normal', 'elite', 'boss', 'supply']);
  });

  it('节点透明度与旧版 `node_type_styles` 的各档一致', () => {
    expect(NODE_STYLE.entry.alpha).toBe(230);
    expect(NODE_STYLE.normal.alpha).toBe(210);
    expect(NODE_STYLE.elite.alpha).toBe(215);
    expect(NODE_STYLE.boss.alpha).toBe(235);
    expect(NODE_STYLE.supply.alpha).toBe(220);
  });

  it('格子边长与旧版一致（225），厚度是表现层的选择', () => {
    expect(MAZE_TILE).toBe(225);
    expect(MAZE_TILE_DEPTH).toBeGreaterThan(0);
  });
});
