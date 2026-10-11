import { mainlandPoint,type Mainland } from './worldPlacement';
export type IslandRegion = Mainland|'central';
export type IslandPoint = readonly [number,number];
export const MAP_RADIUS = 23.6;
export interface WorldIsland {
  readonly id:string;readonly region:IslandRegion;readonly major:boolean;readonly toxic:boolean;
  readonly outline:readonly IslandPoint[];readonly area:number;
  readonly bounds:readonly [number,number,number,number];
}

/** Closed, gently rounded coasts retain the headlands rather than becoming ellipses. */
function island(id:string,region:IslandRegion,points:readonly IslandPoint[],major=false,toxic=false):WorldIsland {
  let outline=points;
  for(let pass=0;pass<2;pass++){
    const next:IslandPoint[]=[];
    for(let i=0;i<outline.length;i++){
      const a=outline[i]!,b=outline[(i+1)%outline.length]!;
      next.push([a[0]*.82+b[0]*.18,a[1]*.82+b[1]*.18],[a[0]*.18+b[0]*.82,a[1]*.18+b[1]*.82]);
    }
    outline=next;
  }
  let area=0;
  for(let i=0;i<outline.length;i++){const a=outline[i]!,b=outline[(i+1)%outline.length]!;area+=a[0]*b[1]-b[0]*a[1];}
  return {id,region,major,toxic,outline,area:Math.abs(area)*.5,
    bounds:[Math.min(...outline.map(p=>p[0])),Math.min(...outline.map(p=>p[1])),Math.max(...outline.map(p=>p[0])),Math.max(...outline.map(p=>p[1]))]};
}
function islet(id:string,region:IslandRegion,x:number,z:number,rx:number,rz:number,angle:number,toxic=false):WorldIsland {
  const points:IslandPoint[]=[];
  for(let i=0;i<13;i++){
    const a=i/13*Math.PI*2,r=1+Math.sin(i*2.7+x)*.15+Math.cos(i*1.8+z)*.09;
    const px=Math.cos(a)*rx*r,pz=Math.sin(a)*rz*r;
    points.push([x+px*Math.cos(angle)-pz*Math.sin(angle),z+px*Math.sin(angle)+pz*Math.cos(angle)]);
  }
  return island(id,region,points,false,toxic);
}
const MAINLAND_RIM=22.35;
/** Only the uninhabited outer coast is tucked inside the rim; settlements translate rigidly. */
function mainlandOutline(id:Mainland,points:readonly IslandPoint[]):readonly IslandPoint[] {
  return points.map(([x,z]):IslandPoint=>{
    const [px,pz]=mainlandPoint(id,x,z),r=Math.hypot(px,pz);
    return r>MAINLAND_RIM?[px*MAINLAND_RIM/r,pz*MAINLAND_RIM/r]:[px,pz];
  });
}
function mainland(id:Mainland,points:readonly IslandPoint[]):WorldIsland {
  return island(id,id,mainlandOutline(id,points),true);
}
const HUMAN_COAST:readonly IslandPoint[]=[
  [-2.6,7.83],[-4,7.85],[-5.6,8.05],[-7.1,7.15],[-8.7,7.65],[-10.3,6.9],[-12.2,8.3],[-14,10.2],
  [-15.5,9.1],[-14.8,6.6],[-17.1,6],[-19.8,3.3],[-18.4,1.6],[-20,-.7],[-18.3,-2.7],
  [-15.1,-4.7],[-12.6,-6.1],[-10.2,-5.5],[-9,-3.4],[-6.8,-3.5],[-5,-2.5],
  [-4.1,-1],[-2.3,-.6],[.7,1.1],[.65,2.6],[-.9,3.8],[.1,5.5],[-.9,7.05],[-1.6,7.83],
];
const DEMON_COAST:readonly IslandPoint[]=[
  [3.1,-3.9],[5.1,-4.5],[7.7,-3.7],[9.5,-5.3],[12.4,-4.5],[13.6,-2.8],[16,-3.2],[18.8,-.9],
  [17.6,1.1],[20,2.7],[18.6,5.3],[16.2,5.4],[15.5,8.2],[13.6,7.3],[12.4,9.7],[10.2,8.7],
  [10.5,6.1],[8.6,5.9],[7.4,7.5],[5.2,6.4],[4.3,4.4],[3.6,3.6],[3.2,1.3],[2.8,-1.2],
];
/** Baselines are the previous smoothed coasts, not rough bounding-box estimates. */
export const MAINLAND_BASE_AREAS:Readonly<Record<'human'|'demon',number>>={
  human:mainland('human',HUMAN_COAST).area,demon:mainland('demon',DEMON_COAST).area,
};
export const MAINLAND_AREA_GROWTH=1.17;
/** Extend selected north/south shores only; preserve east/west channels and the fortress inlet. */
function expandedMainland(id:'human'|'demon',points:readonly IslandPoint[],moves:Readonly<Record<number,number>>):WorldIsland {
  const base=mainlandOutline(id,points);
  const edge=base.map(([x,z],i):IslandPoint=>{
    const limit=Math.sqrt(Math.max(0,MAINLAND_RIM**2-x*x));
    return [x,Math.max(-limit,Math.min(limit,z+(moves[i]??0)))];
  });
  const at=(amount:number):WorldIsland=>island(id,id,base.map(([x,z],i):IslandPoint=>[x,z+(edge[i]![1]-z)*amount]),true);
  const target=MAINLAND_BASE_AREAS[id]*MAINLAND_AREA_GROWTH;
  let low=0,high=1;
  for(let i=0;i<24;i++){
    const mid=(low+high)*.5;
    if(at(mid).area<target)low=mid;else high=mid;
  }
  return at(high);
}
export const WORLD_ISLANDS:readonly WorldIsland[]=[
  expandedMainland('human',HUMAN_COAST,{2:.9,3:1.8,4:1.9,5:1.8,6:.8,16:-2.5,17:-3.4,18:-3.8,19:-3.8,20:-3.2,21:-2.2,22:-.9}),
  expandedMainland('demon',DEMON_COAST,{0:-2.8,1:-3.7,2:-4,3:-3.7,4:-3,5:-2.5,6:-1.3,23:-.9}),
  mainland('sacred',[
    [-4.5,-4.6],[-5.8,-6.2],[-5.9,-8.6],[-7.1,-10.7],[-5.3,-12.5],[-3.4,-11.9],[-2.2,-15.1],
    [.2,-16.2],[2.5,-14.4],[3.2,-12.2],[5.6,-11.7],[7.2,-9.2],[6.9,-6.1],[4.8,-5.2],
    [2.7,-5.8],[1.5,-4.5],[-.2,-4.1],[-2.2,-4.8],
  ]),
  islet('south-west-1','human',-15,13,1.7,.85,-.45),
  islet('south-west-2','human',-11.4,14.8,1.1,2.3,.55),
  islet('south-west-3','human',-7.2,11.5,1.8,1.05,-.3),
  islet('south-west-4','human',-5.5,17.4,.9,1.6,.65),
  islet('south-middle-1','human',-1.6,13.3,1.5,.85,.2),
  islet('south-middle-2','human',1.3,18.2,2.1,1.15,-.4),
  islet('south-middle-3','human',3.1,11,.65,.85,.4),
  islet('toxic-main','demon',7.6,13.2,2.05,1.45,.3,true),
  islet('toxic-east','demon',12.1,12.2,1.2,1.8,-.3,true),
  islet('toxic-south','demon',8.9,17.2,1.3,.85,.4,true),
  islet('toxic-reef','demon',5.1,16.1,.55,.75,-.25,true),
  islet('south-east','demon',15.8,10.6,.85,1.35,.5),
  island('central-heart','central',[
    [-1.1,-4.9],[.6,-4.4],[1.4,-2.9],[3.1,-3.7],[4.4,-2.5],[3.5,-1.2],[5.1,-.2],
    [4.5,1.2],[3.4,1.6],[5.4,3.3],[4.6,4.8],[2.6,3.7],[2.1,5.2],[3.2,6.5],
    [2.2,7.7],[.9,6.2],[-.2,7.8],[-1.5,7.1],[-.9,5.5],[-2.4,4.9],[-3.6,6.1],
    [-4.8,5.2],[-3.5,3.7],[-5.3,2.9],[-4.5,1.2],[-5.2,-.6],[-3.9,-1.5],[-4.3,-3.1],[-2.6,-3.8],
  ]),
  islet('central-west','central',-5.7,5.9,.68,1.05,-.4),
  islet('central-east','central',6.1,2.1,.65,1.35,.2),
  islet('central-south-west','central',-2.8,8.1,.7,.6,-.4),
  islet('central-south','central',.5,9.4,1.2,.6,.1),
  islet('central-south-east','central',4.6,7.8,.65,.9,.45),
];
export const CENTRAL_ISLANDS=WORLD_ISLANDS.filter(i=>i.region==='central');
export const SOUTHERN_ISLANDS=WORLD_ISLANDS.filter(i=>!i.major&&i.region!=='central');
export const MAJOR_ISLANDS=WORLD_ISLANDS.filter(i=>i.major);
export const TOXIC_ISLANDS=WORLD_ISLANDS.filter(i=>i.toxic);
export const TOXIC_STAGE_ANCHOR:IslandPoint=[7.6,13.2];
export const CHAPTER_FOCI:readonly {readonly center:IslandPoint;readonly radius:number}[]=[
  {center:[-15,.5],radius:11.2},{center:[15,4.6],radius:13.9},{center:[.2,-15.5],radius:8.5},
];

/** Polygon tests are used once for the field and exact layout assertions, not per frame. */
export function sampleIslandExact(x:number,z:number):{distance:number;island:WorldIsland|null} {
  let best=-Infinity,owner:WorldIsland|null=null;
  for(const item of WORLD_ISLANDS){
    const [minX,minZ,maxX,maxZ]=item.bounds;
    const boundDistance=Math.hypot(Math.max(minX-x,0,x-maxX),Math.max(minZ-z,0,z-maxZ));
    if(best<0&&boundDistance>-best)continue;
    if(best>0&&boundDistance>0)continue;
    let inside=false,nearest=Infinity;
    for(let i=0,j=item.outline.length-1;i<item.outline.length;j=i++){
      const a=item.outline[j]!,b=item.outline[i]!,dx=b[0]-a[0],dz=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
      nearest=Math.min(nearest,(x-a[0]-t*dx)**2+(z-a[1]-t*dz)**2);
      if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }
    const distance=Math.sqrt(nearest)*(inside?1:-1);
    if(distance>best){best=distance;owner=item;}
  }
  return {distance:best,island:best>=0?owner:null};
}

export const SHORE_FIELD_STEPS=472;
const FIELD_STEPS=SHORE_FIELD_STEPS,FIELD_WIDTH=FIELD_STEPS+1,FIELD_COUNT=FIELD_WIDTH**2,FIELD_STEP=MAP_RADIUS*2/FIELD_STEPS;
export interface ShoreField {readonly distances:Float32Array;readonly owners:Uint8Array}
let field:ShoreField|undefined,known:Uint8Array|undefined,sampled=0;
function fieldStorage():ShoreField {
  if(!field){field={distances:new Float32Array(FIELD_COUNT),owners:new Uint8Array(FIELD_COUNT)};known=new Uint8Array(FIELD_COUNT);}
  return field;
}
function sampleCell(index:number):number {
  const data=fieldStorage();
  if(sampled!==FIELD_COUNT&&!known![index]){
    const x=index%FIELD_WIDTH,z=Math.floor(index/FIELD_WIDTH),sample=sampleIslandExact(x*FIELD_STEP-MAP_RADIUS,z*FIELD_STEP-MAP_RADIUS);
    data.distances[index]=sample.distance;data.owners[index]=sample.island?WORLD_ISLANDS.indexOf(sample.island)+1:0;
    known![index]=1;sampled++;
  }
  return data.distances[index]!;
}
/** Workers request a complete transfer-safe snapshot; sparse main-thread readers never call this. */
export function buildShoreField():ShoreField {
  for(let i=0;i<FIELD_COUNT;i++)sampleCell(i);
  const data=fieldStorage();
  return {distances:data.distances.slice(),owners:data.owners.slice()};
}
/** Takes ownership of worker arrays only after the entire payload has been validated. */
export function installShoreField(data:ShoreField):void {
  if(!(data.distances instanceof Float32Array)||!(data.owners instanceof Uint8Array)||data.distances.length!==FIELD_COUNT||data.owners.length!==FIELD_COUNT)throw new Error('Invalid world shore field dimensions');
  for(let i=0;i<FIELD_COUNT;i++)if(!Number.isFinite(data.distances[i])||data.owners[i]!>WORLD_ISLANDS.length)throw new Error('Invalid world shore field sample');
  field=data;known=undefined;sampled=FIELD_COUNT;
}
export function shoreFieldStats():{readonly sampled:number;readonly total:number;readonly complete:boolean} {
  return {sampled,total:FIELD_COUNT,complete:sampled===FIELD_COUNT};
}
/** Four lazy grid samples use exactly the same Float32 bilinear values as a completed worker field. */
export function coastDistance(x:number,z:number):number {
  const px=Math.max(0,Math.min(FIELD_STEPS-1e-6,(x+MAP_RADIUS)/FIELD_STEP)),pz=Math.max(0,Math.min(FIELD_STEPS-1e-6,(z+MAP_RADIUS)/FIELD_STEP));
  const ix=Math.floor(px),iz=Math.floor(pz),tx=px-ix,tz=pz-iz,k=iz*FIELD_WIDTH+ix;
  return (sampleCell(k)*(1-tx)+sampleCell(k+1)*tx)*(1-tz)+(sampleCell(k+FIELD_WIDTH)*(1-tx)+sampleCell(k+FIELD_WIDTH+1)*tx)*tz;
}
export function islandAt(x:number,z:number):WorldIsland|null {
  if(coastDistance(x,z)<0)return null;
  const ix=Math.max(0,Math.min(FIELD_STEPS,Math.round((x+MAP_RADIUS)/FIELD_STEP))),iz=Math.max(0,Math.min(FIELD_STEPS,Math.round((z+MAP_RADIUS)/FIELD_STEP))),index=iz*FIELD_WIDTH+ix;
  sampleCell(index);
  return WORLD_ISLANDS[field!.owners[index]!-1]??sampleIslandExact(x,z).island;
}
/** Uniformly sample a chosen island's bounding box; callers reject water and cap density. */
export function islandCandidate(index:number,u:number,v:number):IslandPoint {
  const island=WORLD_ISLANDS[index%WORLD_ISLANDS.length]!,[x,z,right,bottom]=island.bounds;
  return [x+(right-x)*u,z+(bottom-z)*v];
}
export function shorePoint(index:number,t:number):IslandPoint {
  const outline=WORLD_ISLANDS[index%WORLD_ISLANDS.length]!.outline,p=t*outline.length,i=Math.floor(p)%outline.length;
  const a=outline[i]!,b=outline[(i+1)%outline.length]!,f=p-Math.floor(p);
  return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
}
