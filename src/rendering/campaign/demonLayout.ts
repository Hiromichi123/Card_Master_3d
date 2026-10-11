import type { GeographicPoint } from './worldPlacement';
import { demonMountainRelief } from './demonScenery';

export type DemonStageId='2-1'|'2-2'|'2-3'|'2-4';
export interface DemonSite {
  readonly center:GeographicPoint;readonly flag:GeographicPoint;
  /** Horizontal model footprint; geography is five times smaller. */
  readonly radius:number;readonly viewRadius:number;readonly focusHeight:number;readonly modelScale:number;
}
export const DEMON_SITES:Readonly<Record<DemonStageId,DemonSite>>={
  '2-1':{center:[7.6,13],flag:[7.6,13.65],radius:1.6,viewRadius:4.5,focusHeight:1.5,modelScale:.5},
  '2-2':{center:[12,-4],flag:[12,-2.65],radius:2.8,viewRadius:9,focusHeight:3.5,modelScale:.5},
  '2-3':{center:[19,1],flag:[19,2.3],radius:6,viewRadius:14,focusHeight:4,modelScale:1},
  '2-4':{center:[13.5,4.2],flag:[13.5,2.45],radius:7,viewRadius:12,focusHeight:1,modelScale:1},
};
export const DEMON_MAINLAND_STAGES:readonly DemonStageId[]=['2-2','2-3','2-4'];
export const DEMON_PIT_RADIUS=1.4;
export const DEMON_PIT_FLOOR=-2.85;
export const DEMON_TEMPLE_BASIN_RADIUS=2;
export function demonStage(id:string):DemonSite|undefined {
  return Object.prototype.hasOwnProperty.call(DEMON_SITES,id)?DEMON_SITES[id as DemonStageId]:undefined;
}
function smooth(a:number,b:number,x:number):number {const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}
export function demonPitDistance(x:number,z:number):number {
  const p=DEMON_SITES['2-4'].center;return Math.hypot(x-p[0],z-p[1]);
}
/** Absolute model height; a raised rim gives depth without cutting through the display base. */
export function demonPitHeight(x:number,z:number):number {
  const [cx,cz]=DEMON_SITES['2-4'].center,r=demonPitDistance(x,z)/DEMON_PIT_RADIUS,a=Math.atan2(z-cz,x-cx);
  const step=Math.min(1,r)*6,whole=Math.floor(step);
  const terrace=(whole+smooth(.78,1,step-whole))/6;
  const profile=DEMON_PIT_FLOOR+5.7*(smooth(.1,1,r)*.8+terrace*.2);
  return profile+Math.sin(a*5-r*15)*.14*smooth(.2,.45,r)*(1-smooth(.85,1,r));
}
/** Pure geographic relief: the caller restricts this to the main demon island. */
export function demonRelief(x:number,z:number,coast:number):number {
  const fade=smooth(.05,.8,coast);
  const ridge=2.8*Math.exp(-((x-16.1)**2/5+(z+1.9)**2/24));
  const broken=.5+.48*Math.sin(x*1.4+z*.7)+.22*Math.sin(z*2.3-x*.45);
  const ravine=.9*Math.exp(-((z-(.6+Math.sin(x*.65)*1.5))**2)/.65);
  let h=.65+ridge+broken-ravine;
  const tower=DEMON_SITES['2-2'].center,rt=Math.hypot(x-tower[0],z-tower[1]);
  h+=2.2*Math.exp(-rt*rt/12);
  h=h*(smooth(1.25,1.85,rt))+3.2*(1-smooth(1.25,1.85,rt));
  const temple=DEMON_SITES['2-3'].center,rb=Math.hypot(x-temple[0],z-temple[1]);
  const entrance=(1-smooth(.18,.42,Math.abs(x-temple[0])))*smooth(.8,1.25,z-temple[1]);
  const wall=3.4*Math.exp(-(((rb-(DEMON_TEMPLE_BASIN_RADIUS-.35))/.28)**2))*(.86+.14*Math.sin(Math.atan2(z-temple[1],x-temple[0])*7))*(1-entrance*.92);
  h=h*smooth(1.05,1.45,rb)+.65*(1-smooth(1.05,1.45,rb))+wall;
  const pit=demonPitDistance(x,z),blend=1-smooth(DEMON_PIT_RADIUS,DEMON_PIT_RADIUS+.25,pit);
  h=h*(1-blend)+demonPitHeight(x,z)*blend;
  const protectedArea=smooth(1.9,2.25,rt)*smooth(2.2,2.6,rb)*smooth(DEMON_PIT_RADIUS+.4,DEMON_PIT_RADIUS+.75,pit);
  h+=demonMountainRelief(x,z)*protectedArea;
  return h*fade;
}
const vegetationSites=Object.entries(DEMON_SITES);
export function demonVegetationSafe(x:number,z:number):boolean {
  for(const [id,site] of vegetationSites){
    const r=Math.hypot(x-site.center[0],z-site.center[1]);
    const radius=id==='2-4'?DEMON_PIT_RADIUS+.4:id==='2-3'?1.45:(site.radius+1)/5;
    if(r<radius||Math.hypot(x-site.flag[0],z-site.flag[1])<.16)return false;
  }
  return true;
}
