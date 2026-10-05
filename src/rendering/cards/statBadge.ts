import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';

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

export type StatKind = 'atk' | 'hp' | 'cd';

const PALETTE: Record<StatKind, { bg: string; fg: string; ring: string }> = {
  atk: { bg: 'rgba(38,20,16,0.92)', fg: '#ffd9a8', ring: '#e07a3c' },
  hp: { bg: 'rgba(16,32,24,0.92)', fg: '#c9f7d8', ring: '#3fbf7f' },
  cd: { bg: 'rgba(18,22,38,0.92)', fg: '#c6d4ff', ring: '#5f7fd8' },
};

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
  const radius = SIZE / 2 - 6;

  // 底：圆形 + 描边，保证在任意卡面上都读得清
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = palette.bg;
  ctx.fill();
  ctx.lineWidth = emphasised ? 7 : 4;
  ctx.strokeStyle = emphasised ? '#ffffff' : palette.ring;
  ctx.stroke();

  // 数值：字号按位数收缩，三位数不溢出
  const text = String(value);
  const fontSize = text.length >= 3 ? 54 : text.length === 2 ? 66 : 74;
  ctx.fillStyle = palette.fg;
  ctx.font = `700 ${fontSize}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, center, center + 3);

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
