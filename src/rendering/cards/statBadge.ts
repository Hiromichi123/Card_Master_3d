import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';

import { STAT_COLORS, type StatKind } from './statColors';

export type { StatKind };

/**
 * 数值徽标的贴图生成（`V-CARD-3`）。
 *
 * 成品卡面已经烘焙了名称与边框，但 **ATK/HP/CD 是动态值**，必须与卡面分离显示
 * ——战斗里它们会被祝福、破甲、受伤等效果改动，不能画死在贴图上。
 *
 * 用 Canvas 现画而不是引入 3D 字体：Drei 的 `Text` 走 troika，需要为中文准备字体文件，
 * 而这里只需要数字与一两个字母。自绘的 `CanvasTexture` 没有任何外部依赖，
 * 也不受「发布产物不得依赖在线字体」的限制（`V-HUD-5`）。
 *
 * 贴图按「标签 + 数值 + 配色」缓存：战斗中同一数值会被多张卡共用，
 * 重复绘制是纯浪费。
 */

/*
  配色住在 `statColors.ts`：展示位的 DOM 那边也要用同一份，
  而那个模块不能为了拿色值把 three 拖进引用链。
*/
const PALETTE = STAT_COLORS;

/** 每个徽标绘制尺寸，长宽相等。 */
const SIZE = 128;

const cache = new Map<string, CanvasTexture>();
/** 缓存上限。徽标种类极少，超过说明用法有问题，但仍然兜住。 */
const MAX_CACHE = 256;

function cacheKey(kind: StatKind, value: number, emphasised: boolean): string {
  return `${kind}:${value}:${emphasised ? 1 : 0}`;
}

/**
 * 取得（必要时生成）数值徽标贴图。
 *
 * `emphasised` 用于「本回合刚变化过」的高亮，属于表现层，与规则无关。
 */
export function getStatTexture(
  kind: StatKind,
  value: number,
  emphasised = false,
): CanvasTexture {
  const key = cacheKey(kind, value, emphasised);
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建 2D 上下文，数值徽标无法绘制');
  }

  const palette = PALETTE[kind];
  const center = SIZE / 2;

  /*
    **只画数字，不画外圈。** 原先每个数值都套一个实心圆 + 描边，
    一排徽标看起来像三枚棋子压在卡面上，把插画的下缘整个盖住了。
    去掉底之后靠**描边**保证可读性：卡面是任意插画，白字没描边会在浅色区域糊掉。
  */
  const text = String(value);
  // 字号留出边距：填满整张纹理的话，数字会顶到方块的边缘，看起来又大又挤
  const fontSize = text.length >= 3 ? 58 : text.length === 2 ? 70 : 82;
  ctx.font = `700 ${fontSize}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  /*
    三层叠出「深底 + 光晕 + 实心字」：
    先画一圈带阴影的描边（阴影就是光晕），再画第二遍描边做暗底，
    最后填实体。光晕必须在暗底**之前**画，否则会被暗底盖住。
  */
  ctx.shadowColor = palette.halo;
  ctx.shadowBlur = 7;
  ctx.lineWidth = 9;
  ctx.strokeStyle = palette.halo;
  ctx.strokeText(text, center, center + 2);

  // 暗底：把数字从任意插画上「抠」出来。可读性靠它，光晕只是氛围
  ctx.shadowBlur = 0;
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(6, 9, 16, 0.85)';
  ctx.strokeText(text, center, center + 2);

  // 刚变化过的那一下换成亮色，替代原来的白圈高亮
  ctx.fillStyle = emphasised ? palette.ring : palette.fg;
  ctx.fillText(text, center, center + 2);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // 徽标是小尺寸近景元素，用线性过滤避免放大后出现方块
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;

  if (cache.size >= MAX_CACHE) {
    // 简单清空：徽标重画很便宜，不值得为它维护 LRU
    for (const old of cache.values()) {
      old.dispose();
    }
    cache.clear();
  }
  cache.set(key, texture);
  return texture;
}

/** 释放全部缓存贴图。场景卸载时调用。 */
export function disposeStatTextures(): void {
  for (const texture of cache.values()) {
    texture.dispose();
  }
  cache.clear();
}

/** 徽标在世界里的边长。 */
export const STAT_BADGE_SIZE = 0.26;
