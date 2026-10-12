import type { CardDefinition } from '../../domain/cards/types';
import { rarityList } from '../../data';
import { rarityIndex } from '../../state/useRarityIndex';
import { assetManager, type TextureTier } from '../../services/AssetManager';
import { cardFaceBakeSize, cardFaceUrlForDefinition } from '../../data/assets';

/** Canonical cardmaker rules: 50px SimSun, (20 + centered, 50), fill +1, tan(15°). */
export const ABYSS_NAME_BAKE = { font: '50px SimSun, 宋体, NSimSun, serif', x: 20, y: 50, fillX: 1, shear: Math.tan(Math.PI / 12) } as const;
type Rgb = readonly [number, number, number];
export function hexRgb(color: string): Rgb {
  return [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16)];
}
/** Same exact/decimal/integer/nearest fallback used by the card baker. */
export function bakedNameColor(level: number): string {
  const entries = rarityList.filter(entry => !entry.isEvent).sort((a, b) => a.level - b.level);
  const exact = [level, Math.round(level * 10) / 10, Math.trunc(level)]
    .map(value => entries.find(entry => entry.level === value)).find(Boolean);
  if (exact) return exact.color;
  return entries.reduce((best, entry) => Math.abs(entry.level - level) < Math.abs(best.level - level) ? entry : best).color;
}

/** Recolor the baked glyph pixels, retaining their original outline/antialias and spacing. */
export function recolorNamePixels(pixels: Uint8ClampedArray, mask: Uint8ClampedArray, source: Rgb, target: Rgb): number {
  const squared = source.reduce((sum, channel) => sum + channel * channel, 0);
  if (!squared) return 0;
  let changed = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if ((mask[i + 3] ?? 0) < 8 || pixels[i + 3] === 0) continue;
    const projection = (pixels[i]! * source[0] + pixels[i + 1]! * source[1] + pixels[i + 2]! * source[2]) / squared;
    if (projection < .10 || projection > 1.16) continue; // Black outline and unrelated light frame pixels.
    const alpha = Math.min(1, projection);
    const residual = Math.hypot(pixels[i]! - source[0] * alpha, pixels[i + 1]! - source[1] * alpha, pixels[i + 2]! - source[2] * alpha);
    if (residual > 30 + alpha * 18) continue;
    for (let channel = 0; channel < 3; channel++) {
      pixels[i + channel] = Math.max(0, Math.min(255, Math.round(pixels[i + channel]! + alpha * (target[channel]! - source[channel]!))));
    }
    changed++;
  }
  return changed;
}

export interface AbyssFaceRequest {
  readonly key: string; readonly source: string; readonly name: string;
  readonly sourceColor: string; readonly targetColor: string; readonly bakeSize: readonly [number, number];
}
export function abyssFaceRequest(card: CardDefinition, tier: TextureTier): AbyssFaceRequest | null {
  const source = cardFaceUrlForDefinition(card, tier), title = card.art.abyssTitle;
  if (!source || !title || !card.cardId.startsWith('abyss/') || title.sourceRarity === card.rarity) return null;
  const sourceColor = bakedNameColor(title.sourceLevel), targetColor = rarityIndex().colorOf(card.rarity);
  return { key: JSON.stringify([source, card.name, sourceColor, targetColor]), source, name: card.name,
    sourceColor, targetColor, bakeSize: cardFaceBakeSize(card, tier) };
}

interface Entry {
  readonly key: string; readonly promise: Promise<string>; refs: number; used: number; blob: string | null; ready: boolean;
}
const cache = new Map<string, Entry>();
const MAX_IDLE_FACES = 48;
function trim(): void {
  const idle = [...cache.values()].filter(entry => entry.refs === 0 && entry.ready).sort((a, b) => a.used - b.used);
  while (idle.length > MAX_IDLE_FACES) {
    const entry = idle.shift()!; cache.delete(entry.key);
    if (entry.blob) URL.revokeObjectURL(entry.blob);
  }
}
async function makeFace(request: AbyssFaceRequest): Promise<string> {
  const texture = await assetManager.acquire(request.source);
  try {
    if (document.fonts) await document.fonts.ready;
    const image = texture.image as CanvasImageSource & { width: number; height: number };
    const width = image.width, height = image.height;
    if (!width || !height) return request.source;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return request.source;
    context.drawImage(image, 0, 0, width, height);
    const mask = document.createElement('canvas'); mask.width = width;
    // Only the name band is read, not the illustration or lower card face.
    mask.height = Math.min(height, Math.ceil(125 / request.bakeSize[1] * height));
    const mark = mask.getContext('2d');
    if (!mark) return request.source;
    mark.font = ABYSS_NAME_BAKE.font;
    const measured = mark.measureText(request.name).width;
    const x = ABYSS_NAME_BAKE.x + Math.floor((request.bakeSize[0] - measured) / 2) + ABYSS_NAME_BAKE.fillX;
    const sx = width / request.bakeSize[0], sy = height / request.bakeSize[1];
    mark.setTransform(sx, 0, -ABYSS_NAME_BAKE.shear * sx, sy, 0, 0);
    mark.font = ABYSS_NAME_BAKE.font; mark.textAlign = 'left'; mark.textBaseline = 'top'; mark.fillStyle = '#fff';
    // A small coverage margin accommodates old FreeType vs current DirectWrite rasterization.
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) mark.fillText(request.name, x + dx, ABYSS_NAME_BAKE.y + dy);
    const pixels = context.getImageData(0, 0, width, mask.height);
    const coverage = mark.getImageData(0, 0, width, mask.height);
    const changed = recolorNamePixels(pixels.data, coverage.data, hexRgb(request.sourceColor), hexRgb(request.targetColor));
    if (!changed) return request.source;
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    return blob ? URL.createObjectURL(blob) : request.source;
  } finally { assetManager.release(request.source); }
}
export function acquireAbyssFace(request: AbyssFaceRequest): Promise<string> {
  const existing = cache.get(request.key);
  if (existing) { existing.refs++; existing.used = performance.now(); return existing.promise; }
  const entry: Entry = { key: request.key, refs: 1, used: performance.now(), blob: null, ready: false,
    promise: makeFace(request).catch(() => request.source).then(url => {
      if (url !== request.source) entry.blob = url;
      entry.ready = true;
      trim(); return url;
    }) };
  cache.set(request.key, entry);
  return entry.promise;
}
export function releaseAbyssFace(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1); entry.used = performance.now(); trim();
}
