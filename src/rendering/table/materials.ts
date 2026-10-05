import { Color, DoubleSide, MeshPhysicalMaterial, SRGBColorSpace } from 'three';

import {
  grainNormalTexture,
  marbleTexture,
  roughnessTexture,
  woodTexture,
} from './proceduralTextures';

/**
 * 由「纯数据表面描述」构造 three 材质。
 *
 * **移植自** `D:\Github\Chessboard-three.js`（MIT）的
 * `src/render/three/materials.js`，适配为 TypeScript。
 *
 * 用 `MeshPhysicalMaterial` 而不是 `MeshStandardMaterial`：
 * 多出的开销换来 clearcoat 与 transmission，前者让上漆的木头看起来像上过漆，
 * 后者让玻璃看起来像玻璃而不是染色的塑料。
 */

export type SurfaceKind = 'wood' | 'marble' | 'metal' | 'glass' | 'plain' | 'stone';

export type QualityLevel = 'low' | 'medium' | 'high';

export interface SurfaceSpec {
  readonly kind: SurfaceKind;
  readonly color?: number;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly clearcoat?: number;
  readonly clearcoatRoughness?: number;
  readonly envMapIntensity?: number;
  readonly emissive?: number;
  readonly emissiveIntensity?: number;
  readonly transmission?: number;
  readonly ior?: number;
  readonly thickness?: number;

  // 木纹
  readonly light?: number;
  readonly dark?: number;
  readonly rings?: number;
  readonly turbulence?: number;
  readonly angle?: number;
  readonly seed?: number;

  // 大理石
  readonly base?: number;
  readonly vein?: number;
  readonly scale?: number;

  /** 贴图已经带了主题配色，`color` 只在需要额外着色时才设置。 */
  readonly tint?: number;
}

export interface BuildMaterialOptions {
  readonly textureScale?: number;
  readonly quality?: QualityLevel;
}

/** 各画质档对应的程序化贴图边长。核显上 768 已经足够，低档直接不出贴图。 */
function textureSize(quality: QualityLevel): number {
  switch (quality) {
    case 'low':
      return 256;
    case 'medium':
      return 512;
    case 'high':
      return 768;
    default:
      return 512;
  }
}

export function buildMaterial(
  surface: SurfaceSpec,
  { textureScale = 1, quality = 'high' }: BuildMaterialOptions = {},
): MeshPhysicalMaterial {
  // 低档完全跳过程序化贴图：生成它们要跑满 fbm，且低档的 DPR 也低到看不出差别
  const detailed = quality !== 'low';
  const size = textureSize(quality);

  const params: ConstructorParameters<typeof MeshPhysicalMaterial>[0] = {
    color: new Color(surface.color ?? 0xffffff),
    roughness: surface.roughness ?? 0.5,
    metalness: surface.metalness ?? 0,
    clearcoat: surface.clearcoat ?? 0,
    clearcoatRoughness: surface.clearcoatRoughness ?? 0.2,
    envMapIntensity: surface.envMapIntensity ?? 1,
  };

  if (surface.emissive !== undefined) {
    params.emissive = new Color(surface.emissive);
    params.emissiveIntensity = surface.emissiveIntensity ?? 0.5;
  }
  if (surface.transmission) {
    params.transmission = surface.transmission;
    params.ior = surface.ior ?? 1.5;
    params.thickness = surface.thickness ?? 1;
    // transmission 必须双面渲染，否则内部看起来像个洞
    params.side = DoubleSide;
    params.transparent = true;
  }

  const material = new MeshPhysicalMaterial(params);
  if (!detailed) {
    return material;
  }

  switch (surface.kind) {
    case 'wood': {
      material.map = woodTexture({
        size,
        light: surface.light ?? 0xc8a06a,
        dark: surface.dark ?? 0x6b4526,
        rings: surface.rings ?? 12,
        turbulence: surface.turbulence ?? 5.5,
        seed: surface.seed ?? 7,
        angle: surface.angle ?? 0,
      });
      material.roughnessMap = roughnessTexture({ base: material.roughness, spread: 0.1, scale: 40, seed: 5 });
      material.normalMap = grainNormalTexture({ strength: 0.45, scale: 26, seed: 13 });
      material.normalScale.set(0.12, 0.12);
      break;
    }
    case 'marble': {
      material.map = marbleTexture({
        size,
        base: surface.base ?? 0xf2efe6,
        vein: surface.vein ?? 0x9a9384,
        scale: surface.scale ?? 3.2,
        turbulence: surface.turbulence ?? 6,
        seed: surface.seed ?? 21,
      });
      material.roughnessMap = roughnessTexture({ base: material.roughness, spread: 0.07, scale: 30, seed: 17 });
      material.normalMap = grainNormalTexture({ strength: 0.2, scale: 18, seed: 23 });
      material.normalScale.set(0.07, 0.07);
      break;
    }
    case 'metal': {
      material.metalness = surface.metalness ?? 0.9;
      // 拉丝而不是镜面：一点各向异性的颗粒才像机加工件
      material.roughnessMap = roughnessTexture({ base: material.roughness, spread: 0.22, scale: 240, seed: 31 });
      material.normalMap = grainNormalTexture({ strength: 0.5, scale: 200, seed: 29 });
      material.normalScale.set(0.2, 0.05);
      break;
    }
    case 'stone': {
      material.roughnessMap = roughnessTexture({ base: material.roughness, spread: 0.3, scale: 60, seed: 37 });
      material.normalMap = grainNormalTexture({ strength: 0.7, scale: 28, seed: 41 });
      material.normalScale.set(0.22, 0.22);
      break;
    }
    default:
      break;
  }

  for (const map of [material.map, material.roughnessMap, material.normalMap]) {
    map?.repeat.set(textureScale, textureScale);
  }

  if (material.map) {
    material.map.colorSpace = SRGBColorSpace;
    // three 会把 map 与 color 相乘。生成的贴图里已经含了主题配色，
    // 若把 `color` 留在主题色上就等于上两遍色，表面会比主题要求的暗一倍。
    material.color.set(surface.tint ?? 0xffffff);
  }

  return material;
}

/** 材质里的贴图由生成器缓存统一持有，这里只释放材质本身。 */
export function disposeMaterial(material: MeshPhysicalMaterial): void {
  material.dispose();
}
