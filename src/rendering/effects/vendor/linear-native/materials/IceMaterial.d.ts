import type { MeshStandardMaterial } from 'three';
export function createIceMaterial(environment: {
  registerShadowCasterWithPatch(material: MeshStandardMaterial, patch: MeshStandardMaterial['onBeforeCompile']): void;
}): MeshStandardMaterial;
