export interface MoonIsland {
  readonly id:string;
  /** Local model units before WORLD_SCALE, not geographic coordinates. */
  readonly position:readonly [number,number,number];
  readonly radius:number;
  readonly depth:number;
  readonly seed:number;
}

/** One inhabited plateau and five separated fragments at different elevations. */
export const MOON_ISLANDS = [
  {id:'moon-capital',position:[14,28,-50],radius:3,depth:4.1,seed:9},
  {id:'moon-west',position:[7.6,25,-47.4],radius:1.65,depth:2.65,seed:311},
  {id:'moon-east',position:[20.8,30.5,-48.3],radius:1.8,depth:3.1,seed:327},
  {id:'moon-crown',position:[10.5,32,-56.8],radius:1.25,depth:2.1,seed:343},
  {id:'moon-rear',position:[17,24.5,-55.9],radius:.95,depth:1.9,seed:359},
  {id:'moon-front',position:[16.2,26,-43.4],radius:1.4,depth:2.3,seed:373},
] as const satisfies readonly MoonIsland[];

export const MOON_ORIGIN = MOON_ISLANDS[0].position;
/** Includes the raised meadow top, excluding the decorative cloud bank. */
export const MOON_MAX_HEIGHT = Math.max(...MOON_ISLANDS.map(island=>island.position[1]+.4));
export const MOON_VIEW_DISTANCE = 160;
