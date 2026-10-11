import { describe,expect,it,vi } from 'vitest';
import { BufferGeometry,Float32BufferAttribute } from 'three';
import { buildTerrainRoads,ROAD_LAYER_SPAN,ROAD_SURFACE_OFFSET } from '../../src/rendering/campaign/terrainRoadGeometry';

function foldedTerrain():BufferGeometry {
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute([-2,0,-2,2,0,-2,2,2,2,-2,0,2],3));
  geometry.setIndex([0,2,1,0,3,2]);return geometry;
}
function surfaceHeight(x:number,z:number):number {return (Math.min(x,z)+2)*.5;}

describe('道路裁切贴合正式地形三角面',()=>{
  it('横跨折面时每片道路都属于真实地形平面，顶点和三角重心保持同一偏移',()=>{
    const terrain=foldedTerrain(),road=buildTerrainRoads(terrain,[[[-1.8,.2],[1.8,.2]]],.22);
    try{
      const p=road.getAttribute('position'),normal=road.getAttribute('normal'),index=road.getIndex()!;
      expect(p.count).toBeGreaterThan(6);expect(index.count%3).toBe(0);
      expect(road.getAttribute('uv').count).toBe(p.count);
      for(let i=0;i<p.count;i++){
        expect([p.getX(i),p.getY(i),p.getZ(i)].every(Number.isFinite)).toBe(true);
        expect(p.getY(i)-surfaceHeight(p.getX(i),p.getZ(i))).toBeCloseTo(ROAD_SURFACE_OFFSET,6);
        expect(normal.getY(i)).toBeGreaterThan(0);
        expect(p.getX(i)).toBeGreaterThanOrEqual(-1.800001);expect(p.getX(i)).toBeLessThanOrEqual(1.800001);
        expect(p.getZ(i)).toBeGreaterThanOrEqual(-.020001);expect(p.getZ(i)).toBeLessThanOrEqual(.420001);
      }
      for(let i=0;i<index.count;i+=3){
        const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2);
        for(const id of [a,b,c]){expect(Number.isInteger(id)).toBe(true);expect(id).toBeGreaterThanOrEqual(0);expect(id).toBeLessThan(p.count);}
        const x=(p.getX(a)+p.getX(b)+p.getX(c))/3,z=(p.getZ(a)+p.getZ(b)+p.getZ(c))/3,y=(p.getY(a)+p.getY(b)+p.getY(c))/3;
        expect(y-surfaceHeight(x,z)).toBeCloseTo(ROAD_SURFACE_OFFSET,6);
        const upward=(p.getZ(b)-p.getZ(a))*(p.getX(c)-p.getX(a))-(p.getX(b)-p.getX(a))*(p.getZ(c)-p.getZ(a));
        expect(upward).toBeGreaterThan(1e-9);
      }
    }finally{road.dispose();terrain.dispose();}
  });

  it('不改写或释放源几何，重复调用返回独立且确定的缓冲',()=>{
    const terrain=foldedTerrain(),source=terrain.getAttribute('position'),positions=Array.from(source.array),indices=Array.from(terrain.getIndex()!.array),dispose=vi.spyOn(terrain,'dispose');
    const routes=[[[ -1,0],[0,.35],[1,0]]] as const;
    const first=buildTerrainRoads(terrain,routes,.2),second=buildTerrainRoads(terrain,routes,.2);
    try{
      expect(dispose).not.toHaveBeenCalled();expect(terrain.getAttribute('position')).toBe(source);
      expect(Array.from(source.array)).toEqual(positions);expect(Array.from(terrain.getIndex()!.array)).toEqual(indices);
      expect(first.getAttribute('position').array).toEqual(second.getAttribute('position').array);
      expect(first.getAttribute('position').array.buffer).not.toBe(second.getAttribute('position').array.buffer);
    }finally{first.dispose();second.dispose();terrain.dispose();}
  });

  it('交叉道路使用不超过指定上限的独立高度层，避免同平面争抢深度',()=>{
    const terrain=foldedTerrain(),road=buildTerrainRoads(terrain,[[[-1,0],[1,0]],[[0,-1],[0,1]]],.2);
    try{
      const p=road.getAttribute('position');let lower=0,upper=0;
      for(let i=0;i<p.count;i++){
        const offset=p.getY(i)-surfaceHeight(p.getX(i),p.getZ(i));
        expect(offset).toBeGreaterThanOrEqual(ROAD_SURFACE_OFFSET-1e-6);
        expect(offset).toBeLessThanOrEqual(ROAD_SURFACE_OFFSET+ROAD_LAYER_SPAN+1e-6);
        if(Math.abs(offset-ROAD_SURFACE_OFFSET)<1e-6)lower++;
        if(Math.abs(offset-ROAD_SURFACE_OFFSET-ROAD_LAYER_SPAN)<1e-6)upper++;
      }
      expect(lower).toBeGreaterThan(0);expect(upper).toBeGreaterThan(0);
    }finally{road.dispose();terrain.dispose();}
  });

  it('空路径、重复点和离开地形的路带不会生成退化或非有限面',()=>{
    const terrain=foldedTerrain();
    const empty=buildTerrainRoads(terrain,[[[0,0],[0,0]],[[5,5],[8,8]]],.2);
    const invalid=buildTerrainRoads(terrain,[[[-1,0],[1,0]]],NaN);
    const duplicated=buildTerrainRoads(terrain,[[[-1,0],[-1,0],[1,0],[1,0]]],.2);
    try{
      expect(empty.getAttribute('position').count).toBe(0);expect(invalid.getAttribute('position').count).toBe(0);
      expect(duplicated.getAttribute('position').count).toBeGreaterThan(0);
      expect(Array.from(duplicated.getAttribute('position').array).every(Number.isFinite)).toBe(true);
    }finally{empty.dispose();invalid.dispose();duplicated.dispose();terrain.dispose();}
  });
});
