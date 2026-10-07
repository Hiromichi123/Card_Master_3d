import type { MeshStandardMaterial } from 'three';
export function createMeteorMaterial(environment: {
 registerShadowCasterWithPatch(material: MeshStandardMaterial, patch: MeshStandardMaterial['onBeforeCompile']): void;
}): MeshStandardMaterial;
