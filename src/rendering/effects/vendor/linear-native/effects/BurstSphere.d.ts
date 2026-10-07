import type { Color, Group, Vector3 } from 'three';
export const BurstMode: { readonly FIRE: number; readonly FROST: number; readonly STORM: number };
export class BurstSystem {
 constructor(scene: Group);
 spawn(mode: number, position: Vector3, options?: Readonly<Record<string, number | Color>>): unknown;
 update(delta: number): void;
 dispose(): void;
}
