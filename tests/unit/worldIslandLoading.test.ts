import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { IslandPoint } from '../../src/rendering/campaign/worldIslands';

const load=()=>import('../../src/rendering/campaign/worldIslands');
function cross(a:IslandPoint,b:IslandPoint,c:IslandPoint):number {
  return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
}
function touches(a:IslandPoint,b:IslandPoint,c:IslandPoint,d:IslandPoint):boolean {
  if(Math.max(a[0],b[0])<Math.min(c[0],d[0])||Math.max(c[0],d[0])<Math.min(a[0],b[0])
    ||Math.max(a[1],b[1])<Math.min(c[1],d[1])||Math.max(c[1],d[1])<Math.min(a[1],b[1]))return false;
  return cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0;
}
function inside(point:IslandPoint,outline:readonly IslandPoint[]):boolean {
  let result=false;
  for(let i=0,j=outline.length-1;i<outline.length;j=i++){
    const a=outline[j]!,b=outline[i]!;
    if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;
  }
  return result;
}

beforeEach(()=>vi.resetModules());

describe('世界地图稀疏岸距与后台缓存',()=>{
  it('模块导入不采样，第一次查询最多计算四个格点，再次查询复用',async()=>{
    const world=await load();
    expect(world.shoreFieldStats()).toEqual({sampled:0,total:473**2,complete:false});
    const value=world.coastDistance(-10.61,7.39);
    expect(Number.isFinite(value)).toBe(true);
    expect(world.shoreFieldStats().sampled).toBe(4);
    expect(world.coastDistance(-10.61,7.39)).toBe(value);
    expect(world.shoreFieldStats().sampled).toBe(4);
    world.islandAt(-10.61,7.39);
    expect(world.shoreFieldStats().sampled).toBeLessThanOrEqual(5);
    expect(world.shoreFieldStats().complete).toBe(false);
  });

  it('稀疏插值与后台完整表一致，快照拥有独立缓冲区',async()=>{
    const world=await load();
    const points:readonly IslandPoint[]=[[-10.6,7.4],[-10.75,6.05],[0,1.5],[7.6,13.2],[12.15,-1.05],[-6.4,0],[7,0],[0,-7],[-1,20]];
    const before=points.map(([x,z])=>({distance:world.coastDistance(x,z),owner:world.islandAt(x,z)?.id}));
    expect(world.shoreFieldStats().complete).toBe(false);
    const field=world.buildShoreField();
    expect(field.distances).toHaveLength(473**2);
    expect(field.owners).toHaveLength(473**2);
    expect(world.shoreFieldStats().complete).toBe(true);
    for(const [i,[x,z]] of points.entries()){
      expect(world.coastDistance(x,z)).toBe(before[i]!.distance);
      expect(world.islandAt(x,z)?.id).toBe(before[i]!.owner);
    }
    const saved=field.distances[0]!;
    field.distances[0]=12345;
    expect(world.coastDistance(-world.MAP_RADIUS,-world.MAP_RADIUS)).toBe(saved);
    field.distances[0]=saved;
    world.installShoreField(field);
    for(const [i,[x,z]] of points.entries()){
      expect(world.coastDistance(x,z)).toBe(before[i]!.distance);
      expect(world.islandAt(x,z)?.id).toBe(before[i]!.owner);
    }
  });

  it('拒绝错误维度及损坏结果，不覆盖已可用的稀疏缓存',async()=>{
    const world=await load(),value=world.coastDistance(0,1.5),before=world.shoreFieldStats();
    expect(()=>world.installShoreField({distances:new Float32Array(2),owners:new Uint8Array(2)})).toThrow('dimensions');
    const distances=new Float32Array(before.total),owners=new Uint8Array(before.total);
    distances[0]=NaN;
    expect(()=>world.installShoreField({distances,owners})).toThrow('sample');
    distances[0]=0;owners[0]=255;
    expect(()=>world.installShoreField({distances,owners})).toThrow('sample');
    expect(world.shoreFieldStats()).toEqual(before);
    expect(world.coastDistance(0,1.5)).toBe(value);
  });
});

describe('人界与魔域岸线局部扩展',()=>{
  it('最终平滑轮廓面积约增加17%，而圣域仍小于两岛',async()=>{
    const world=await load(),[human,demon,sacred]=world.MAJOR_ISLANDS;
    expect(world.MAINLAND_AREA_GROWTH).toBe(1.17);
    for(const id of ['human','demon'] as const){
      const island=world.MAJOR_ISLANDS.find(item=>item.id===id)!;
      const ratio=island.area/world.MAINLAND_BASE_AREAS[id];
      expect(ratio).toBeGreaterThanOrEqual(1.15);
      expect(ratio).toBeLessThanOrEqual(1.2);
      expect(ratio).toBeCloseTo(world.MAINLAND_AREA_GROWTH,5);
      expect(island.area).toBeGreaterThan(sacred!.area);
    }
    expect(human!.bounds[2]).toBeLessThan(-7);
    expect(demon!.bounds[0]).toBeGreaterThan(8);
  });

  it('扩大后仍在底座内，岸线不自交，也不连接中央、圣域或南岛',async()=>{
    const {WORLD_ISLANDS,MAP_RADIUS}=await load();
    for(const island of WORLD_ISLANDS){
      const outline=island.outline;
      for(let i=0;i<outline.length;i++){
        expect(Math.hypot(...outline[i]!)).toBeLessThan(MAP_RADIUS);
        for(let j=i+2;j<outline.length;j++){
          if(i===0&&j===outline.length-1)continue;
          expect(touches(outline[i]!,outline[(i+1)%outline.length]!,outline[j]!,outline[(j+1)%outline.length]!),`${island.id} ${i}/${j}`).toBe(false);
        }
      }
      if(island.id!=='human'&&island.id!=='demon')continue;
      for(const other of WORLD_ISLANDS){
        if(other===island)continue;
        expect(outline.some(p=>inside(p,other.outline)),`${island.id}/${other.id}`).toBe(false);
        expect(other.outline.some(p=>inside(p,outline)),`${other.id}/${island.id}`).toBe(false);
        for(let i=0;i<outline.length;i++)for(let j=0;j<other.outline.length;j++){
          expect(touches(outline[i]!,outline[(i+1)%outline.length]!,other.outline[j]!,other.outline[(j+1)%other.outline.length]!)).toBe(false);
        }
      }
    }
  });

  it('保留东西海峡、要塞临海、城镇与南部毒雾岛锚点',async()=>{
    const world=await load();
    for(const [x,z] of [[-6.4,0],[7,0],[0,-7],[-1,20]])expect(world.sampleIslandExact(x!,z!).island).toBeNull();
    const fortress=world.sampleIslandExact(-10.6,7.4);
    expect(fortress.island?.id).toBe('human');
    expect(fortress.distance).toBeGreaterThan(.26);
    expect(fortress.distance).toBeLessThan(.65);
    expect(world.sampleIslandExact(-10.75,6.05).island?.id).toBe('human');
    expect(world.TOXIC_STAGE_ANCHOR).toEqual([7.6,13.2]);
    expect(world.sampleIslandExact(...world.TOXIC_STAGE_ANCHOR).island?.id).toBe('toxic-main');
    expect(world.SOUTHERN_ISLANDS).toHaveLength(12);
    expect(world.CENTRAL_ISLANDS).toHaveLength(6);
  });
});
