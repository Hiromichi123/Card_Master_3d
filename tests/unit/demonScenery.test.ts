import { describe,expect,it } from 'vitest';
import { DEMON_HOUSES,DEMON_RIDGES,DEMON_ROADS,DEMON_ROAD_HALF_WIDTH,demonHouseClear,demonMountainRelief,demonRoadDistance,demonScenerySafe,segmentDistance } from '../../src/rendering/campaign/demonScenery';
import { DEMON_PIT_RADIUS,DEMON_SITES,demonPitDistance } from '../../src/rendering/campaign/demonLayout';
import { terrainHeight,WORLD_EXPANSION } from '../../src/rendering/campaign/worldGeometry';
import { sampleIslandExact } from '../../src/rendering/campaign/worldIslands';
import type { GeographicPoint } from '../../src/rendering/campaign/worldPlacement';

function distance(a:GeographicPoint,b:GeographicPoint):number {return Math.hypot(a[0]-b[0],a[1]-b[1]);}
function segmentSamples(a:GeographicPoint,b:GeographicPoint,width=0):GeographicPoint[] {
  const length=distance(a,b),nx=length?-(b[1]-a[1])/length:0,nz=length?(b[0]-a[0])/length:0;
  const count=Math.max(1,Math.ceil(length/.04)),points:GeographicPoint[]=[];
  for(let step=0;step<=count;step++)for(const side of width?[-1,0,1]:[0]){
    const t=step/count;points.push([a[0]+(b[0]-a[0])*t+nx*width*side,a[1]+(b[1]-a[1])*t+nz*width*side]);
  }
  return points;
}
function onMainland(point:GeographicPoint,margin:number):void {
  const sample=sampleIslandExact(...point);
  expect(sample.island?.id,point.join(',')).toBe('demon');
  expect(sample.distance,point.join(',')).toBeGreaterThan(margin);
}
function houseFootprint(house:typeof DEMON_HOUSES[number]):GeographicPoint[] {
  const points:GeographicPoint[]=[],rx=house.width*.65/WORLD_EXPANSION,rz=house.depth*.65/WORLD_EXPANSION;
  for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)points.push([house.center[0]+rx*x/2,house.center[1]+rz*z/2]);
  return points;
}

describe('魔域大陆山路与零星小屋布局',()=>{
  it('两段山脉、三条连续道路与十栋固定小屋不会因生成顺序漂移',()=>{
    expect(DEMON_RIDGES).toHaveLength(2);expect(DEMON_ROADS).toHaveLength(3);expect(DEMON_HOUSES).toHaveLength(10);
    const junction=DEMON_ROADS[0]![DEMON_ROADS[0]!.length-1]!;
    expect(DEMON_ROADS[1]![0]).toEqual(junction);expect(DEMON_ROADS[2]![0]).toEqual(junction);
    for(const road of DEMON_ROADS){
      expect(road.length).toBeGreaterThan(8);expect(road.length).toBeLessThan(128);
      expect(road.flat().every(Number.isFinite)).toBe(true);
    }
    expect(new Set(DEMON_HOUSES.map(h=>h.center.join(','))).size).toBe(DEMON_HOUSES.length);
  });

  it('完整离散道路和左右边界留在主岛，避开深渊，只从南侧接近神庙阶梯',()=>{
    const temple=DEMON_SITES['2-3'].center,halfWidth=DEMON_ROAD_HALF_WIDTH/WORLD_EXPANSION;
    for(const road of DEMON_ROADS)for(let i=1;i<road.length;i++){
      for(const point of segmentSamples(road[i-1]!,road[i]!,halfWidth)){
        onMainland(point,.15);
        // The final approach reaches the existing flag, outside the 1.65-geo deformation buffer.
        const approach=distance(point,DEMON_SITES['2-4'].flag)<.3;
        expect(demonPitDistance(...point),point.join(',')).toBeGreaterThan(approach?1.7:DEMON_PIT_RADIUS+.4);
        if(distance(point,temple)<2){
          expect(point[1]-temple[1]).toBeGreaterThan(1);
          expect(Math.abs(point[0]-temple[0])).toBeLessThan(.6);
        }
        expect(demonScenerySafe(...point)).toBe(false);
      }
    }
  });

  it('距离查询使用同一道路中心线，端点、拐弯与退化线段均有效',()=>{
    expect(segmentDistance(2,3,[0,0],[0,0])).toBeCloseTo(Math.sqrt(13),10);
    expect(segmentDistance(2,1,[0,0],[4,0])).toBe(1);
    expect(segmentDistance(-2,0,[0,0],[4,0])).toBe(2);
    for(const road of DEMON_ROADS)for(let i=1;i<road.length;i++){
      for(const point of segmentSamples(road[i-1]!,road[i]!))expect(demonRoadDistance(...point)).toBeLessThan(1e-10);
    }
  });

  it('屋顶完整占地在干燥缓坡，不压道路、地标或其它房屋，周围留出禁植区',()=>{
    const roadWidth=DEMON_ROAD_HALF_WIDTH/WORLD_EXPANSION;
    for(const [index,house] of DEMON_HOUSES.entries()){
      expect(house.width).toBeGreaterThan(0);expect(house.depth).toBeGreaterThan(0);expect(house.height).toBeLessThan(1);
      const heights:number[]=[];
      for(const point of houseFootprint(house)){
        onMainland(point,.2);
        expect(demonRoadDistance(...point),`${index}: ${point.join(',')}`).toBeGreaterThan(roadWidth+.02);
        expect(demonPitDistance(...point)).toBeGreaterThan(DEMON_PIT_RADIUS+.4);
        expect(distance(point,DEMON_SITES['2-3'].center)).toBeGreaterThan(2.2);
        expect(distance(point,DEMON_SITES['2-2'].center)).toBeGreaterThan(DEMON_SITES['2-2'].radius/WORLD_EXPANSION+.2);
        heights.push(terrainHeight(point[0]*WORLD_EXPANSION,point[1]*WORLD_EXPANSION));
      }
      expect(Math.min(...heights)).toBeGreaterThan(.05);
      expect(Math.max(...heights)-Math.min(...heights),`${index}`).toBeLessThan(.55);
      expect(demonHouseClear(...house.center)).toBe(false);expect(demonScenerySafe(...house.center)).toBe(false);
      for(const other of DEMON_HOUSES.slice(index+1))expect(distance(house.center,other.center)).toBeGreaterThan(.3);
    }
  });

  it('山脉全宽留在主岛，核心与关卡分开，有限影响不跨向南岛',()=>{
    for(const ridge of DEMON_RIDGES){
      expect(ridge.height).toBeGreaterThan(2);expect(ridge.width).toBeGreaterThan(0);
      for(let i=1;i<ridge.points.length;i++)for(const point of segmentSamples(ridge.points[i-1]!,ridge.points[i]!,ridge.width))onMainland(point,.03);
      for(const point of ridge.points){
        expect(distance(point,DEMON_SITES['2-2'].center)).toBeGreaterThan(2.25);
        expect(distance(point,DEMON_SITES['2-3'].center)).toBeGreaterThan(2.6);
        expect(demonPitDistance(...point)).toBeGreaterThan(DEMON_PIT_RADIUS+.75);
        expect(demonMountainRelief(...point)).toBeGreaterThan(1);
      }
    }
    expect(demonMountainRelief(...DEMON_SITES['2-1'].center)).toBe(0);
    expect(demonMountainRelief(0,0)).toBe(0);
    for(const road of DEMON_ROADS)for(const point of road)expect(demonMountainRelief(...point)).toBe(0);
    for(const house of DEMON_HOUSES)expect(demonMountainRelief(...house.center)).toBe(0);
  });
});
