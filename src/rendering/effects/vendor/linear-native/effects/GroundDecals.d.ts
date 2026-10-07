import type { Color, Group, Mesh, ShaderMaterial, Vector3 } from 'three';
export const DecalType: { readonly FROST: number };
export interface GroundDecal { readonly mesh: Mesh; readonly material: ShaderMaterial }
export class DecalSystem {
 constructor(scene: Group);
 spawn(type: number, position: Vector3, options?: Readonly<Record<string, number | Color>>): GroundDecal;
 dispose(): void;
}
