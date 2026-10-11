import { BufferGeometry,Color,Float32BufferAttribute,ShapeUtils,Vector2 } from 'three';
import { terrainHeight,WORLD_EXPANSION,WORLD_RADIUS } from './worldGeometry';
import { WORLD_ISLANDS } from './worldIslands';
import { SEA_LEVEL } from './worldLayout';

/** Exact coast silhouettes, a few thousand vertices, and no full-map sampling pass. */
export function buildWorldPreview():{terrain:BufferGeometry;sea:BufferGeometry} {
  const positions:number[]=[],colors:number[]=[],indices:number[]=[];
  const holes=WORLD_ISLANDS.map(island=>island.outline.map(([x,z])=>new Vector2(x*WORLD_EXPANSION,z*WORLD_EXPANSION)));
  for(const [i,island] of WORLD_ISLANDS.entries()){
    const contour=holes[i]!,triangles=ShapeUtils.triangulateShape(contour,[]);
    const color=new Color(island.region==='demon'?'#795854':island.region==='sacred'?'#a4ada1':'#6f8557');
    const vertex=(x:number,z:number,y:number):number=>{
      const index=positions.length/3;positions.push(x,y,z);colors.push(color.r,color.g,color.b);return index;
    };
    // Shared coastline remains fixed when the high-resolution terrain arrives.
    for(const triangle of triangles){
      const [a,b,c]=triangle.map(index=>contour[index]!) as [Vector2,Vector2,Vector2];
      const x=(a.x+b.x+c.x)/3,z=(a.y+b.y+c.y)/3;
      const center=vertex(x,z,terrainHeight(x,z));
      const edge=[a,b,c].map(p=>vertex(p.x,p.y,SEA_LEVEL+.015));
      indices.push(edge[0]!,center,edge[1]!,edge[1]!,center,edge[2]!,edge[2]!,center,edge[0]!);
    }
    for(let j=0;j<contour.length;j++){
      const a=contour[j]!,b=contour[(j+1)%contour.length]!;
      const topA=vertex(a.x,a.y,SEA_LEVEL+.015),topB=vertex(b.x,b.y,SEA_LEVEL+.015);
      const lowA=vertex(a.x,a.y,-.65),lowB=vertex(b.x,b.y,-.65);
      indices.push(topA,topB,lowA,topB,lowB,lowA);
    }
  }
  const terrain=new BufferGeometry();terrain.setAttribute('position',new Float32BufferAttribute(positions,3));
  terrain.setAttribute('color',new Float32BufferAttribute(colors,3));terrain.setIndex(indices);terrain.computeVertexNormals();
  const rim=Array.from({length:160},(_,i)=>new Vector2(Math.cos(i/160*Math.PI*2)*WORLD_RADIUS,Math.sin(i/160*Math.PI*2)*WORLD_RADIUS));
  const triangles=ShapeUtils.triangulateShape(rim,holes),points=[...rim,...holes.flat()];
  const sea=new BufferGeometry();sea.setAttribute('position',new Float32BufferAttribute(points.flatMap(p=>[p.x,SEA_LEVEL,p.y]),3));
  sea.setIndex(triangles.flatMap(([a,b,c])=>[a!,c!,b!]));sea.computeVertexNormals();
  return {terrain,sea};
}
