import type { ShaderMaterial } from 'three';
export const SnarePass: { readonly CORE: number; readonly GLOW: number };
export function createSnareCageMaterial(pass?: number): ShaderMaterial;
export function createSnareFieldMaterial(): ShaderMaterial;
