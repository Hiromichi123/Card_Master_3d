import type { BufferGeometry, Vector3 } from 'three';
export const RibbonMode: { readonly BILLBOARD: string };
export class RibbonGeometry {
 constructor(maxSegments?: number, options?: { frame?: boolean });
 readonly geometry: BufferGeometry;
 build(points: readonly Vector3[], options: { count: number; width: number; mode: string; cameraPosition: Vector3 }): void;
 dispose(): void;
}
