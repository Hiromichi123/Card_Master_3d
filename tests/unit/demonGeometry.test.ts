import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { BufferGeometry,Float32BufferAttribute } from 'three';
import { sampleIslandExact } from '../../src/rendering/campaign/worldIslands';
import { buildDemonGeometry,demonFoundation,type DemonGeometry } from '../../src/rendering/campaign/demonGeometry';
import { DEMON_PIT_FLOOR,DEMON_PIT_RADIUS,DEMON_SITES,type DemonStageId } from '../../src/rendering/campaign/demonLayout';
import { terrainHeight,WORLD_EXPANSION } from '../../src/rendering/campaign/worldGeometry';

let model:DemonGeometry;
beforeAll(()=>{model=buildDemonGeometry();});
afterAll(()=>{for(const geometry of Object.values(model))geometry.dispose();});
function bounds(site:number):{minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number} {
  const result={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity};
  for(const key of ['stone','trim','glow','abyss'] as const){
      const geometry=model[key];
    const p=geometry.getAttribute('position'),ids=geometry.getAttribute('aSite');
    for(let i=0;i<p.count;i++)if(ids.getX(i)===site){
      result.minX=Math.min(result.minX,p.getX(i));result.maxX=Math.max(result.maxX,p.getX(i));
      result.minY=Math.min(result.minY,p.getY(i));result.maxY=Math.max(result.maxY,p.getY(i));
      result.minZ=Math.min(result.minZ,p.getZ(i));result.maxZ=Math.max(result.maxZ,p.getZ(i));
    }
  }
  return result;
}

describe('四关魔域后台合并几何',()=>{
  it('所有顶点、索引、颜色与特效属性有效，并保持四个合并网格',()=>{
    expect(Object.keys(model)).toEqual(['stone','trim','glow','abyss']);
    for(const key of ['stone','trim','glow','abyss'] as const){
      const geometry=model[key];
      const p=geometry.getAttribute('position'),index=geometry.getIndex()!;
      expect(p.count).toBeGreaterThan(0);expect(p.count).toBeLessThan(100000);
      expect(index.count%3).toBe(0);
      expect(Array.from(index.array).every(i=>Number.isInteger(i)&&i>=0&&i<p.count)).toBe(true);
      for(const name of ['normal','color','uv','aKind','aSite'])expect(geometry.getAttribute(name).count).toBe(p.count);
      for(const attribute of Object.values(geometry.attributes)){
        expect(attribute.array.buffer).toBeInstanceOf(ArrayBuffer);
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      }
      expect(Number.isFinite(geometry.boundingSphere!.radius)).toBe(true);
    }
  });

  it('四处采用最终地理坐标，主体和附属均落在各自取景包围范围内',()=>{
    for(const key of ['stone','trim','glow','abyss'] as const){
      const geometry=model[key];
      const p=geometry.getAttribute('position'),site=geometry.getAttribute('aSite');
      for(let i=0;i<p.count;i++){
        if(site.getX(i)===0){
          expect(sampleIslandExact(p.getX(i)/WORLD_EXPANSION,p.getZ(i)/WORLD_EXPANSION).island?.id).toBe('demon');
          expect(p.getY(i)).toBeGreaterThan(-3.1);continue;
        }
        const id=`2-${site.getX(i)}` as DemonStageId,layout=DEMON_SITES[id];
        expect(layout).toBeDefined();
        const dx=p.getX(i)-layout.center[0]*WORLD_EXPANSION,dz=p.getZ(i)-layout.center[1]*WORLD_EXPANSION;
        expect(Math.hypot(dx,dz)).toBeLessThan(layout.viewRadius);
        expect(p.getY(i)).toBeGreaterThan(-3.1);
      }
    }
    const tower=bounds(2),temple=bounds(3),portal=bounds(1);
    expect(tower.maxY-tower.minY).toBeGreaterThan(10);
    expect(tower.maxY-tower.minY).toBeLessThan(11);
    expect(temple.maxY-temple.minY).toBeGreaterThan(14);
    expect(portal.maxY-portal.minY).toBeGreaterThan(3);
    expect(portal.maxY-portal.minY).toBeLessThan(4);
    expect(temple.maxX-temple.minX).toBeGreaterThan(tower.maxX-tower.minX);
  });

  it('门框与祭塔在原中心按半尺寸建模，光效同步缩小而神庙和深渊比例不变',()=>{
    expect(DEMON_SITES['2-1'].modelScale).toBe(.5);expect(DEMON_SITES['2-2'].modelScale).toBe(.5);
    expect(DEMON_SITES['2-3'].modelScale).toBe(1);expect(DEMON_SITES['2-4'].modelScale).toBe(1);
    expect(DEMON_SITES['2-1'].center).toEqual([7.6,13]);expect(DEMON_SITES['2-2'].center).toEqual([12,-4]);
    const portal=DEMON_SITES['2-1'],tower=DEMON_SITES['2-2'];
    const gateBase=demonFoundation(portal.center[0]*WORLD_EXPANSION,portal.center[1]*WORLD_EXPANSION,2.2,1.5,.5).top+.08;
    const towerBase=demonFoundation(tower.center[0]*WORLD_EXPANSION,tower.center[1]*WORLD_EXPANSION,3.3,3.1,.5).top+.08;
    expect(bounds(1).maxY-gateBase).toBeCloseTo(6.06*.5,4);
    expect(bounds(2).maxY-towerBase).toBeCloseTo((19.2+1.24+.06)*.5,4);
    expect(bounds(2).maxX-bounds(2).minX).toBeCloseTo(6.6*.5,4);
    expect((bounds(2).maxX+bounds(2).minX)/2).toBeCloseTo(tower.center[0]*WORLD_EXPANSION,5);
    const p=model.glow.getAttribute('position'),ids=model.glow.getAttribute('aSite'),kinds=model.glow.getAttribute('aKind');
    const xs:number[]=[],ys:number[]=[];
    for(let i=0;i<p.count;i++)if(ids.getX(i)===1&&kinds.getX(i)===1){xs.push(p.getX(i));ys.push(p.getY(i));}
    expect(xs).toHaveLength(4);
    expect(Math.max(...xs)-Math.min(...xs)).toBeCloseTo(2.18*.5,4);
    expect(Math.max(...ys)-Math.min(...ys)).toBeCloseTo(5.12*.5,4);
    expect((Math.max(...xs)+Math.min(...xs))/2).toBeCloseTo(portal.center[0]*WORLD_EXPANSION,5);
  });

  it.each([
    ['2-1',2.2,1.5],['2-2',3.3,3.1],['2-3',7.8,6.8],
  ] as const)('%s 的基台逐边贴地，平台高于占地采样而非只取中心高度',(id,width,depth)=>{
    const layout=DEMON_SITES[id],center=layout.center,x=center[0]*WORLD_EXPANSION,z=center[1]*WORLD_EXPANSION;
    const {top,edge}=demonFoundation(x,z,width,depth,layout.modelScale);
    expect(edge).toHaveLength(48);
    for(const p of edge){
      expect(p[1]).toBeCloseTo(terrainHeight(p[0],p[2])-.04,8);
      expect(top).toBeGreaterThan(p[1]+.13*layout.modelScale);
      expect(Math.abs(p[0]-x)).toBeLessThanOrEqual(width/2+1e-8);
      expect(Math.abs(p[2]-z)).toBeLessThanOrEqual(depth/2+1e-8);
    }
    for(let i=0;i<=8;i++)for(let j=0;j<=8;j++)expect(top).toBeGreaterThan(terrainHeight(x-width/2+i*width/8,z-depth/2+j*depth/8));
  });

  it('紫色涡纹贴合凹陷而不是横跨坑口的平面，并保留黑核与底座间距',()=>{
    const p=model.abyss.getAttribute('position'),[gx,gz]=DEMON_SITES['2-4'].center;
    let min=Infinity,max=-Infinity;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),r=Math.hypot(x-gx*WORLD_EXPANSION,z-gz*WORLD_EXPANSION);
      expect(r).toBeLessThan(DEMON_PIT_RADIUS*WORLD_EXPANSION);
      expect(r).toBeGreaterThan(.65);
      expect(y).toBeCloseTo(terrainHeight(x,z)+.11,3);
      min=Math.min(min,y);max=Math.max(max,y);
    }
    expect(max-min).toBeGreaterThan(4);
    expect(min).toBeGreaterThan(DEMON_PIT_FLOOR);
    expect(bounds(4).minY).toBeGreaterThan(-3.1);
  });

  it('提供正式地形时追加道路而不改变四关或风景类别',()=>{
    const terrain=new BufferGeometry();
    terrain.setAttribute('position',new Float32BufferAttribute([50,0,-30,105,0,-30,50,0,25,105,0,25],3));
    terrain.setIndex([0,2,1,1,2,3]);
    const connected=buildDemonGeometry(terrain);
    try{
      expect(connected.stone.getAttribute('position').count).toBeGreaterThan(model.stone.getAttribute('position').count);
      const ids=connected.stone.getAttribute('aSite');
      for(let i=model.stone.getAttribute('position').count;i<ids.count;i++)expect(ids.getX(i)).toBe(0);
      for(const key of ['trim','glow','abyss'] as const)expect(connected[key].getAttribute('position').array).toEqual(model[key].getAttribute('position').array);
      expect(terrain.getIndex()!.count).toBe(6);
    }finally{terrain.dispose();for(const geometry of Object.values(connected))geometry.dispose();}
  });

  it('门内异界、光束、盆地低云拥有不同着色类别，重复生成无随机漂移或缓冲共享',()=>{
    const kinds=new Set(Array.from(model.glow.getAttribute('aKind').array));
    expect(kinds).toEqual(new Set([0,1,2,3]));
    const second=buildDemonGeometry();
    try{
      for(const key of ['stone','trim','glow','abyss'] as const){
        for(const name of Object.keys(model[key].attributes)){
          const a=model[key].getAttribute(name).array,b=second[key].getAttribute(name).array;
          expect(a).toEqual(b);expect(a.buffer).not.toBe(b.buffer);
        }
        expect(model[key].getIndex()!.array).toEqual(second[key].getIndex()!.array);
      }
    }finally{for(const geometry of Object.values(second))geometry.dispose();}
  });
});
