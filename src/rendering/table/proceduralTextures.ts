import {
  CanvasTexture,
  DataTexture,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

/**
 * 程序化台面纹理。
 *
 * **移植自** `D:\Github\Chessboard-three.js`（MIT）的
 * `src/render/three/textures.js`，只做适配（TypeScript 类型、命名、注释），
 * 生成算法保持一致。来源与许可见仓库根目录的 `assets-sources.json`。
 *
 * 为什么保留「程序化生成」这条路而不是贴图文件：
 * - 仓库里不放二进制纹理，一个主题换配色不需要再出一套图；
 * - 按设备分辨率现画，任何视口下都清晰；
 * - 木纹/大理石/石面都是 fbm 噪声驱动的，参数化就能得到一整个系列。
 *
 * 缓存键是**完整的参数组合**——主题之间共用生成器，
 * 不缓存的话每次切主题都会重画一遍 768² 的画布。
 */

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

interface Canvas2D {
  readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  readonly ctx: Ctx2D;
}

const cache = new Map<string, Texture>();

function cached<T extends Texture>(key: string, build: () => T): T {
  const hit = cache.get(key);
  if (hit) {
    return hit as T;
  }
  const texture = build();
  cache.set(key, texture);
  return texture;
}

/** 释放全部缓存纹理。 */
export function disposeSurfaceTextures(): void {
  for (const texture of cache.values()) {
    texture.dispose();
  }
  cache.clear();
}

function makeCanvas(size: number): Canvas2D {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('OffscreenCanvas 的 2D 上下文创建失败');
    }
    return { canvas, ctx };
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 的 2D 上下文创建失败');
  }
  return { canvas, ctx };
}

/**
 * 确定性的值噪声。
 *
 * 用 xorshift32 而不是 `Math.random()`：同一套参数必须每次加载都画出同一张图，
 * 否则截图对比与视觉回归都不可复现。
 */
function makeNoise(seed = 1): { random: () => number; at: (x: number, y: number) => number } {
  let state = (seed >>> 0) || 1;
  const random = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const table = Array.from({ length: 256 }, random);
  const smooth = (t: number): number => t * t * (3 - 2 * t);

  return {
    random,
    at(x: number, y: number): number {
      const xi = Math.floor(x) & 255;
      const yi = Math.floor(y) & 255;
      const xf = smooth(x - Math.floor(x));
      const yf = smooth(y - Math.floor(y));
      // 用质数错开两个轴的查表位置，否则格点会透出棋盘状的规律
      const c00 = table[(xi * 7 + yi * 131) & 255] ?? 0;
      const c10 = table[((xi + 1) * 7 + yi * 131) & 255] ?? 0;
      const c01 = table[(xi * 7 + (yi + 1) * 131) & 255] ?? 0;
      const c11 = table[((xi + 1) * 7 + (yi + 1) * 131) & 255] ?? 0;
      const top = c00 + (c10 - c00) * xf;
      const bottom = c01 + (c11 - c01) * xf;
      return top + (bottom - top) * yf;
    },
  };
}

/** 多倍频值噪声，消除单一频率的重复感。 */
function fbm(
  noise: { at: (x: number, y: number) => number },
  x: number,
  y: number,
  octaves = 5,
): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i += 1) {
    value += noise.at(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / total;
}

const clamp255 = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

type Rgb = readonly [number, number, number];

function mixColor(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    clamp255(a[0] + (b[0] - a[0]) * t),
    clamp255(a[1] + (b[1] - a[1]) * t),
    clamp255(a[2] + (b[2] - a[2]) * t),
  ];
}

function hexToRgb(hex: number): Rgb {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function finish(canvas: OffscreenCanvas | HTMLCanvasElement, srgb: boolean): CanvasTexture {
  const texture = new CanvasTexture(canvas as HTMLCanvasElement);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  if (srgb) {
    texture.colorSpace = SRGBColorSpace;
  }
  texture.needsUpdate = true;
  return texture;
}

export interface WoodOptions {
  readonly size?: number;
  readonly light?: number;
  readonly dark?: number;
  readonly rings?: number;
  readonly turbulence?: number;
  readonly sharpness?: number;
  readonly pores?: number;
  readonly seed?: number;
  readonly angle?: number;
}

/**
 * 木纹。
 *
 * 关键在于「生长轮是不对称的」：一条宽的浅色早材，收在一条窄的深色晚材上。
 * 所以相位取锯齿波再取高次幂——深色线自然落在每个周期的末端；
 * 相位再被高强度扰动（以「整圈」为单位），环线才会走成平板锯切面上的大拱形。
 * 若用普通的扭曲正弦，得到的是间距均匀的对称条纹，那是瓦楞纸不是木头。
 */
export function woodTexture({
  size = 768,
  light = 0xc8a06a,
  dark = 0x6b4526,
  rings = 12,
  turbulence = 2.6,
  sharpness = 6,
  pores = 0.05,
  seed = 7,
  angle = 0,
}: WoodOptions = {}): CanvasTexture {
  const key = `wood:${size}:${light}:${dark}:${rings}:${turbulence}:${sharpness}:${pores}:${seed}:${angle}`;
  return cached(key, () => {
    const { canvas, ctx } = makeCanvas(size);
    const image = ctx.createImageData(size, size);
    const noise = makeNoise(seed);
    const lightRgb = hexToRgb(light);
    const darkRgb = hexToRgb(dark);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = x / size;
        const v = y / size;
        // across 垂直于纹理方向（跨过生长轮），along 沿纹理方向
        const across = u * cos - v * sin;
        const along = u * sin + v * cos;

        // 沿纹理方向拉伸的扰动：环线大体平行但会弯，拱形就是这么来的
        const warp = (fbm(noise, across * 1.6, along * 0.4, 5) - 0.5) * turbulence;
        const phase = across * rings + warp;
        const saw = phase - Math.floor(phase);

        // 晚材：一个周期内大部分接近 0，末端陡升
        let value = saw ** sharpness;
        // 沿纹理方向的细孔
        value += (fbm(noise, across * 130, along * 6, 2) - 0.5) * pores * 2;
        // 大尺度色差，避免整块板看起来一样
        value += (fbm(noise, across * 0.9, along * 0.7, 3) - 0.5) * 0.18;

        const t = 1 - Math.max(0, Math.min(1, value));
        const [r, g, b] = mixColor(darkRgb, lightRgb, t);
        const offset = (y * size + x) * 4;
        image.data[offset] = r;
        image.data[offset + 1] = g;
        image.data[offset + 2] = b;
        image.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return finish(canvas, true);
  });
}

export interface MarbleOptions {
  readonly size?: number;
  readonly base?: number;
  readonly vein?: number;
  readonly scale?: number;
  readonly turbulence?: number;
  readonly seed?: number;
}

/** 大理石：fbm 扰动的正弦带给出主脉络，再用一次更锐利的通带画出细亮脉。 */
export function marbleTexture({
  size = 768,
  base = 0xf2efe6,
  vein = 0x9a9384,
  scale = 3.2,
  turbulence = 6,
  seed = 21,
}: MarbleOptions = {}): CanvasTexture {
  const key = `marble:${size}:${base}:${vein}:${scale}:${turbulence}:${seed}`;
  return cached(key, () => {
    const { canvas, ctx } = makeCanvas(size);
    const image = ctx.createImageData(size, size);
    const noise = makeNoise(seed);
    const baseRgb = hexToRgb(base);
    const veinRgb = hexToRgb(vein);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = x / size;
        const v = y / size;
        const warp = fbm(noise, u * scale, v * scale, 6);
        const band = Math.abs(Math.sin((u + v) * Math.PI * scale + warp * turbulence));
        const thin = Math.max(0, 1 - Math.abs(band - 0.12) * 14) * 0.7;
        const t = Math.min(1, band ** 2.6 * 0.75 + thin);
        const [r, g, b] = mixColor(baseRgb, veinRgb, t);
        const offset = (y * size + x) * 4;
        image.data[offset] = r;
        image.data[offset + 1] = g;
        image.data[offset + 2] = b;
        image.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return finish(canvas, true);
  });
}

export interface RoughnessOptions {
  readonly size?: number;
  readonly base?: number;
  readonly spread?: number;
  readonly scale?: number;
  readonly seed?: number;
}

/** 各向同性的细颗粒，给石材/金属一点粗糙度起伏。 */
export function roughnessTexture({
  size = 512,
  base = 0.5,
  spread = 0.25,
  scale = 90,
  seed = 3,
}: RoughnessOptions = {}): CanvasTexture {
  const key = `rough:${size}:${base}:${spread}:${scale}:${seed}`;
  return cached(key, () => {
    const { canvas, ctx } = makeCanvas(size);
    const image = ctx.createImageData(size, size);
    const noise = makeNoise(seed);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const value = fbm(noise, (x / size) * scale, (y / size) * scale, 3);
        const level = clamp255((base + (value - 0.5) * spread * 2) * 255);
        const offset = (y * size + x) * 4;
        image.data[offset] = level;
        image.data[offset + 1] = level;
        image.data[offset + 2] = level;
        image.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return finish(canvas, false);
  });
}

export interface GrainNormalOptions {
  readonly size?: number;
  readonly strength?: number;
  readonly scale?: number;
  readonly seed?: number;
}

/**
 * 由高度场用中心差分算出的法线贴图。
 *
 * 比带一张图更省事也更锐利，而且和颜色贴图同源（同一套噪声），
 * 两者永远同步——不会出现换了噪声而法线还停在旧图案上的情况。
 */
export function grainNormalTexture({
  size = 512,
  strength = 1.4,
  scale = 60,
  seed = 11,
}: GrainNormalOptions = {}): DataTexture {
  const key = `normal:${size}:${strength}:${scale}:${seed}`;
  return cached(key, () => {
    const noise = makeNoise(seed);
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        height[y * size + x] = fbm(noise, (x / size) * scale, (y / size) * scale, 4);
      }
    }
    const data = new Uint8Array(size * size * 4);
    const at = (x: number, y: number): number =>
      height[((y + size) % size) * size + ((x + size) % size)] ?? 0;

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        // 切线空间法线 (-dx, -dy, 1)，归一化后打包到 0..255
        const length = Math.hypot(dx, dy, 1);
        const offset = (y * size + x) * 4;
        data[offset] = clamp255(((-dx / length) * 0.5 + 0.5) * 255);
        data[offset + 1] = clamp255(((-dy / length) * 0.5 + 0.5) * 255);
        data[offset + 2] = clamp255(((1 / length) * 0.5 + 0.5) * 255);
        data[offset + 3] = 255;
      }
    }
    const texture = new DataTexture(data, size, size, RGBAFormat);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  });
}
