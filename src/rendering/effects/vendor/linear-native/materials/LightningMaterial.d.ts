import type { ShaderMaterial } from 'three';
export const BoltPass: { readonly CORE: number; readonly GLOW: number };
export function createLightningMaterial(pass: number): ShaderMaterial;
