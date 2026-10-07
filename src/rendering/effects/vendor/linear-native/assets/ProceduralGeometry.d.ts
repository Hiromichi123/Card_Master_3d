import type { BufferGeometry, InstancedBufferGeometry } from 'three';
export function createAsteroidGeometry(options?: Readonly<Record<string, number>>): BufferGeometry;
export function createCrystalGeometry(options?: Readonly<Record<string, number>>): BufferGeometry;
export function createBoltRibbonGeometry(nodes?: number, strands?: number): InstancedBufferGeometry;
