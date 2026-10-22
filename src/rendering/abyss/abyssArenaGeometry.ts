import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, ExtrudeGeometry, Path, Shape, TubeGeometry, Vector3,
} from 'three';
import { ABYSS_VITALS } from './abyssVitalsLayout';
import { abyssVitalsShape } from './abyssVitalsShape';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type Vec3 = readonly [number, number, number];
type Vec2 = readonly [number, number];
export interface AbyssFragment { readonly position: Vec3; readonly rotation: Vec3; readonly scale: Vec3; readonly shade: number }

export function arenaRandom(index: number, salt = 0): number {
  const value = Math.sin(index * 127.1 + salt * 311.7 + 91.43) * 43758.5453;
  return value - Math.floor(value);
}

const OUTLINE: readonly Vec2[] = [[-7.75,-4.8],[-5.7,-7.5],[5.7,-7.5],[7.75,-4.8],[7.75,4.8],[5.7,7.5],[-5.7,7.5],[-7.75,4.8]];
function path(points: readonly Vec2[], scale = 1): Shape {
  const shape = new Shape();
  points.forEach(([x,z],i) => { if (i === 0) shape.moveTo(x*scale,-z*scale); else shape.lineTo(x*scale,-z*scale); });
  shape.closePath(); return shape;
}
function extrude(shape: Shape, thickness: number, top: number, bevel = .04): ExtrudeGeometry {
  const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: bevel > 0,
    bevelSize: bevel, bevelThickness: bevel, bevelSegments: 4, curveSegments: 16 });
  geometry.rotateX(-Math.PI/2); geometry.translate(0,top-thickness-bevel,0);
  const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  for (let i=0;i<positions.count;i++) uv.setXY(i,positions.getX(i)/15.5+.5,positions.getZ(i)/15+.5);
  uv.needsUpdate = true; return geometry;
}
function combine(parts: BufferGeometry[]): BufferGeometry {
  const result = mergeGeometries(parts, false);
  parts.forEach(part => part.dispose());
  if (!result) throw new Error('深渊几何无法合并');
  return result;
}
function fracture(x: number): number { return .21 + Math.sin(x*2.8)*.048 + Math.sin(x*6.3+.7)*.035; }

export function makeAbyssDeck(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const side of [-1,1]) {
    const points: Vec2[] = [[-7.75,fracture(-7.75)*side],[-7.75,4.8*side],[-5.7,7.5*side],
      [5.7,7.5*side],[7.75,4.8*side],[7.75,fracture(7.75)*side]];
    for (let i=1;i<=76;i++) {
      const x=7.75-i/76*15.5; points.push([x,fracture(x)*side]);
    }
    const deck = path(points);
    {
      const v = ABYSS_VITALS;
      deck.holes.push(abyssVitalsShape(v.width, v.length, v.x, -side * v.z));
    }
    parts.push(extrude(deck,.7,0,.006));
  }
  return combine(parts);
}

export function makeAbyssRim(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // The side mouths remain open; short pieces make the rim read as a fractured relic.
  for (let i=0;i<OUTLINE.length;i++) {
    const a=OUTLINE[i]!,b=OUTLINE[(i+1)%OUTLINE.length]!;
    for (let part=0;part<2;part++) {
      const start=part*.5+.025, end=(part+1)*.5-.025;
      const ax=a[0]+(b[0]-a[0])*start,az=a[1]+(b[1]-a[1])*start;
      const bx=a[0]+(b[0]-a[0])*end,bz=a[1]+(b[1]-a[1])*end;
      if (Math.abs((az+bz)*.5)<.45) continue;
      parts.push(extrude(path([[ax,az],[bx,bz],[bx*.973,bz*.973],[ax*.973,az*.973]]),.18,.03,.018));
    }
  }
  return combine(parts);
}

export function makeAbyssRift(): BufferGeometry {
  const positions:number[]=[],uv:number[]=[],indices:number[]=[];
  for (let i=0;i<=152;i++) {
    const x=-7.7+i/152*15.4,w=fracture(x)+.012;
    positions.push(x,-.18,-w,x,-.18,w);uv.push(i/152,0,i/152,1);
    if(i<152){const j=i*2;indices.push(j,j+1,j+2,j+1,j+3,j+2);}
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));
  geometry.setAttribute('uv',new BufferAttribute(new Float32Array(uv),2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

export function makeAbyssFunnel(): BufferGeometry {
  const positions:number[]=[],uv:number[]=[],indices:number[]=[];
  const rings=80,segments=192;
  for(let row=0;row<=rings;row++){
    const depth=row/rings, radius=1.6+Math.pow(depth,1.9)*44;
    for(let col=0;col<=segments;col++){
      const angle=col/segments*Math.PI*2;
      const folds=Math.sin(angle*5+depth*14)*(.15+depth*.8)+Math.sin(angle*9-depth*20)*depth*.3;
      positions.push(Math.cos(angle)*(radius+folds),-41+depth*36+Math.sin(angle*3+depth*18)*depth*1.1,Math.sin(angle)*(radius+folds));
      uv.push(col/segments,depth);
      if(row<rings&&col<segments){const a=row*(segments+1)+col,b=a+segments+1;indices.push(a,b,a+1,b,b+1,a+1);}
    }
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));
  geometry.setAttribute('uv',new BufferAttribute(new Float32Array(uv),2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

export function makeAbyssRunes(): BufferGeometry {
  const points:number[]=[];
  const segment=(a:Vec3,b:Vec3)=>points.push(...a,...b);
  for(let i=0;i<48;i++){
    const side=i<24?-1:1, local=i%24,x=-5.2+local/23*10.4,z=side*6.22,y=.017;
    segment([x,y,z-.11],[x,y,z+.11]);
    const flip=i%2?1:-1;
    segment([x,y,z-.09],[x+.085*flip,y,z-.02]);
    segment([x,y,z+.015],[x-.095*flip,y,z+.09]);
    if(i%3===0)segment([x-.08,y,z],[x+.08,y,z]);
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(points),3));return geometry;
}

export function abyssFragments(): readonly AbyssFragment[] {
  const result:AbyssFragment[]=[];
  for(let i=0;i<160;i++){
    const near=i<56,angle=i*2.39996323,radius=near?7.3+arenaRandom(i,1)*.6:14+arenaRandom(i,1)*28;
    const tall=!near&&i%5===0;
    const height=near?1.1+arenaRandom(i,6)*2.8:tall?5+arenaRandom(i,6)*10:1+arenaRandom(i,6)*3;
    result.push({position:[Math.cos(angle)*radius,near?-1.2-height-arenaRandom(i,2)*.4:-4-height*.85-arenaRandom(i,2)*6,Math.sin(angle)*radius],
      rotation:[arenaRandom(i,3)*.35,angle,arenaRandom(i,4)*.32],
      scale:near?[.45+arenaRandom(i,5)*.7,height,.6+arenaRandom(i,7)*.5]
        :[.8+arenaRandom(i,5)*2.8,height,1+arenaRandom(i,7)*2],
      shade:[0x24202e,0x35303e,0x433848,0x4b3f52][i%4]!,});
  }
  return result;
}

export function makeAbyssSouls(): BufferGeometry {
  const souls:number[]=[],positions=new Float32Array(1400*3);
  for(let i=0;i<1400;i++)souls.push(9.8+arenaRandom(i,11)*29,arenaRandom(i,12)*Math.PI*2,arenaRandom(i,13)*2.8,arenaRandom(i,14));
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(positions,3));
  geometry.setAttribute('aSoul',new BufferAttribute(new Float32Array(souls),4));return geometry;
}

export function makeAbyssLightning(index:number, widthScale=1): BufferGeometry {
  const parts:BufferGeometry[]=[];
  const angle=index/6*Math.PI*2+.25, radius=23+arenaRandom(index,31)*9;
  const points:Vector3[]=[];
  for(let i=0;i<15;i++){
    const t=i/14,wave=Math.sin(t*23+index)*.85;
    points.push(new Vector3(Math.cos(angle)*(radius-t*5)+wave,15-t*32,Math.sin(angle)*(radius-t*5)+Math.cos(t*17)*1.2));
  }
  parts.push(new TubeGeometry(new CatmullRomCurve3(points),96,.026*widthScale,5,false));
  for(let branch=0;branch<4;branch++){
    const origin=points[3+branch*2]!, length=1.8+arenaRandom(index+branch,35)*4;
    const path=[origin.clone(),origin.clone().add(new Vector3(length*.25,-1,length*.3)),
      origin.clone().add(new Vector3(length*.65,-2.6,-length*.12)),origin.clone().add(new Vector3(length,-4.5,length*.28))];
    parts.push(new TubeGeometry(new CatmullRomCurve3(path),32,.013*widthScale,4,false));
  }
  return combine(parts);
}

export function makeAbyssTrim(): BufferGeometry {
  const shape=path(OUTLINE,.955),inner=path(OUTLINE,.948);
  const hole=new Path(inner.getPoints().reverse());shape.holes.push(hole);
  return extrude(shape,.022,-.004,0);
}
