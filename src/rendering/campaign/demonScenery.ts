import type { GeographicPoint } from './worldPlacement';

export const DEMON_ROAD_HALF_WIDTH=.22;
const controls:readonly (readonly GeographicPoint[])[]=[
  [[12,-3.45],[12,-2.65],[12.7,-1.6],[14,-.9],[14.8,.1]],
  [[14.8,.1],[15.7,1.4],[16.7,2.9],[18,3.4],[19,2.8],[19,2.3],[19,2.05]],
  [[14.8,.1],[14.6,1.1],[14.1,1.9],[13.5,2.45]],
];
function smoothRoute(source:readonly GeographicPoint[]):readonly GeographicPoint[] {
  let points=[...source];
  for(let pass=0;pass<2;pass++){
    const next:GeographicPoint[]=[points[0]!];
    for(let i=1;i<points.length;i++){
      const a=points[i-1]!,b=points[i]!;
      next.push([a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25],[a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75]);
    }
    next.push(points[points.length-1]!);points=next;
  }
  return points;
}
export const DEMON_ROADS=controls.map(smoothRoute);
export const DEMON_HOUSES:readonly {readonly center:GeographicPoint;readonly width:number;readonly depth:number;readonly height:number}[]=[
  {center:[11.65,-2.05],width:.8,depth:.68,height:.65},
  {center:[12.95,-2.05],width:.9,depth:.72,height:.72},
  {center:[13.55,-.6],width:.76,depth:.7,height:.6},
  {center:[14.65,-.65],width:.95,depth:.72,height:.75},
  {center:[15.65,.6],width:.8,depth:.74,height:.68},
  {center:[15.65,2.3],width:.86,depth:.68,height:.7},
  {center:[16.65,3.45],width:.94,depth:.8,height:.77},
  {center:[17.55,3.8],width:.78,depth:.7,height:.65},
  {center:[18.5,3.55],width:.86,depth:.78,height:.7},
  {center:[13.6,1.6],width:.8,depth:.72,height:.67},
];
export const DEMON_RIDGES:readonly {readonly points:readonly GeographicPoint[];readonly width:number;readonly height:number}[]=[
  {points:[[14.8,-5.1],[16,-5.4],[17.3,-4.7],[18.4,-4]],width:.9,height:3.4},
  {points:[[17.8,5.3],[18.5,5.7],[19.2,5.1],[19.7,4.5]],width:.72,height:2.7},
];
function smooth(a:number,b:number,value:number):number {const t=Math.max(0,Math.min(1,(value-a)/(b-a)));return t*t*(3-2*t);}
export function segmentDistance(x:number,z:number,a:GeographicPoint,b:GeographicPoint):number {
  const dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz;
  const t=length?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/length)):0;
  return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);
}
export function demonRoadDistance(x:number,z:number):number {
  let distance=Infinity;
  for(const points of DEMON_ROADS)for(let i=1;i<points.length;i++){
    const a=points[i-1]!,b=points[i]!;
    if(x<Math.min(a[0],b[0])-distance||x>Math.max(a[0],b[0])+distance||z<Math.min(a[1],b[1])-distance||z>Math.max(a[1],b[1])+distance)continue;
    distance=Math.min(distance,segmentDistance(x,z,a,b));
  }
  return distance;
}
export function demonHouseClear(x:number,z:number,padding=.12):boolean {
  return DEMON_HOUSES.every(h=>Math.abs(x-h.center[0])>h.width*.13+padding||Math.abs(z-h.center[1])>h.depth*.13+padding);
}
export function demonScenerySafe(x:number,z:number):boolean {
  return demonRoadDistance(x,z)>.15&&demonHouseClear(x,z);
}
/** Compact ridges leave the road corridor and house foundations clear. */
export function demonMountainRelief(x:number,z:number):number {
  let height=0;
  for(const ridge of DEMON_RIDGES){
    let d=Infinity;
    for(let i=1;i<ridge.points.length;i++)d=Math.min(d,segmentDistance(x,z,ridge.points[i-1]!,ridge.points[i]!));
    const mask=1-smooth(0,ridge.width,d);
    height+=ridge.height*mask*(.72+.28*Math.sin(x*5.3+z*3.7)**2);
  }
  if(!height)return 0;
  return height*smooth(.18,.65,demonRoadDistance(x,z))*(demonHouseClear(x,z,.3)?1:0);
}
