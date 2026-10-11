import { describe,expect,it } from 'vitest';
import { buildSea,buildTerrain,buildWorldProps,stagePoint,STAGE_LANDMARKS,terrainHeight,WORLD_RADIUS,WORLD_SCALE } from '../../src/rendering/campaign/worldGeometry';
import { buildTownLayout,coastDistance,FORTRESS_ANCHOR,FORTRESS_FLAG,SEA_LEVEL,SEA_WAVE_HEIGHT,TOWN_ANCHOR,TOWN_HOUSES,TOWN_RADIUS,WORLD_EXPANSION } from '../../src/rendering/campaign/worldLayout';
import { CENTRAL_ISLANDS,MAJOR_ISLANDS,MAP_RADIUS,sampleIslandExact,shorePoint,SOUTHERN_ISLANDS,TOXIC_ISLANDS,TOXIC_STAGE_ANCHOR,WORLD_ISLANDS,type IslandPoint } from '../../src/rendering/campaign/worldIslands';
import { CENTRAL_TREE_ANCHOR,CENTRAL_TREE_CROWN_RADIUS,CENTRAL_TREE_HEIGHT,CENTRAL_TREE_ROOT_RADIUS,CENTRAL_WORLD_TOP,MAINLAND_OFFSETS,mainlandPoint,type Mainland } from '../../src/rendering/campaign/worldPlacement';
import { MOON_ISLANDS,MOON_MAX_HEIGHT,MOON_ORIGIN,MOON_VIEW_DISTANCE } from '../../src/rendering/campaign/moonLayout';
import { DEMON_SITES } from '../../src/rendering/campaign/demonLayout';

function cross(a:IslandPoint,b:IslandPoint,c:IslandPoint):number {
  return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
}
function inside(point:IslandPoint,outline:readonly IslandPoint[]):boolean {
  let result=false;
  for(let i=0,j=outline.length-1;i<outline.length;j=i++){
    const a=outline[j]!,b=outline[i]!;
    if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;
  }
  return result;
}
function segmentsTouch(a:IslandPoint,b:IslandPoint,c:IslandPoint,d:IslandPoint):boolean {
  if(Math.max(a[0],b[0])<Math.min(c[0],d[0])||Math.max(c[0],d[0])<Math.min(a[0],b[0])
    ||Math.max(a[1],b[1])<Math.min(c[1],d[1])||Math.max(c[1],d[1])<Math.min(a[1],b[1]))return false;
  return cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0;
}
function triangleContains(point:IslandPoint,a:IslandPoint,b:IslandPoint,c:IslandPoint):boolean {
  if(Math.abs(cross(a,b,c))<1e-10)return false;
  const sides=[cross(a,b,point),cross(b,c,point),cross(c,a,point)];
  return sides.every(v=>v>=-1e-8)||sides.every(v=>v<=1e-8);
}

describe('碎片大陆、南端群岛与古海要塞布局',()=>{
  it('仅将底座半径翻倍，保留建筑尺度与要塞—城镇间距',()=>{
    expect(MAP_RADIUS).toBe(23.6);
    expect(WORLD_EXPANSION).toBe(5);
    expect(WORLD_SCALE).toBe(5);
    expect(WORLD_RADIUS).toBe(118);
    expect(WORLD_RADIUS*WORLD_SCALE).toBe(590);
    expect(TOWN_RADIUS).toBe(3.7);
    expect((TOWN_ANCHOR[0]-FORTRESS_ANCHOR[0])*WORLD_EXPANSION).toBeCloseTo(-.75,8);
    expect((TOWN_ANCHOR[1]-FORTRESS_ANCHOR[1])*WORLD_EXPANSION).toBeCloseTo(-6.75,8);
  });

  it('三大岛靠近西东北三侧，圣域最小，轮廓闭合且彼此没有陆桥',()=>{
    expect(MAJOR_ISLANDS.map(i=>i.region)).toEqual(['human','demon','sacred']);
    const areas=MAJOR_ISLANDS.map(island=>{
      const area=Math.abs(island.outline.reduce((sum,a,i)=>{
        const b=island.outline[(i+1)%island.outline.length]!;
        return sum+a[0]*b[1]-b[0]*a[1];
      },0))*.5;
      expect(area).toBeCloseTo(island.area,8);
      expect(area).toBeGreaterThan(0);
      for(const [i,a] of island.outline.entries()){
        const b=island.outline[(i+1)%island.outline.length]!;
        expect(Math.hypot(a[0]-b[0],a[1]-b[1])).toBeGreaterThan(0);
        expect(Math.hypot(...a)).toBeLessThan(MAP_RADIUS);
      }
      return area;
    });
    expect(areas[2]!).toBeLessThan(areas[0]!);
    expect(areas[2]!).toBeLessThan(areas[1]!);
    const [human,demon,sacred]=MAJOR_ISLANDS;
    expect(human!.bounds[2]).toBeLessThan(-7);
    expect(demon!.bounds[0]).toBeGreaterThan(8);
    expect(sacred!.bounds[3]).toBeLessThan(-10);
    for(const island of MAJOR_ISLANDS){
      expect(Math.max(...island.outline.map(p=>Math.hypot(...p)))).toBeGreaterThan(MAP_RADIUS*.88);
    }
    for(const island of WORLD_ISLANDS)for(const point of island.outline){
      expect(Math.hypot(...point)).toBeLessThan(MAP_RADIUS);
    }
    for(const [index,island] of MAJOR_ISLANDS.entries())for(const other of MAJOR_ISLANDS.slice(index+1)){
      expect(island.outline.some(p=>inside(p,other.outline))).toBe(false);
      expect(other.outline.some(p=>inside(p,island.outline))).toBe(false);
      for(const [i,a] of island.outline.entries())for(const [j,c] of other.outline.entries()){
        expect(segmentsTouch(a,island.outline[(i+1)%island.outline.length]!,c,other.outline[(j+1)%other.outline.length]!)).toBe(false);
      }
    }
  });

  it('每座岛的岸线内部没有非相邻边自交，压边后不产生折返碎缝',()=>{
    for(const island of WORLD_ISLANDS){
      const outline=island.outline;
      for(let i=0;i<outline.length;i++)for(let j=i+2;j<outline.length;j++){
        if(i===0&&j===outline.length-1)continue;
        expect(segmentsTouch(outline[i]!,outline[(i+1)%outline.length]!,outline[j]!,outline[(j+1)%outline.length]!),`${island.id}: ${i}/${j}`).toBe(false);
      }
    }
  });

  it('闭合岸线与缓存岸距一致，海峡和南端外海保持连通水域',()=>{
    for(const [index,island] of WORLD_ISLANDS.entries()){
      expect(shorePoint(index,0)).toEqual(island.outline[0]);
      expect(shorePoint(index,1)).toEqual(island.outline[0]);
      for(const point of island.outline){
        expect(Math.abs(sampleIslandExact(...point).distance)).toBeLessThan(1e-8);
        expect(Math.abs(coastDistance(...point))).toBeLessThan(.11);
      }
    }
    for(const point of [[-6.4,0],[7,0],[0,-7],[-1,20]] as const){
      expect(sampleIslandExact(point[0],point[1]).island).toBeNull();
      expect(coastDistance(point[0],point[1])).toBeLessThan(0);
      expect(terrainHeight(point[0]*WORLD_EXPANSION,point[1]*WORLD_EXPANSION)).toBeLessThan(SEA_LEVEL);
    }
  });

  it('南端群岛包含魔域毒雾岛，2-1 旗标落在真实岛面而非海床',()=>{
    const islands=SOUTHERN_ISLANDS;
    expect(islands.length).toBeGreaterThanOrEqual(8);
    expect(new Set(islands.map(i=>i.id)).size).toBe(islands.length);
    for(const island of islands){
      expect(island.bounds[1]).toBeGreaterThan(8);
      expect(island.area).toBeLessThan(MAJOR_ISLANDS[2]!.area);
    }
    expect(TOXIC_ISLANDS.length).toBeGreaterThanOrEqual(3);
    for(const island of TOXIC_ISLANDS){
      expect(island.major).toBe(false);
      expect(island.region).toBe('demon');
      expect(island.bounds[0]).toBeGreaterThan(0);
    }
    expect(STAGE_LANDMARKS['2-1']).toEqual(DEMON_SITES['2-1'].flag);
    expect(sampleIslandExact(...TOXIC_STAGE_ANCHOR).island?.id).toBe('toxic-main');
    expect(sampleIslandExact(...DEMON_SITES['2-1'].flag).island?.id).toBe('toxic-main');
    expect(stagePoint('2-1')[1]).toBeGreaterThan(SEA_LEVEL+SEA_WAVE_HEIGHT);
    for(const [id,point] of Object.entries(STAGE_LANDMARKS)){
      const region=id.startsWith('1-')?'human':id.startsWith('2-')?'demon':'sacred';
      expect(sampleIslandExact(...point).island?.region,id).toBe(region);
      expect(coastDistance(...point),id).toBeGreaterThan(0);
    }
  });

  it('要塞立于岸边陆侧，城市和已有陆地地标不被海水淹没',()=>{
    expect(coastDistance(...FORTRESS_ANCHOR)).toBeGreaterThan(.26);
    expect(coastDistance(...FORTRESS_ANCHOR)).toBeLessThan(.65);
    const landmarks=[FORTRESS_ANCHOR,TOWN_ANCHOR,mainlandPoint('human',-4.15,3),mainlandPoint('human',-6.65,-.75),
      mainlandPoint('human',-7.75,4.05),DEMON_SITES['2-2'].center,mainlandPoint('sacred',0,-4.95)];
    for(const [x,z] of landmarks){
      expect(coastDistance(x,z)).toBeGreaterThan(.26);
      expect(terrainHeight(x*WORLD_EXPANSION,z*WORLD_EXPANSION)).toBeGreaterThan(SEA_LEVEL);
    }
  });

  it('人界圣域关卡保持刚性平移，魔域使用独立海报布局且南岛入口不重复平移',()=>{
    expect(MAINLAND_OFFSETS).toEqual({human:[-8,0],demon:[6,0],sacred:[0,-6]});
    expect(FORTRESS_ANCHOR).toEqual(mainlandPoint('human',-2.6,7.4));
    expect(TOWN_ANCHOR).toEqual(mainlandPoint('human',-2.75,6.05));
    const originals:readonly (readonly [string,Mainland,number,number])[]=[
      ['1-1','human',-2.6+.63,7.4-.12],['1-2','human',-4.15,3],['1-3','human',-6.65,-.75],['1-4','human',-7.75,4.05],
      ['3-1','sacred',0,-4.95],['3-2','sacred',-3.5,-6.3],['3-3','sacred',1.6,-8],['3-4','sacred',5.3,-6.8],
    ];
    for(const [id,region,x,z] of originals){
      const point=STAGE_LANDMARKS[id]!,expected=mainlandPoint(region,x,z),model=stagePoint(id);
      expect(point[0],id).toBeCloseTo(expected[0],8);
      expect(point[1],id).toBeCloseTo(expected[1],8);
      expect(model[0],id).toBeCloseTo(expected[0]*WORLD_EXPANSION,8);
      expect(model[2],id).toBeCloseTo(expected[1]*WORLD_EXPANSION,8);
      expect(sampleIslandExact(...point).island?.id,id).toBe(region);
    }
    for(const [id,site] of Object.entries(DEMON_SITES)){
      expect(STAGE_LANDMARKS[id]).toEqual(site.flag);
      const model=stagePoint(id);
      expect(model[0]).toBeCloseTo(site.flag[0]*WORLD_EXPANSION,8);
      expect(model[2]).toBeCloseTo(site.flag[1]*WORLD_EXPANSION,8);
      expect(STAGE_LANDMARKS[id]).not.toEqual(mainlandPoint('demon',site.flag[0],site.flag[1]));
    }
    expect(TOXIC_STAGE_ANCHOR).toEqual([7.6,13.2]);
    expect(sampleIslandExact(...DEMON_SITES['2-1'].center).island?.id).toBe('toxic-main');
  });

  it('中央碎片大陆独立于三章和南岛，巨树基座与冠幅边界明确',()=>{
    expect(CENTRAL_ISLANDS.length).toBeGreaterThan(1);
    expect(CENTRAL_ISLANDS.every(i=>i.region==='central'&&!i.major&&!i.toxic)).toBe(true);
    expect(MAJOR_ISLANDS.every(i=>i.region!=='central')).toBe(true);
    expect(SOUTHERN_ISLANDS.every(i=>i.region!=='central'&&!i.major)).toBe(true);
    expect(WORLD_ISLANDS).toHaveLength(MAJOR_ISLANDS.length+SOUTHERN_ISLANDS.length+CENTRAL_ISLANDS.length);
    expect(CENTRAL_TREE_ANCHOR).toEqual([0,1.5]);
    expect(sampleIslandExact(...CENTRAL_TREE_ANCHOR).island?.id).toBe('central-heart');
    for(const point of [[1.8,1],[0,-2.5]] as const){
      expect(sampleIslandExact(point[0],point[1]).island?.region).toBe('central');
    }
    for(const central of CENTRAL_ISLANDS)for(const mainland of MAJOR_ISLANDS){
      expect(central.outline.some(p=>inside(p,mainland.outline))).toBe(false);
      expect(mainland.outline.some(p=>inside(p,central.outline))).toBe(false);
      for(const [i,a] of central.outline.entries())for(const [j,c] of mainland.outline.entries()){
        expect(segmentsTouch(a,central.outline[(i+1)%central.outline.length]!,c,mainland.outline[(j+1)%mainland.outline.length]!)).toBe(false);
      }
    }
    const treeX=CENTRAL_TREE_ANCHOR[0]*WORLD_EXPANSION,treeZ=CENTRAL_TREE_ANCHOR[1]*WORLD_EXPANSION;
    const base=terrainHeight(treeX,treeZ);
    expect(base).toBeGreaterThan(2);
    expect(CENTRAL_TREE_HEIGHT).toBe(49);
    expect(CENTRAL_TREE_CROWN_RADIUS).toBe(32);
    expect(CENTRAL_TREE_ROOT_RADIUS).toBe(21);
    expect(base+CENTRAL_TREE_HEIGHT).toBeLessThanOrEqual(CENTRAL_WORLD_TOP);
    expect(Math.hypot(treeX,treeZ)+CENTRAL_TREE_CROWN_RADIUS).toBeLessThan(WORLD_RADIUS);
    for(const island of MOON_ISLANDS){
      expect(Math.hypot(island.position[0]-treeX,island.position[2]-treeZ)).toBeGreaterThan(CENTRAL_TREE_CROWN_RADIUS+island.radius);
    }
  });

  it('1-1 标记位于要塞入口，旗标与导航共享同一位置',()=>{
    expect(STAGE_LANDMARKS['1-1']).toEqual(FORTRESS_FLAG);
    const p=stagePoint('1-1');
    expect(p[0]).toBeCloseTo(FORTRESS_FLAG[0]*WORLD_EXPANSION,8);
    expect(p[2]).toBeCloseTo(FORTRESS_FLAG[1]*WORLD_EXPANSION,8);
    expect(p[1]).toBeGreaterThan(SEA_LEVEL);
    // The ground ring must clear the eastern stairs, including its .28-unit radius.
    expect((FORTRESS_FLAG[0]-FORTRESS_ANCHOR[0])*WORLD_EXPANSION-.28).toBeGreaterThan(2.51);
    expect(TOWN_ANCHOR[1]).toBeLessThan(FORTRESS_ANCHOR[1]);
  });

  it('24 栋房屋确定性生成，屋顶不越墙，街巷与建筑不重叠',()=>{
    expect(TOWN_HOUSES).toHaveLength(24);
    expect(buildTownLayout()).toEqual(TOWN_HOUSES);
    expect(new Set(TOWN_HOUSES.map(h=>h.angle)).size).toBeGreaterThan(20);
    for(const [i,h] of TOWN_HOUSES.entries()){
      expect(Math.hypot(h.x,h.z)+h.radius).toBeLessThanOrEqual(TOWN_RADIUS-.3);
      expect(Math.abs(h.x)-h.radius).toBeGreaterThanOrEqual(.29);
      for(const other of TOWN_HOUSES.slice(i+1)){
        expect(Math.hypot(h.x-other.x,h.z-other.z)).toBeGreaterThanOrEqual(h.radius+other.radius+.09);
      }
    }
  });

  it('房屋与门窗屋顶共享朝向，且按最终模型坐标贴地',()=>{
    const props=buildWorldProps(2);
    expect(props.roofs).toHaveLength(24);
    expect(props.doors).toHaveLength(24);
    for(const [i,h] of TOWN_HOUSES.entries()){
      const roof=props.roofs[i]!,door=props.doors[i]!;
      const x=TOWN_ANCHOR[0]*WORLD_EXPANSION+h.x,z=TOWN_ANCHOR[1]*WORLD_EXPANSION+h.z;
      expect(roof.position[0]).toBeCloseTo(x,8);
      expect(roof.position[2]).toBeCloseTo(z,8);
      expect(roof.position[1]).toBeCloseTo(terrainHeight(x,z)+h.height,8);
      expect(roof.scale).toEqual([h.width*1.16,.35,h.depth*1.18]);
      expect(door.rotation).toEqual(roof.rotation);
      expect(door.position[0]).toBeCloseTo(x+(h.depth*.5+.008)*Math.sin(h.angle),8);
      expect(door.position[2]).toBeCloseTo(z+(h.depth*.5+.008)*Math.cos(h.angle),8);
    }
    for(const tree of props.trunks){
      expect(coastDistance(tree.position[0]/WORLD_EXPANSION,tree.position[2]/WORLD_EXPANSION)).toBeGreaterThanOrEqual(.2);
      expect(tree.position[1]-tree.scale[1]*.5).toBeGreaterThan(SEA_LEVEL+SEA_WAVE_HEIGHT);
    }
    for(const plant of [...props.trunks,...props.grasses,...props.flowers]){
      expect(terrainHeight(plant.position[0],plant.position[2])).toBeGreaterThan(SEA_LEVEL+SEA_WAVE_HEIGHT);
    }
    for(const grass of props.grasses)expect(grass.position[1]).toBeGreaterThan(SEA_LEVEL+SEA_WAVE_HEIGHT);
  });

  it('月之都是一座主岛和五座错层空岛，布局固定且整体高于旧单岛',()=>{
    expect(MOON_ISLANDS).toHaveLength(6);
    expect(new Set(MOON_ISLANDS.map(i=>i.id)).size).toBe(6);
    expect(MOON_ORIGIN).toEqual([14,28,-50]);
    expect(MOON_ISLANDS.map(i=>i.seed)).toEqual([9,311,327,343,359,373]);
    expect(MOON_ISLANDS.map(i=>i.position[1])).toEqual([28,25,30.5,32,24.5,26]);
    expect(MOON_MAX_HEIGHT).toBeCloseTo(32.4,8);
    expect(MOON_VIEW_DISTANCE).toBe(160);
    for(const [index,island] of MOON_ISLANDS.entries()){
      expect(island.position[1]-island.depth).toBeGreaterThan(14);
      expect([...island.position,island.radius,island.depth,island.seed].every(Number.isFinite)).toBe(true);
      for(const other of MOON_ISLANDS.slice(index+1)){
        expect(Math.hypot(island.position[0]-other.position[0],island.position[2]-other.position[2])).toBeGreaterThan(island.radius+other.radius);
      }
    }
  });

  it('水面与地形的边缘对齐，海岸属性有限，不给内陆深坑中心铺水',()=>{
    const sea=buildSea(8),terrain=buildTerrain(8);
    try{
      const p=sea.getAttribute('position'),shore=sea.getAttribute('aShore');
      expect(shore.count).toBe(p.count);
      for(let i=0;i<p.count;i++){
        expect(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)+shore.getX(i))).toBe(true);
        expect(p.getY(i)).toBeCloseTo(SEA_LEVEL,6);
        expect(Math.hypot(p.getX(i),p.getZ(i))).toBeLessThanOrEqual(WORLD_RADIUS*1.004+.001);
      }
      const index=sea.getIndex()!,pitCenter=DEMON_SITES['2-4'].center;
      const pit:IslandPoint=[pitCenter[0]*WORLD_EXPANSION,pitCenter[1]*WORLD_EXPANSION];
      expect(index.count).toBeGreaterThan(0);
      expect(terrainHeight(...pit)).toBeLessThan(SEA_LEVEL);
      expect(sampleIslandExact(...pitCenter).island?.id).toBe('demon');
      for(let i=0;i<index.count;i+=3){
        const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2);
        expect(Math.min(shore.getX(a),shore.getX(b),shore.getX(c))).toBeLessThan(.401);
        expect(triangleContains(pit,[p.getX(a),p.getZ(a)],[p.getX(b),p.getZ(b)],[p.getX(c),p.getZ(c)])).toBe(false);
      }
      for(const geometry of [sea,terrain])for(const attribute of Object.values(geometry.attributes)){
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      }
    }finally{sea.dispose();terrain.dispose();}
  });
});
