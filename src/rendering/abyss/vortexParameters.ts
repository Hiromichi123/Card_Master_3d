import { InstancedBufferAttribute, InstancedBufferGeometry, PlaneGeometry } from 'three';
import type { QualityTier } from '../quality';

/** 与DOM背景的 object-fit: cover 同一图像坐标；原图构图校准只需调整这里。 */
export const ABYSS_VORTEX = {
  center: [0.5, 0.5] as const,
  ellipse: [1, 0.78] as const,
  innerRadius: 0.115,
  outerRadius: 0.49,
  seed: 0x6a09e667,
} as const;

export interface SmokeWisp {
  readonly angle: number;
  readonly radius: number;
  readonly depth: number;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly speed: number;
  readonly opacity: number;
}

export function vortexBudget(tier: QualityTier, dprCap: number) {
  const count = tier === 'low' ? 32 : tier === 'high' ? 48 : 40;
  return { count, dpr: Math.min(tier === 'low' ? 1 : 1.5, Math.max(1, Number.isFinite(dprCap) ? dprCap : 1)) };
}

/** 固定样本，不在渲染和帧循环里生成随机数；近层稍大，后层稍暗。 */
export function makeSmokeWisps(count: number): readonly SmokeWisp[] {
  let seed: number = ABYSS_VORTEX.seed;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const result: SmokeWisp[] = [];
  for (let index = 0; index < count; index += 1) {
    const layer = index % 4;
    const radius = 0.17 + layer * 0.074 + random() * 0.045;
    result.push({
      angle: index * 2.399963229728653 + random() * 0.35,
      radius,
      depth: -0.35 + layer * 0.2,
      seed: random() * 90,
      width: 0.12 + radius * 0.24 + random() * 0.035,
      height: 0.058 + random() * 0.04,
      speed: 0.095 + (0.49 - radius) * 0.24 + random() * 0.016,
      opacity: 0.32 + layer * 0.038,
    });
  }
  return result.sort((a, b) => a.depth - b.depth);
}

/** 切向x/径向y基的行列式为−1；反转索引后才是朝向屏幕的正面。 */
export function makeSmokeGeometry(count: number): InstancedBufferGeometry {
  const plane = new PlaneGeometry(2, 2, 8, 3);
  const geometry = new InstancedBufferGeometry();
  const indices = plane.index!.clone();
  for (let index = 0; index < indices.count; index += 3) {
    const second = indices.getX(index + 1);
    indices.setX(index + 1, indices.getX(index + 2));
    indices.setX(index + 2, second);
  }
  geometry.setIndex(indices);
  geometry.setAttribute('position', plane.attributes.position!.clone());
  geometry.setAttribute('uv', plane.attributes.uv!.clone());
  plane.dispose();
  const wisps = makeSmokeWisps(count);
  geometry.setAttribute('aOrbit', new InstancedBufferAttribute(new Float32Array(wisps.flatMap(wisp => [
    wisp.radius, wisp.angle, wisp.speed, wisp.seed,
  ])), 4));
  geometry.setAttribute('aShape', new InstancedBufferAttribute(new Float32Array(wisps.flatMap(wisp => [
    wisp.width, wisp.height, wisp.depth, wisp.opacity,
  ])), 4));
  geometry.instanceCount = count;
  return geometry;
}

/** 屏幕归一化UV映射到居中cover图的可见UV范围。 */
export function coverUvScale(viewWidth: number, viewHeight: number, imageWidth: number, imageHeight: number): readonly [number, number] {
  if (viewWidth <= 0 || viewHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) return [1, 1];
  const viewAspect = viewWidth / viewHeight;
  const imageAspect = imageWidth / imageHeight;
  return viewAspect > imageAspect ? [1, imageAspect / viewAspect] : [viewAspect / imageAspect, 1];
}

export function vortexCoreMask(imageX: number, imageY: number): number {
  const x = (imageX - ABYSS_VORTEX.center[0]) / ABYSS_VORTEX.ellipse[0];
  const y = (imageY - ABYSS_VORTEX.center[1]) / ABYSS_VORTEX.ellipse[1];
  const radius = Math.hypot(x, y);
  const blend = Math.max(0, Math.min(1, (radius - ABYSS_VORTEX.innerRadius) / 0.055));
  return blend * blend * (3 - 2 * blend);
}
