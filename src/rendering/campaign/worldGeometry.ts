import {
  BufferGeometry, CatmullRomCurve3, Color, Float32BufferAttribute, Vector3,
} from 'three';

export type Vec3 = readonly [number, number, number];
export interface PropInstance {
  readonly position: Vec3;
  readonly scale: Vec3;
  readonly rotation?: Vec3;
  readonly color: string;
}
export interface CloudInstance {
  readonly position: Vec3;
  readonly size: readonly [number, number];
  readonly color: string;
  readonly opacity: number;
  readonly seed: number;
}
import { coastDistance, FORTRESS_FLAG, fortressContains, rand, SEA_LEVEL, SEA_WAVE_HEIGHT, TOWN_ANCHOR, TOWN_HOUSES, townContains, WORLD_EXPANSION } from './worldLayout';
export { WORLD_EXPANSION, rand } from './worldLayout';
import { CHAPTER_FOCI, islandAt, islandCandidate, MAP_RADIUS, shorePoint, TOXIC_ISLANDS } from './worldIslands';
import { DEMON_SITES, DEMON_PIT_RADIUS, demonPitDistance, demonRelief, demonVegetationSafe } from './demonLayout';
import { MOON_ISLANDS, MOON_ORIGIN } from './moonLayout';
import { FUTURE_CHAPTER_VIEWS } from './worldFutureChapters';
import { demonScenerySafe } from './demonScenery';
import { CENTRAL_TREE_ANCHOR, CENTRAL_TREE_ROOT_RADIUS, mainlandOriginal, mainlandPoint, type Mainland } from './worldPlacement';
export { MOON_ORIGIN } from './moonLayout';
export const WORLD_RADIUS=MAP_RADIUS*WORLD_EXPANSION;
/** Architectural models retain the previous five-unit scale; only geography expands again. */
export const WORLD_SCALE=5;
export function landmarkPoint(x:number,z:number,height=0):Vec3 {
  const px=x*WORLD_EXPANSION,pz=z*WORLD_EXPANSION;return [px,terrainHeight(px,pz)+height,pz];
}
export function mainlandLandmark(region:Mainland,x:number,z:number,height=0):Vec3 {
  return landmarkPoint(...mainlandPoint(region,x,z),height);
}
export function getWorldMarkers():readonly Vec3[] {
  return [...CHAPTER_FOCI.map(f=>landmarkPoint(...f.center,5.2)),[MOON_ORIGIN[0],MOON_ORIGIN[1]+2.6,MOON_ORIGIN[2]],
    FUTURE_CHAPTER_VIEWS[4]!.marker,FUTURE_CHAPTER_VIEWS[5]!.marker];
}
export const STAGE_LANDMARKS:Readonly<Record<string,readonly [number,number]>>={
  '1-1':FORTRESS_FLAG,'1-2':mainlandPoint('human',-4.15,3),'1-3':mainlandPoint('human',-6.65,-.75),'1-4':mainlandPoint('human',-7.75,4.05),
  '2-1':DEMON_SITES['2-1'].flag,'2-2':DEMON_SITES['2-2'].flag,'2-3':DEMON_SITES['2-3'].flag,'2-4':DEMON_SITES['2-4'].flag,
  '3-1':mainlandPoint('sacred',0,-4.95),'3-2':mainlandPoint('sacred',-3.5,-6.3),'3-3':mainlandPoint('sacred',1.6,-8),'3-4':mainlandPoint('sacred',5.3,-6.8),
  '5-1':[-7.2,11.5],'5-2':[-1.6,13.3],'5-3':[-5.5,17.4],'5-4':[1.3,18.2],
  '6-1':[-3.5,3.7],'6-2':[3.4,1.6],'6-3':[-2.8,8.1],'6-4':[.5,9.4],
};
export function stagePoint(id:string,height=0):Vec3 {
  // Moon islands use elevated model coordinates, unlike the ground map.
  const moonIndex=({'4-1':1,'4-2':2,'4-3':3,'4-4':0} as Readonly<Record<string,number>>)[id];
  if(moonIndex!==undefined){const island=MOON_ISLANDS[moonIndex]!;
    return [island.position[0]+.35,island.position[1]+.3+height,island.position[2]+.25];}
  const point:readonly [number,number]=STAGE_LANDMARKS[id]??[0,0];return landmarkPoint(point[0],point[1],height);
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
/** Southern islets keep their own coordinates instead of inheriting a mainland translation. */
function landscapePoint(x:number,z:number):readonly [number,number] {
  const island=islandAt(x,z);
  return island?.major&&island.region!=='central'?mainlandOriginal(island.region,x,z):[x,z];
}
/** Biomes are overlapping landscape masks, never angular chapter sectors. */
export function biomeAt(x: number, z: number): {snow:number;volcanic:number;demon:number;sacred:number;sea:number;pit:number} {
  x/=WORLD_EXPANSION;z/=WORLD_EXPANSION;
  const island=islandAt(x,z),region=island?.region,[lx,lz]=landscapePoint(x,z);
  const n=Math.sin(lx*1.17+lz*.62)*.13+Math.sin(lz*1.8-lx*.35)*.08;
  return {
    snow:island?.id==='human'?1-smooth(.72,1.28,Math.hypot((lx+8.1)/3.75,(lz+1.05)/3.3)+n):0,
    volcanic:island?.id==='human'?1-smooth(2.35,3.85,Math.hypot(lx+7.75,lz-4.05)+n*.65):0,
    demon:region==='demon'?1:0,
    sacred:region==='sacred'?1:0,
    sea:1+coastDistance(x,z)*.5,
    pit:island?.id==='demon'?demonPitDistance(x,z):100,
  };
}
/** Broken shelves and radial ravines leave a solid platform beneath the great tree. */
function centralRelief(x:number,z:number,distance:number):number {
  const dx=x-CENTRAL_TREE_ANCHOR[0],dz=z-CENTRAL_TREE_ANCHOR[1],r=Math.hypot(dx,dz),a=Math.atan2(dz,dx);
  const warped=r+Math.sin(a*3+.7)*.32+Math.sin(a*7-r*.55)*.21;
  const shelves=.8+1.05*(1-smooth(3.2,3.65,warped))+1.1*(1-smooth(1.8,2.2,warped));
  const fissure=(1-smooth(.025,.12,Math.abs(Math.sin(a*4.5+r*.13))))*smooth(1.2,2.6,r);
  const ridges=Math.abs(Math.sin(a*5-r*.32))*.32*smooth(1,2.6,r);
  return smooth(.05,.42,distance)*(shelves+ridges-fissure*.85);
}
/** Legacy callers may supply a chapter index; all sample the same continuous height field. */
export function terrainHeight(x:number,z:number,_region=0):number {
  const b=biomeAt(x,z);x/=WORLD_EXPANSION;z/=WORLD_EXPANSION;
  const island=islandAt(x,z),[lx,lz]=landscapePoint(x,z);
  let h=.17+Math.sin(lx*.8+lz*.37)*.09+Math.cos(lz*1.03-lx*.23)*.065+Math.sin(lx*2.3-lz*1.7)*.025;
  h+=b.snow*(.22+Math.sin(lx*1.2)*Math.cos(lz*1.05)*.16);
  h+=b.sacred*(.19+.16*Math.sin(lx*.8+lz*.3)**2);
  if(island?.region==='central')h+=centralRelief(x,z,coastDistance(x,z));
  else if(island?.id==='demon')h=demonRelief(x,z,coastDistance(x,z));
  else if(island?.major){
    const inland=smooth(1.2,1.9,b.sea);
    const ridge=Math.exp(-((lx+13)**2/14+(lz-1.2)**2/26))+Math.exp(-((lx-13)**2/13+(lz-.5)**2/16));
    h+=inland*ridge*(.35+.5*Math.abs(Math.sin(lx*.9+lz*.42)));
  }
  const sea=1-smooth(.84,1.13,b.sea);h=h*(1-sea)-.65*sea;
  // The meadow stream follows the human mainland, never the new central plateau.
  const riverZ=1.55+Math.sin(lx*.85)*.42;
  const river=island?.id==='human'?(1-smooth(.075,.19,Math.abs(lz-riverZ)))*smooth(-7.1,-5.9,lx)*(1-smooth(-.2,.35,lx)):0;
  return h-river*.15;
}
function groundColor(x:number,z:number):Color {
  const b=biomeAt(x,z),c=new Color('#6f8557');
  c.lerp(new Color('#795854'),b.demon*.9);
  c.lerp(new Color('#9da59a'),b.sacred*.7);
  c.lerp(new Color('#cddddd'),b.snow);
  c.lerp(new Color('#38383d'),b.volcanic);
  if(islandAt(x/WORLD_EXPANSION,z/WORLD_EXPANSION)?.id==='demon'){
    const h=terrainHeight(x,z),slope=Math.hypot(terrainHeight(x+.25,z)-terrainHeight(x-.25,z),terrainHeight(x,z+.25)-terrainHeight(x,z-.25))/.5;
    c.set('#865344').lerp(new Color('#423d43'),smooth(.3,1.2,slope));
    c.lerp(new Color('#aa7560'),smooth(2,4.8,h)*.4);
  }
  c.lerp(new Color('#392447'),(1-smooth(DEMON_PIT_RADIUS,DEMON_PIT_RADIUS+.3,b.pit))*.95);
  if(islandAt(x/WORLD_EXPANSION,z/WORLD_EXPANSION)?.region==='central'){
    const slope=Math.hypot(terrainHeight(x+.3,z)-terrainHeight(x-.3,z),terrainHeight(x,z+.3)-terrainHeight(x,z-.3))/.6;
    c.set('#658255').lerp(new Color('#918d79'),smooth(.2,.85,slope));
    c.multiplyScalar(.9+.1*Math.sin(terrainHeight(x,z)*8));
  }
  const coast=(1-smooth(1.1,1.24,b.sea))*smooth(.89,1.01,b.sea);
  c.lerp(new Color('#c0b18d'),coast*.85);
  c.lerp(new Color('#344d50'),(1-smooth(.77,.97,b.sea))*.65);
  return c.multiplyScalar(.96+.045*Math.sin(x*2.15+z*3.6));
}
/** One closed disk surface. Only its outer circumference has a cliff wall. */
export function buildTerrain(detail:number):BufferGeometry {
  const positions:number[]=[],colors:number[]=[],indices:number[]=[];
  const rings=detail*6,segments=detail*18;
  positions.push(0,terrainHeight(0,0),0);const center=groundColor(0,0);colors.push(center.r,center.g,center.b);
  for(let r=1;r<=rings;r++)for(let s=0;s<=segments;s++){
    const a=s/segments*Math.PI*2,radius=WORLD_RADIUS*r/rings*(1-.004*Math.sin(a*17));
    const x=Math.cos(a)*radius,z=Math.sin(a)*radius,c=groundColor(x,z);
    positions.push(x,terrainHeight(x,z),z);colors.push(c.r,c.g,c.b);
  }
  // Refine only the abyss, even at low quality. Shared edge decisions avoid cracks.
  const pit=DEMON_SITES['2-4'].center,px=pit[0]*WORLD_EXPANSION,pz=pit[1]*WORLD_EXPANSION;
  const extent=(DEMON_PIT_RADIUS+.3)*WORLD_EXPANSION,midpoints=new Map<string,number>();
  const edgeLength=(a:number,b:number):number=>{
    const ax=positions[a*3]!,az=positions[a*3+2]!,bx=positions[b*3]!,bz=positions[b*3+2]!;
    if(Math.max(ax,bx)<px-extent||Math.min(ax,bx)>px+extent||Math.max(az,bz)<pz-extent||Math.min(az,bz)>pz+extent)return 0;
    return Math.hypot(ax-bx,az-bz);
  };
  const midpoint=(a:number,b:number):number=>{
    const key=a<b?`${a}:${b}`:`${b}:${a}`,known=midpoints.get(key);if(known!==undefined)return known;
    const x=(positions[a*3]!+positions[b*3]!)/2,z=(positions[a*3+2]!+positions[b*3+2]!)/2,c=groundColor(x,z),index=positions.length/3;
    positions.push(x,terrainHeight(x,z),z);colors.push(c.r,c.g,c.b);midpoints.set(key,index);return index;
  };
  const triangle=(a:number,b:number,c:number):void=>{
    const ab=edgeLength(a,b),bc=edgeLength(b,c),ca=edgeLength(c,a),longest=Math.max(ab,bc,ca);
    if(longest<=.18){indices.push(a,b,c);return;}
    if(ab===longest){const m=midpoint(a,b);triangle(a,m,c);triangle(m,b,c);}
    else if(bc===longest){const m=midpoint(b,c);triangle(b,m,a);triangle(m,c,a);}
    else {const m=midpoint(c,a);triangle(c,m,b);triangle(m,a,b);}
  };
  for(let s=0;s<segments;s++)triangle(0,1+s+1,1+s);
  for(let r=0;r<rings-1;r++)for(let s=0;s<segments;s++){
    const a=1+r*(segments+1)+s,b=a+segments+1;triangle(a,a+1,b);triangle(a+1,b+1,b);
  }
  const start=1+(rings-1)*(segments+1);
  for(let s=0;s<segments;s++){
    const a=start+s,b=a+1,k=positions.length/3;
    positions.push(positions[a*3]!,positions[a*3+1]!,positions[a*3+2]!,positions[b*3]!,positions[b*3+1]!,positions[b*3+2]!,
      positions[a*3]!,-3.2,positions[a*3+2]!,positions[b*3]!,-3.2,positions[b*3+2]!);
    for(let j=0;j<4;j++)colors.push(.23,.25,.25);indices.push(k,k+1,k+2,k+1,k+3,k+2);
  }
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('color',new Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();return g;
}

/** Subdivided sea follows the disk rim; inland depressions never receive a water surface. */
export function buildSea(detail:number):BufferGeometry {
  const vertices:number[]=[],shore:number[]=[],indices:number[]=[];
  const rings=detail*6,segments=detail*18;
  const add=(x:number,z:number):void=>{vertices.push(x,SEA_LEVEL,z);shore.push(coastDistance(x/WORLD_EXPANSION,z/WORLD_EXPANSION));};
  const triangle=(a:number,b:number,c:number):void=>{if(Math.min(shore[a]!,shore[b]!,shore[c]!)<.4)indices.push(a,b,c);};
  add(0,0);
  for(let r=1;r<=rings;r++)for(let s=0;s<=segments;s++){
    const a=s/segments*Math.PI*2,radius=WORLD_RADIUS*r/rings*(1-.004*Math.sin(a*17));
    add(Math.cos(a)*radius,Math.sin(a)*radius);
  }
  for(let s=0;s<segments;s++)triangle(0,1+s+1,1+s);
  for(let r=0;r<rings-1;r++)for(let s=0;s<segments;s++){
    const a=1+r*(segments+1)+s,b=a+segments+1;triangle(a,a+1,b);triangle(a+1,b+1,b);
  }
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));
  g.setAttribute('aShore',new Float32BufferAttribute(shore,1));g.setIndex(indices);g.computeVertexNormals();return g;
}

/** Terrain-following ribbon avoids the raised pipe appearance of tube roads. */
export function buildPath(points:readonly Vec3[],width:number,offset=.021):BufferGeometry {
  const curve=new CatmullRomCurve3(points.map(p=>new Vector3(...p))),vertices:number[]=[],uv:number[]=[],indices:number[]=[];
  const segments=Math.max(64,points.length*32);
  for(let i=0;i<=segments;i++){
    const p=curve.getPoint(i/segments),t=curve.getTangent(i/segments),normal=new Vector3(-t.z,0,t.x).normalize();
    for(const side of [-1,1]){const x=p.x+normal.x*width*side,z=p.z+normal.z*width*side;
      vertices.push(x,terrainHeight(x,z)+offset,z);uv.push((side+1)*.5,i/segments*points.length*2);}
  }
  for(let i=0;i<segments;i++){const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}

export function buildGrassGeometry():BufferGeometry {
  const vertices:number[]=[];
  for(let blade=0;blade<3;blade++){
    const a=blade*2.399,width=.16,dx=Math.cos(a)*width,dz=Math.sin(a)*width,leanX=Math.cos(a+1)*.25,leanZ=Math.sin(a+1)*.25;
    const levels=[0,.42,.76,1];
    for(let k=0;k<3;k++){
      const y0=levels[k]!,y1=levels[k+1]!,w0=1-y0,w1=1-y1;
      const p0=[leanX*y0*y0-dx*w0,y0,leanZ*y0*y0-dz*w0],p1=[leanX*y0*y0+dx*w0,y0,leanZ*y0*y0+dz*w0];
      const p2=[leanX*y1*y1-dx*w1,y1,leanZ*y1*y1-dz*w1],p3=[leanX*y1*y1+dx*w1,y1,leanZ*y1*y1+dz*w1];
      vertices.push(...p0,...p1,...p2,...p1,...p3,...p2);
    }
  }
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.computeVertexNormals();return g;
}

/** Jagged summit with an open crater, rather than a solid cone. */
export function buildVolcano(): BufferGeometry {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const profile: readonly (readonly [number, number])[] = [[0, .53], [.25, .56], [.36, .98], [.45, 2.08], [.53, 2.17], [.66, 1.56], [.82, .7], [1, .03]];
  const segments = 96;
  profile.forEach(([r, y], k) => {
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * Math.PI * 2, wobble = 1 + Math.sin(a * 7) * .035 + Math.sin(a * 13) * .025;
      positions.push(Math.cos(a) * r * 2.12 * wobble, y + Math.sin(a * 7) * .075 * r, Math.sin(a) * r * 2.12 * wobble);
      const c = new Color(k < 3 ? '#572d30' : '#37363b').multiplyScalar(.85 + rand(i + k * 43, 2) * .25);
      colors.push(c.r, c.g, c.b);
    }
  });
  for (let r = 0; r < profile.length - 1; r++) for (let i = 0; i < segments; i++) {
    const a = r * (segments + 1) + i, b = a + segments + 1;indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new BufferGeometry();g.setAttribute('position', new Float32BufferAttribute(positions, 3));g.setAttribute('color', new Float32BufferAttribute(colors, 3));g.setIndex(indices);g.computeVertexNormals();return g;
}

/** Closed irregular floating island: uneven meadow above, faceted taper below. */
export function buildIsland(radius: number, depth: number, seed: number): BufferGeometry {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [], segments = 64;
  const levels = [[0, .24], [1, 0], [.87, -.36], [.55, -depth * .57], [.07, -depth]] as const;
  levels.forEach(([scale, y], ring) => {
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * Math.PI * 2, r = radius * scale * (.82 + rand(i % segments, seed) * .26);
      positions.push(Math.cos(a) * r + (ring > 2 ? .16 : 0), y + (ring < 2 ? rand(i % segments, seed + 3) * .16 : 0), Math.sin(a) * r);
      const c = new Color(ring < 2 ? '#b5c4bf' : '#667380').multiplyScalar(.77 + rand(i + ring * 17, seed + 4) * .3);colors.push(c.r, c.g, c.b);
    }
  });
  for (let r = 0; r < levels.length - 1; r++) for (let s = 0; s < segments; s++) {
    const a = r * (segments + 1) + s, b = a + segments + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const tip = positions.length / 3;
  positions.push(.16, -depth-.06, 0);colors.push(.3,.34,.39);
  for(let i=0;i<segments;i++)indices.push((levels.length-1)*(segments+1)+i,(levels.length-1)*(segments+1)+i+1,tip);
  const g = new BufferGeometry();g.setAttribute('position', new Float32BufferAttribute(positions, 3));g.setAttribute('color', new Float32BufferAttribute(colors, 3));g.setIndex(indices);g.computeVertexNormals();return g;
}

export interface WorldProps {
  readonly trunks:readonly PropInstance[];readonly crowns:readonly PropInstance[];readonly pines:readonly PropInstance[];readonly branches:readonly PropInstance[];
  readonly houses:readonly PropInstance[];readonly roofs:readonly PropInstance[];readonly basalt:readonly PropInstance[];
  readonly snowPeaks:readonly PropInstance[];readonly sacredPeaks:readonly PropInstance[];readonly clouds:readonly CloudInstance[];
  readonly grasses:readonly PropInstance[];readonly rocks:readonly PropInstance[];readonly flowers:readonly PropInstance[];
  readonly windows:readonly PropInstance[];readonly doors:readonly PropInstance[];readonly beams:readonly PropInstance[];
  readonly snowCaps:readonly PropInstance[];readonly crystals:readonly PropInstance[];readonly shoreRocks:readonly PropInstance[];
}
function beam(a:Vec3,b:Vec3,thickness:number,color:string):PropInstance {
  const delta=new Vector3(...b).sub(new Vector3(...a));return {
    position:[(a[0]+b[0])*.5,(a[1]+b[1])*.5,(a[2]+b[2])*.5],scale:[thickness,delta.length(),thickness],
    rotation:[Math.atan2(delta.z,delta.y),0,-Math.atan2(delta.x,Math.hypot(delta.y,delta.z))],color,
  };
}
function townAt(x:number,z:number):boolean {return townContains(x,z)||fortressContains(x,z);}
function vegetationSafe(x:number,z:number):boolean {
  if(townAt(x,z))return false;
  const island=islandAt(x,z),[lx,lz]=landscapePoint(x,z);
  if(island?.region==='central')return Math.hypot(x-CENTRAL_TREE_ANCHOR[0],z-CENTRAL_TREE_ANCHOR[1])>(CENTRAL_TREE_ROOT_RADIUS+1)/WORLD_EXPANSION;
  if(island?.id==='human')return Math.hypot(lx+4.15,lz-3)>.32;
  if(island?.region==='demon')return demonVegetationSafe(x,z)&&(island.id!=='demon'||demonScenerySafe(x,z));
  return island?.id!=='sacred'||!(Math.abs(lx)<.5&&lz<-4.6&&lz>-5.4);
}
export function buildWorldProps(detail:number):WorldProps {
  const trunks:PropInstance[]=[],crowns:PropInstance[]=[],pines:PropInstance[]=[],branches:PropInstance[]=[],houses:PropInstance[]=[],roofs:PropInstance[]=[],basalt:PropInstance[]=[];
  const snowPeaks:PropInstance[]=[],sacredPeaks:PropInstance[]=[],clouds:CloudInstance[]=[],grasses:PropInstance[]=[],rocks:PropInstance[]=[],flowers:PropInstance[]=[];
  const windows:PropInstance[]=[],doors:PropInstance[]=[],beams:PropInstance[]=[],snowCaps:PropInstance[]=[],crystals:PropInstance[]=[],shoreRocks:PropInstance[]=[];
  // Mixed woodland thins irregularly into foothills, snow, ash and the corrupted eastern forest.
  for(let i=0;i<detail*46*9;i++){
    const [x,z]=islandCandidate(i%7<5?i%3:i,rand(i,1),rand(i,2)),b=localBiome(x,z);
    if(!vegetationSafe(x,z)||b.sea<1.1||b.pit<DEMON_PIT_RADIUS+.4||b.volcanic>.14)continue;
    const [lx,lz]=landscapePoint(x,z);
    const woodland=Math.exp(-((lx+4.5)**2/18+(lz-3.55)**2/16))*.95;
    const dying=b.demon?Math.exp(-((x-16)**2/12+(z+2)**2/22))*.58:0;
    const foothills=Math.exp(-((lx+6.2)**2/15+(lz+.5)**2/10))*.38;
    const density=Math.max(woodland,dying,foothills,.15+b.sacred*.16)*(1-b.snow*.45)*(1-b.sacred*.4);
    if(rand(i,3)>density)continue;
    const y=localHeight(x,z),h=.5+rand(i,4)*.7,size=.24+rand(i,5)*.25;
    if(y<=SEA_LEVEL+SEA_WAVE_HEIGHT)continue;
    const dead=rand(i,6)<b.demon*.95,bark=new Color('#6e5942').lerp(new Color('#722f3f'),b.demon).getStyle();
    trunks.push({position:[x,y+h*.5,z],scale:[.055+rand(i,7)*.035,h,.06],color:bark});
    if(dead){
      for(let k=0;k<4;k++){
        const a=rand(i*4+k,8)*6.28,start:Vec3=[x,y+h*(.34+k*.14),z],end:Vec3=[x+Math.cos(a)*(.25+rand(i,9)*.15),y+h*(.88+k*.06),z+Math.sin(a)*.37];
        branches.push(beam(start,end,.035,'#803844'));
        branches.push(beam(end,[end[0]+Math.cos(a+.6)*.16,end[1]+.23,end[2]+Math.sin(a+.6)*.14],.018,'#953f4a'));
      }
    }else if(rand(i,10)<.28+b.snow*.58){
      for(let tier=0;tier<3;tier++)pines.push({position:[x,y+h*(.45+tier*.25),z],scale:[size*(1-tier*.2),h*.72,size*(1-tier*.2)],color:'#3e6657'});
      if(b.snow>.18)for(let tier=0;tier<2;tier++)snowCaps.push({position:[x,y+h*(.64+tier*.25),z],scale:[size*(.76-tier*.19),h*.34,size*(.76-tier*.19)],color:'#dfebe7'});
    }else{
      const foliage=new Color('#5e8b51').lerp(new Color('#889473'),b.snow*.6).lerp(new Color('#846147'),b.demon*.8).getStyle();
      for(let k=0;k<3;k++)crowns.push({position:[x+(rand(i*3+k,11)-.5)*size*.65,y+h+k*.06,z+(rand(i*3+k,12)-.5)*size*.6],
        scale:[size*(1-k*.13),size*(.78-k*.08),size],color:foliage});
    }
  }
  // Large individual homes: gabled roofs, timber framing, doors and inset windows.
  TOWN_HOUSES.forEach((house,i)=>{
    const {width:w,depth:d,height:h,angle}=house;
    const x=TOWN_ANCHOR[0]*WORLD_EXPANSION+house.x,z=TOWN_ANCHOR[1]*WORLD_EXPANSION+house.z;
    const y=terrainHeight(x,z),c=Math.cos(angle),s=Math.sin(angle);
    const part=(list:PropInstance[],p:Vec3,scale:Vec3,color:string):void=>{list.push({
      position:[x+p[0]*c+p[2]*s,y+p[1],z-p[0]*s+p[2]*c],scale,rotation:[0,angle,0],color,
    });};
    part(houses,[0,h*.5,0],[w,h,d],i%3?'#d8cfb8':'#bcc6b9');
    part(roofs,[0,h,0],[w*1.16,.35,d*1.18],i%3?'#76624d':'#69575b');
    part(doors,[0,.16,d*.5+.008],[.13,.31,.018],'#57493c');
    for(const side of [-1,1]){
      part(windows,[side*w*.3,h*.68,d*.5+.012],[.12,.14,.014],'#e5c58e');
      part(beams,[side*w*.48,h*.5,d*.5+.016],[.027,h,.021],'#685744');
    }
    part(beams,[0,h*.34,d*.5+.017],[w,.023,.02],'#6b5b48');
    part(beams,[w*.23,h+.25,-d*.14],[.09,.38,.1],'#a6a39a');
    part(houses,[0,-.035,0],[w*1.04,.09,d*1.04],'#a9a695');
  });
  // Serrated snow ridge with a lower chain of foothills and visible blue ice outcrops.
  for(let i=0;i<detail*2*3;i++){
    const [x,z]=mainlandPoint('human',-7.2-rand(i,20)*3.3,-3.2+rand(i,21)*4.1);
    if(islandAt(x,z)?.region!=='human'||coastDistance(x,z)<.7)continue;
    const w=.32+rand(i,22)*.74;snowPeaks.push({position:[x,localHeight(x,z),z],scale:[w,.55+rand(i,23)*2.4,w*(.72+rand(i,24)*.38)],rotation:[0,rand(i,25)*6.28,0],color:'#c8dce3'});
  }
  for(let i=0;i<detail*5*5;i++){
    const [x,z]=mainlandPoint('human',-9.9+rand(i,26)*4.3,-2.75+rand(i,27)*4),b=localBiome(x,z);
    if(b.snow<.35||coastDistance(x,z)<.25)continue;
    crystals.push({position:[x,localHeight(x,z)-.025,z],scale:[.09+rand(i,28)*.17,.24+rand(i,29)*.8,.12+rand(i,30)*.15],
      rotation:[(rand(i,31)-.5)*.35,rand(i,32)*6.28,(rand(i,33)-.5)*.3],color:'#7bb8cb'});
  }
  // Basalt fields diminish into scattered volcanic gravel rather than stopping at a border.
  for(let i=0;i<detail*16*6;i++){
    const a=rand(i,34)*6.28,r=1.85+rand(i,35)*1.85,[x,z]=mainlandPoint('human',-7.75+Math.cos(a)*r,4.05+Math.sin(a)*r);
    if(islandAt(x,z)?.region!=='human'||coastDistance(x,z)<.25)continue;
    const h=.08+rand(i,36)*.32;
    basalt.push({position:[x,localHeight(x,z)+h*.5,z],scale:[.08+rand(i,37)*.14,h,.08+rand(i,38)*.12],rotation:[0,rand(i,39)*6.28,0],color:i%2?'#414148':'#2c2e35'});
  }
  // Fine cover spreads across all suitable ground, with biome-driven density and color.
  for(let i=0;i<detail*255*10;i++){
    const [x,z]=islandCandidate(i%7<5?i%3:i,rand(i,40),rand(i,41)),b=localBiome(x,z);
    if(!vegetationSafe(x,z)||b.sea<1.05||b.pit<DEMON_PIT_RADIUS+.4||b.volcanic>.3||b.sacred>.93&&rand(i,85)<.65||rand(i,42)<b.snow*.92)continue;
    const density=(1-b.volcanic)*(1-b.demon*.7);
    if(rand(i,43)>density)continue;
    const y=localHeight(x,z);
    if(y<=SEA_LEVEL+SEA_WAVE_HEIGHT)continue;
    const color=new Color('#6e894d').lerp(new Color('#68715b'),b.snow).lerp(new Color('#8b5e60'),b.demon).multiplyScalar(.83+rand(i,44)*.27).getStyle();
    grasses.push({position:[x,y+.005,z],scale:[.07+rand(i,45)*.05,.1+rand(i,46)*.18,.09],rotation:[0,rand(i,47)*6.28,0],color});
    if(i%31===0&&b.demon<.22&&b.snow<.4)flowers.push({position:[x,y+.12,z],scale:[.038,.043,.04],color:i%3?'#e8d99b':'#b7aad1'});
  }
  for(let i=0;i<detail*18*8;i++){
    const [x,z]=islandCandidate(i%7<5?i%3:i,rand(i,48),rand(i,49)),b=localBiome(x,z);
    if(townAt(x,z)||b.sea<.95||!vegetationSafe(x,z))continue;
    const w=.035+rand(i,50)*.15,c=new Color('#929484').lerp(new Color('#cbd9d9'),b.snow).lerp(new Color('#41424a'),b.volcanic).lerp(new Color('#75657b'),b.demon*.5);
    rocks.push({position:[x,localHeight(x,z)+w*.3,z],scale:[w,w*(.35+rand(i,51)*.5),w*.8],rotation:[0,rand(i,52)*6.28,0],color:c.getStyle()});
  }
  for(let i=0;i<detail*5*5;i++){
    const point=shorePoint(i,rand(i,53)),x=point[0]+(rand(i,54)-.5)*.18,z=point[1]+(rand(i,58)-.5)*.18;
    if(fortressContains(x,z))continue;
    shoreRocks.push({position:[x,localHeight(x,z)+.035,z],scale:[.08+rand(i,55)*.15,.07+rand(i,56)*.1,.09+rand(i,57)*.17],color:'#828d87'});
  }
  for(const side of [-1,1]){
    const [x,z]=mainlandPoint('sacred',side*2.1,-5.65);
    sacredPeaks.push({position:[x,localHeight(x,z),z],scale:[1.35,2.55,1.7],color:'#99a6ad'});
  }
  for(let i=0;i<detail*3*2;i++){
    const [x,z]=islandCandidate(2,rand(i,60),rand(i,61)),[lx,lz]=mainlandOriginal('sacred',x,z);
    if(islandAt(x,z)?.region!=='sacred'||coastDistance(x,z)<.95||Math.abs(lx)<1.65&&lz>-6.2)continue;
    const w=.45+rand(i,62)*1.0;
    sacredPeaks.push({position:[x,localHeight(x,z),z],scale:[w,1.15+rand(i,63)*2.8,w*(.7+rand(i,64)*.4)],rotation:[0,rand(i,65)*6.28,0],color:'#a2acb6'});
  }
  for(let i=0;i<detail*4;i++){
    const [x,z]=islandCandidate(2,rand(i,66),rand(i,67));if(islandAt(x,z)?.region!=='sacred')continue;
    clouds.push({position:[x,2.1+rand(i,68)*2.0,z],size:[2.3+rand(i,69)*2.6,1.2+rand(i,70)*1.7],color:'#d5dfdf',opacity:.79,seed:i*.67+1});
  }
  for(let i=0;i<detail*2*3;i++){
    const island=TOXIC_ISLANDS[i%TOXIC_ISLANDS.length]!,[left,top,right,bottom]=island.bounds;
    const x=left+(right-left)*rand(i,71),z=top+(bottom-top)*rand(i,72);
    if(islandAt(x,z)?.id!==island.id||Math.hypot(x-DEMON_SITES['2-1'].center[0],z-DEMON_SITES['2-1'].center[1])<1.5)continue;
    clouds.push({position:[x,localHeight(x,z)+.58+rand(i,73)*.6,z],size:[.65+rand(i,74)*1.1,.5+rand(i,75)*.55],color:'#839769',opacity:.32,seed:i*.81+30});
  }
  const [volcanoX,volcanoZ]=mainlandPoint('human',-7.75,4.05);
  for(let i=0;i<10;i++)clouds.push({position:[volcanoX+(rand(i,81)-.5)*.55,2.8+i*.16,volcanoZ+(rand(i,82)-.5)*.4],size:[.6+i*.11,.5+i*.08],color:'#847d72',opacity:.16,seed:120+i*.7});
  return expandWorldProps({trunks,crowns,pines,branches,houses,roofs,basalt,snowPeaks,sacredPeaks,clouds,grasses,rocks,flowers,windows,doors,beams,snowCaps,crystals,shoreRocks});
}

/** Reposition decoration without making the individual trees, houses or monuments giants. */
function expandWorldProps(raw:WorldProps):WorldProps {
  const shift=(record:PropInstance,geology=false):PropInstance=>{
    const [x,y,z]=record.position;
    const px=x*WORLD_EXPANSION,pz=z*WORLD_EXPANSION;
    const localBase=localHeight(x,z),nextBase=terrainHeight(px,pz);
    return {...record,position:[px,y-localBase+nextBase,pz],scale:geology?[record.scale[0]*4,record.scale[1]*1.9,record.scale[2]*4]:record.scale};
  };
  const field=(records:readonly PropInstance[])=>records.map(record=>shift(record));
  const mountains=(records:readonly PropInstance[])=>records.map(record=>shift(record,true));
  const clouds=raw.clouds.map((record):CloudInstance=>{
    const [x,y,z]=record.position;
    if(record.color==='#847d72'){
      const [vx,vz]=mainlandPoint('human',-7.75,4.05);
      return {...record,position:[vx*WORLD_EXPANSION+x-vx,y+1.3+localHeight(vx,vz),vz*WORLD_EXPANSION+z-vz]};
    }
    return {...record,position:[x*WORLD_EXPANSION,record.color==='#d5dfdf'?y*1.8:y,z*WORLD_EXPANSION],size:[record.size[0]*WORLD_EXPANSION,record.size[1]*(record.color==='#d5dfdf'?2:1.4)]};
  });
  return {trunks:field(raw.trunks),crowns:field(raw.crowns),pines:field(raw.pines),branches:field(raw.branches),
    houses:raw.houses,roofs:raw.roofs,windows:raw.windows,doors:raw.doors,beams:raw.beams,
    basalt:field(raw.basalt),snowPeaks:mountains(raw.snowPeaks),sacredPeaks:mountains(raw.sacredPeaks),clouds,
    grasses:field(raw.grasses),rocks:field(raw.rocks),flowers:field(raw.flowers),snowCaps:field(raw.snowCaps),crystals:field(raw.crystals),shoreRocks:field(raw.shoreRocks)};
}
function localHeight(x:number,z:number):number{return terrainHeight(x*WORLD_EXPANSION,z*WORLD_EXPANSION);}
function localBiome(x:number,z:number):ReturnType<typeof biomeAt>{return biomeAt(x*WORLD_EXPANSION,z*WORLD_EXPANSION);}

