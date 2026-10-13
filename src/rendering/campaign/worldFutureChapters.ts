import { CENTRAL_TREE_ANCHOR,CENTRAL_WORLD_TOP } from './worldPlacement';
import type { Vec3 } from './worldGeometry';
import { WORLD_EXPANSION } from './worldLayout';

/** Model-space chapter markers and camera framing for the ancient sea and world tree. */
export const FUTURE_CHAPTER_VIEWS:Readonly<Record<number,{readonly marker:Vec3;readonly target:Vec3;readonly radius:number}>>={
  4:{marker:[1.3*WORLD_EXPANSION,5.2,18.2*WORLD_EXPANSION],target:[0,2,15*WORLD_EXPANSION],radius:17*WORLD_EXPANSION},
  5:{marker:[CENTRAL_TREE_ANCHOR[0]*WORLD_EXPANSION,CENTRAL_WORLD_TOP+2,CENTRAL_TREE_ANCHOR[1]*WORLD_EXPANSION],
    target:[CENTRAL_TREE_ANCHOR[0]*WORLD_EXPANSION,CENTRAL_WORLD_TOP*.5,CENTRAL_TREE_ANCHOR[1]*WORLD_EXPANSION],radius:45},
};
