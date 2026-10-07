import type { Group, Vector3, InstancedMesh } from 'three';
export class FissureSystem {
 constructor(scene: Group);
 spawn(position: Vector3, options?: Readonly<Record<string, number>>): { readonly lips: InstancedMesh };
 update(delta: number): void;
 dispose(): void;
}
