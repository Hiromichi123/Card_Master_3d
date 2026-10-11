import { describe,expect,it } from 'vitest';
import { DEMON_MAINLAND_STAGES,DEMON_PIT_FLOOR,DEMON_PIT_RADIUS,DEMON_SITES,DEMON_TEMPLE_BASIN_RADIUS,demonPitDistance,demonPitHeight,demonRelief,demonStage,demonVegetationSafe,type DemonStageId } from '../../src/rendering/campaign/demonLayout';
import { biomeAt,buildTerrain,stagePoint,STAGE_LANDMARKS,terrainHeight } from '../../src/rendering/campaign/worldGeometry';
import { sampleIslandExact } from '../../src/rendering/campaign/worldIslands';
import { SEA_LEVEL,SEA_WAVE_HEIGHT,WORLD_EXPANSION } from '../../src/rendering/campaign/worldLayout';

type Point=readonly [number,number];
function distance(a:Point,b:Point):number {return Math.hypot(a[0]-b[0],a[1]-b[1]);}
function height(point:Point):number {return terrainHeight(point[0]*WORLD_EXPANSION,point[1]*WORLD_EXPANSION);}
function ring(center:Point,radius:number):Point[] {
  return Array.from({length:48},(_,i):Point=>{
    const angle=i/48*Math.PI*2;return [center[0]+Math.cos(angle)*radius,center[1]+Math.sin(angle)*radius];
  });
}

describe('魔域海报地形与独立关卡布局',()=>{
  it('门扉与祭塔尺寸减半，但地理中心、入口位置及其它两关尺度不变',()=>{
    expect(Object.values(DEMON_SITES).map(site=>site.modelScale)).toEqual([.5,.5,1,1]);
    expect(DEMON_SITES['2-1'].center).toEqual([7.6,13]);expect(DEMON_SITES['2-1'].flag).toEqual([7.6,13.65]);
    expect(DEMON_SITES['2-2'].center).toEqual([12,-4]);expect(DEMON_SITES['2-2'].flag).toEqual([12,-2.65]);
    expect(DEMON_SITES['2-1'].radius).toBe(1.6);expect(DEMON_SITES['2-2'].radius).toBe(2.8);
    expect(DEMON_SITES['2-3'].radius).toBe(6);expect(DEMON_SITES['2-4'].radius).toBe(7);
    for(const id of ['2-1','2-2'] as const){
      const site=DEMON_SITES[id];expect(site.viewRadius).toBeGreaterThan(distance(site.flag,site.center)*WORLD_EXPANSION);
    }
  });

  it('主岛三个场景呈分散三角布局，使用最终地理坐标而非二次平移',()=>{
    expect(DEMON_MAINLAND_STAGES).toEqual(['2-2','2-3','2-4']);
    expect(DEMON_SITES['2-2'].center).toEqual([12,-4]);
    expect(DEMON_SITES['2-3'].center).toEqual([19,1]);
    expect(DEMON_SITES['2-4'].center).toEqual([13.5,4.2]);
    for(const [index,id] of DEMON_MAINLAND_STAGES.entries()){
      const site=DEMON_SITES[id];
      expect(sampleIslandExact(...site.center).island?.id,id).toBe('demon');
      for(const other of DEMON_MAINLAND_STAGES.slice(index+1))expect(distance(site.center,DEMON_SITES[other].center)).toBeGreaterThan(6);
    }
    const [a,b,c]=DEMON_MAINLAND_STAGES.map(id=>DEMON_SITES[id].center) as [Point,Point,Point];
    expect(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))*.5).toBeGreaterThan(20);
  });

  it('建筑和地貌周界留在各自岛内，深渊缓冲与神庙盆地不侵入海岸',()=>{
    const radii:Readonly<Record<DemonStageId,number>>={
      '2-1':DEMON_SITES['2-1'].radius/WORLD_EXPANSION,
      '2-2':DEMON_SITES['2-2'].radius/WORLD_EXPANSION+.1,
      '2-3':DEMON_TEMPLE_BASIN_RADIUS,
      '2-4':DEMON_PIT_RADIUS+.25,
    };
    for(const [id,site] of Object.entries(DEMON_SITES)){
      const owner=id==='2-1'?'toxic-main':'demon';
      for(const point of [site.center,...ring(site.center,radii[id as DemonStageId])]){
        const sample=sampleIslandExact(...point);
        expect(sample.island?.id,`${id}: ${point.join(',')}`).toBe(owner);
        expect(sample.distance,`${id}: ${point.join(',')}`).toBeGreaterThan(.03);
      }
    }
  });

  it('入口旗标与场景中心分离，落在主体外干地，导航配置覆盖地标',()=>{
    for(const [id,site] of Object.entries(DEMON_SITES)){
      expect(demonStage(id)).toBe(site);
      expect(STAGE_LANDMARKS[id]).toEqual(site.flag);
      expect(sampleIslandExact(...site.flag).island?.id,id).toBe(id==='2-1'?'toxic-main':'demon');
      expect(sampleIslandExact(...site.flag).distance,id).toBeGreaterThan(.15);
      expect(distance(site.flag,site.center)*WORLD_EXPANSION,id).toBeGreaterThan(site.radius);
      expect(height(site.flag),id).toBeGreaterThan(SEA_LEVEL+SEA_WAVE_HEIGHT);
      expect(stagePoint(id)[1],id).toBeCloseTo(height(site.flag),8);
      expect(site.viewRadius,id).toBeGreaterThan(site.radius);
      expect(site.focusHeight,id).toBeGreaterThan(0);
      expect(demonVegetationSafe(...site.center),id).toBe(false);
      expect(demonVegetationSafe(...site.flag),id).toBe(false);
    }
    expect(demonStage('1-1')).toBeUndefined();
    expect(demonStage('toString')).toBeUndefined();
    expect(demonStage('__proto__')).toBeUndefined();
    expect(distance(DEMON_SITES['2-4'].flag,DEMON_SITES['2-4'].center)).toBeGreaterThan(DEMON_PIT_RADIUS+.25);
  });

  it('祭塔全占地有平整台地，神庙基座在环形断崖之下',()=>{
    const tower=DEMON_SITES['2-2'],temple=DEMON_SITES['2-3'];
    for(const point of [tower.center,...ring(tower.center,tower.radius/WORLD_EXPANSION)])expect(height(point)).toBeCloseTo(3.2,6);
    expect(height(temple.center)).toBeCloseTo(.65,6);
    for(const point of ring(temple.center,1.65)){
      // The southern approach deliberately cuts a narrow opening through the wall.
      if(point[1]>temple.center[1]&&Math.abs(point[0]-temple.center[0])<.45)continue;
      expect(height(point)-height(temple.center)).toBeGreaterThan(1.5);
    }
    const entrance:Point=[temple.center[0],temple.center[1]+1.65],north:Point=[temple.center[0],temple.center[1]-1.65];
    expect(height(entrance)).toBeLessThan(height(north)-1);
  });

  it('大陆具有不依赖黑洞的山脊高差，海岸衰减且南岛不继承主岛剖面',()=>{
    const samples:number[]=[];
    for(let x=10;x<=21;x+=.5)for(let z=-6;z<=6;z+=.5){
      const sample=sampleIslandExact(x,z);
      if(sample.island?.id==='demon'&&sample.distance>.8&&demonPitDistance(x,z)>DEMON_PIT_RADIUS+.5)samples.push(height([x,z]));
    }
    expect(samples.length).toBeGreaterThan(50);
    expect(Math.max(...samples)-Math.min(...samples)).toBeGreaterThan(2.5);
    expect(demonRelief(16,-2,0)).toBe(0);
    expect(Math.abs(demonRelief(16,-2,.1))).toBeLessThan(Math.abs(demonRelief(16,-2,1)));
    const gate=DEMON_SITES['2-1'].center;
    expect(biomeAt(gate[0]*WORLD_EXPANSION,gate[1]*WORLD_EXPANSION).pit).toBe(100);
    expect(height(gate)).toBeLessThan(.5);
    expect(height(gate)).toBeGreaterThan(SEA_LEVEL);
  });

  it('低画质深渊局部细分的水平边长不超过 .18，实际顶点不穿底座',()=>{
    const geometry=buildTerrain(18),center=DEMON_SITES['2-4'].center;
    const cx=center[0]*WORLD_EXPANSION,cz=center[1]*WORLD_EXPANSION,radius=DEMON_PIT_RADIUS*WORLD_EXPANSION;
    try{
      const positions=geometry.getAttribute('position'),indices=geometry.getIndex()!;
      let refined=0;
      for(let i=0;i<indices.count;i+=3){
        const ids=[indices.getX(i),indices.getX(i+1),indices.getX(i+2)];
        const x=ids.reduce((sum,id)=>sum+positions.getX(id),0)/3,z=ids.reduce((sum,id)=>sum+positions.getZ(id),0)/3;
        if(Math.hypot(x-cx,z-cz)>=radius)continue;
        refined++;
        for(let edge=0;edge<3;edge++){
          const a=ids[edge]!,b=ids[(edge+1)%3]!;
          expect(Math.hypot(positions.getX(a)-positions.getX(b),positions.getZ(a)-positions.getZ(b))).toBeLessThanOrEqual(.18002);
          expect(positions.getY(a)).toBeGreaterThan(-3.1);
          expect(positions.getY(a)).toBeCloseTo(terrainHeight(positions.getX(a),positions.getZ(a)),3);
        }
      }
      expect(refined).toBeGreaterThan(100);
    }finally{geometry.dispose();}
  });

  it('黑洞剖面沿新中心下降，最低面留在底座上方，坑缘抬高且禁植',()=>{
    const center=DEMON_SITES['2-4'].center;
    expect(demonPitDistance(...center)).toBe(0);
    expect(biomeAt(center[0]*WORLD_EXPANSION,center[1]*WORLD_EXPANSION).pit).toBe(0);
    expect(demonPitHeight(...center)).toBe(DEMON_PIT_FLOOR);
    expect(height(center)).toBeCloseTo(DEMON_PIT_FLOOR,6);
    expect(height(center)).toBeLessThan(SEA_LEVEL);
    for(let step=0;step<=24;step++)for(const point of ring(center,DEMON_PIT_RADIUS*step/24)){
      expect(demonPitHeight(...point)).toBeGreaterThan(-3.1);
      expect(height(point)).toBeGreaterThan(-3.1);
      expect(demonVegetationSafe(...point)).toBe(false);
    }
    for(const point of ring(center,DEMON_PIT_RADIUS))expect(height(point)-height(center)).toBeGreaterThan(4);
  });
});
