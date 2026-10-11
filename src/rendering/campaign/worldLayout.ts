import { mainlandPoint } from './worldPlacement';
export type MapPoint = readonly [number, number];

export const WORLD_EXPANSION = 5;
export const SEA_LEVEL = .025;
export const SEA_WAVE_HEIGHT = .019;
export const FORTRESS_ANCHOR:MapPoint = mainlandPoint('human',-2.6,7.4);
export const TOWN_ANCHOR:MapPoint = mainlandPoint('human',-2.75,6.05);
/** Architecture is in unexpanded model units; anchors are in geographic map units. */
export const TOWN_RADIUS = 3.7;
export const TOWN_GATE_HALF_WIDTH = .46;
export const FORTRESS_FLAG:MapPoint = [FORTRESS_ANCHOR[0]+.63,FORTRESS_ANCHOR[1]-.12];
export { coastDistance } from './worldIslands';

/** Local decorative randomness never consumes the battle RNG. */
export function rand(i:number,salt=0):number {
  const v=Math.sin(i*127.1+salt*311.7+19.9)*43758.5453;
  return v-Math.floor(v);
}
export interface TownHouse {
  readonly x:number;readonly z:number;readonly angle:number;
  readonly width:number;readonly depth:number;readonly height:number;readonly radius:number;
}
/** Rejection packing leaves a main street, a small square and clearance for roof overhangs. */
export function buildTownLayout():readonly TownHouse[] {
  const houses:TownHouse[]=[];
  for(let i=0;i<4000&&houses.length<24;i++){
    const angle=rand(i,201)*Math.PI*2,r=Math.sqrt(rand(i,202))*(TOWN_RADIUS-.48);
    const x=Math.cos(angle)*r,z=Math.sin(angle)*r;
    const width=.49+rand(i,203)*.18,depth=.4+rand(i,204)*.14;
    const radius=Math.hypot(width*1.16,depth*1.18)*.5;
    if(r+radius>TOWN_RADIUS-.3||r<.68||Math.abs(x)<.29+radius||houses.some(h=>Math.hypot(x-h.x,z-h.z)<radius+h.radius+.09))continue;
    houses.push({x,z,width,depth,radius,height:.45+rand(i,205)*.3,angle:(rand(i,206)-.5)*1.2+(x<0?-.35:.35)});
  }
  return houses;
}
export const TOWN_HOUSES = buildTownLayout();
export function townContains(x:number,z:number,padding=.2):boolean {
  return Math.hypot((x-TOWN_ANCHOR[0])*WORLD_EXPANSION,(z-TOWN_ANCHOR[1])*WORLD_EXPANSION)<TOWN_RADIUS+padding;
}
export function fortressContains(x:number,z:number):boolean {
  return Math.abs((x-FORTRESS_ANCHOR[0])*WORLD_EXPANSION)<3.55&&Math.abs((z-FORTRESS_ANCHOR[1])*WORLD_EXPANSION)<2.7;
}
