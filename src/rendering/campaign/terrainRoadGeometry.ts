import { BufferGeometry,Float32BufferAttribute } from 'three';

type Point=readonly [number,number];
type Triangle=readonly [Point,Point,Point];
interface RoadTriangle {readonly points:Triangle;readonly bounds:readonly [number,number,number,number];readonly offset:number}
export const ROAD_SURFACE_OFFSET=.025;
/** Crossing routes receive distinct, bounded layers instead of coplanar overlapping faces. */
export const ROAD_LAYER_SPAN=.002;
const EPSILON=1e-9;
function cross(a:Point,b:Point,c:Point):number {return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function bounds(points:Triangle):RoadTriangle['bounds'] {
  return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
}
function counterclockwise(points:Triangle):Triangle {return cross(...points)<0?[points[0],points[2],points[1]]:points;}
function clip(subject:Triangle,triangle:Triangle):Point[] {
  let polygon:Point[]=[...subject];
  for(let edge=0;edge<3&&polygon.length;edge++){
    const a=triangle[edge]!,b=triangle[(edge+1)%3]!,next:Point[]=[];
    let previous=polygon[polygon.length-1]!,previousDistance=cross(a,b,previous);
    for(const current of polygon){
      const distance=cross(a,b,current),inside=distance>=-EPSILON,previousInside=previousDistance>=-EPSILON;
      if(inside!==previousInside){
        const t=previousDistance/(previousDistance-distance);
        next.push([previous[0]+(current[0]-previous[0])*t,previous[1]+(current[1]-previous[1])*t]);
      }
      if(inside)next.push(current);
      previous=current;previousDistance=distance;
    }
    polygon=next;
  }
  return polygon;
}
function roadTriangles(roads:readonly (readonly Point[])[],halfWidth:number):RoadTriangle[] {
  const result:RoadTriangle[]=[];
  roads.forEach((road,roadIndex)=>{
    const points:Point[]=[];
    for(const point of road){
      if(!point.every(Number.isFinite))continue;
      const previous=points[points.length-1];
      if(!previous||Math.hypot(point[0]-previous[0],point[1]-previous[1])>EPSILON)points.push(point);
    }
    if(points.length<2)return;
    const normals:Point[]=points.slice(1).map((p,i)=>{
      const a=points[i]!,dx=p[0]-a[0],dz=p[1]-a[1],length=Math.hypot(dx,dz);return [-dz/length,dx/length];
    });
    const sides=points.map((p,i):readonly [Point,Point]=>{
      const before=normals[Math.max(0,i-1)]!,after=normals[Math.min(i,normals.length-1)]!;
      const nx=before[0]+after[0],nz=before[1]+after[1],length=Math.hypot(nx,nz);
      const normal:Point=length>EPSILON?[nx/length,nz/length]:after;
      const projection=Math.max(.4,normal[0]*after[0]+normal[1]*after[1]),width=halfWidth/projection;
      return [[p[0]+normal[0]*width,p[1]+normal[1]*width],[p[0]-normal[0]*width,p[1]-normal[1]*width]];
    });
    const offset=ROAD_SURFACE_OFFSET+ROAD_LAYER_SPAN*roadIndex/Math.max(1,roads.length-1);
    const add=(points:Triangle):void=>{if(Math.abs(cross(...points))>EPSILON)result.push({points:counterclockwise(points),bounds:bounds(points),offset});};
    for(let i=0;i<sides.length-1;i++){
      const a=sides[i]!,b=sides[i+1]!;add([a[0],a[1],b[0]]);add([a[1],b[1],b[0]]);
    }
  });
  return result;
}

/** Clip road ribbons to the rendered terrain planes, not the continuous height function beneath them. */
export function buildTerrainRoads(terrain:BufferGeometry,roads:readonly (readonly Point[])[],halfWidth:number):BufferGeometry {
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[],geometry=new BufferGeometry();
  const triangles=Number.isFinite(halfWidth)&&halfWidth>0?roadTriangles(roads,halfWidth):[];
  const buckets=new Map<string,number[]>(),cell=Math.max(2,halfWidth*8);
  const visit=(box:RoadTriangle['bounds'],callback:(key:string)=>void):void=>{
    for(let x=Math.floor(box[0]/cell);x<=Math.floor(box[2]/cell);x++)for(let z=Math.floor(box[1]/cell);z<=Math.floor(box[3]/cell);z++)callback(`${x}:${z}`);
  };
  triangles.forEach((triangle,index)=>visit(triangle.bounds,key=>{
    const bucket=buckets.get(key);if(bucket)bucket.push(index);else buckets.set(key,[index]);
  }));
  const position=terrain.getAttribute('position'),index=terrain.getIndex();
  if(position&&triangles.length){
    const count=index?.count??position.count;
    for(let face=0;face+2<count;face+=3){
      const ids=[0,1,2].map(k=>index?index.getX(face+k):face+k);
      const original=ids.map(i=>[position.getX(i),position.getZ(i)] as Point) as unknown as Triangle;
      const area=cross(...original);if(!Number.isFinite(area)||Math.abs(area)<EPSILON)continue;
      const heights=ids.map(i=>position.getY(i));if(!heights.every(Number.isFinite))continue;
      const box=bounds(original),candidates=new Set<number>();
      visit(box,key=>{for(const candidate of buckets.get(key)??[])candidates.add(candidate);});
      for(const candidate of candidates){
        const road=triangles[candidate]!,r=road.bounds;
        if(r[2]<box[0]||r[0]>box[2]||r[3]<box[1]||r[1]>box[3])continue;
        const polygon=clip(road.points,counterclockwise(original));
        const add=(point:Point):void=>{
          const wa=cross(original[1],original[2],point)/area,wb=cross(original[2],original[0],point)/area;
          positions.push(point[0],wa*heights[0]!+wb*heights[1]!+(1-wa-wb)*heights[2]!+road.offset,point[1]);
          uvs.push(point[0],point[1]);
        };
        for(let i=1;i<polygon.length-1;i++){
          const a=polygon[0]!,b=polygon[i]!,c=polygon[i+1]!;
          const signed=cross(a,b,c);if(Math.abs(signed)<EPSILON)continue;
          const start=positions.length/3;add(a);add(signed>0?c:b);add(signed>0?b:c);
          indices.push(start,start+1,start+2);
        }
      }
    }
  }
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  if(positions.length)geometry.computeBoundingSphere();return geometry;
}
