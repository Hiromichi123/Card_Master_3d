export type Mainland = 'human'|'demon'|'sacred';
export type GeographicPoint = readonly [number,number];
export const MAINLAND_OFFSETS:Readonly<Record<Mainland,GeographicPoint>>={human:[-8,0],demon:[6,0],sacred:[0,-6]};
export function mainlandPoint(region:Mainland,x:number,z:number):GeographicPoint {
  const offset=MAINLAND_OFFSETS[region];return [x+offset[0],z+offset[1]];
}
export function mainlandOriginal(region:Mainland,x:number,z:number):GeographicPoint {
  const offset=MAINLAND_OFFSETS[region];return [x-offset[0],z-offset[1]];
}
export const CENTRAL_TREE_ANCHOR:GeographicPoint=[0,1.5];
export const CENTRAL_TREE_HEIGHT=49;
export const CENTRAL_TREE_CROWN_RADIUS=32;
export const CENTRAL_TREE_ROOT_RADIUS=21;
/** Includes the central plateau and crown tips, in model units before WORLD_SCALE. */
export const CENTRAL_WORLD_TOP=55;
