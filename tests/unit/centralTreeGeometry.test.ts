import { describe,expect,it } from 'vitest';
import { buildCentralTree,type CentralTreeGeometry } from '../../src/rendering/campaign/centralTreeGeometry';
import { CENTRAL_TREE_CROWN_RADIUS,CENTRAL_TREE_HEIGHT } from '../../src/rendering/campaign/worldPlacement';

function dispose(tree:CentralTreeGeometry):void {tree.wood.dispose();tree.lights.dispose();}

describe('中央巨树后台几何',()=>{
  it.each([
    {detail:2,leaves:120,lights:36},
    {detail:3,leaves:162,lights:54},
    {detail:4,leaves:204,lights:72},
  ] as const)('画质 $detail 保持原叶团与微光数量，所有数据可安全传输',({detail,leaves,lights})=>{
    const tree=buildCentralTree(detail);
    try{
      expect(tree.leaves).toHaveLength(leaves);
      expect(tree.lights.getAttribute('position').count).toBe(lights);
      const index=tree.wood.getIndex()!,vertices=tree.wood.getAttribute('position');
      expect(index.count).toBeGreaterThan(0);
      expect(index.count%3).toBe(0);
      expect(tree.wood.getAttribute('normal').count).toBe(vertices.count);
      expect(tree.wood.getAttribute('color').count).toBe(vertices.count);
      expect(Array.from(index.array).every(i=>Number.isInteger(i)&&i>=0&&i<vertices.count)).toBe(true);
      for(const geometry of [tree.wood,tree.lights]){
        for(const attribute of Object.values(geometry.attributes)){
          expect(attribute.array.buffer).toBeInstanceOf(ArrayBuffer);
          expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
        }
        expect(geometry.boundingSphere).not.toBeNull();
        expect(Number.isFinite(geometry.boundingSphere!.radius)).toBe(true);
      }
      for(let i=0;i<vertices.count;i++){
        expect(vertices.getY(i)).toBeLessThan(CENTRAL_TREE_HEIGHT);
        expect(Math.hypot(vertices.getX(i),vertices.getZ(i))).toBeLessThan(CENTRAL_TREE_CROWN_RADIUS);
      }
      for(const leaf of tree.leaves){
        expect([...leaf.position,...leaf.scale,...leaf.rotation!].every(Number.isFinite)).toBe(true);
        expect(leaf.position[1]+leaf.scale[1]).toBeLessThanOrEqual(CENTRAL_TREE_HEIGHT);
        expect(Math.hypot(leaf.position[0],leaf.position[2])+Math.max(leaf.scale[0],leaf.scale[2])).toBeLessThanOrEqual(CENTRAL_TREE_CROWN_RADIUS);
      }
      for(const name of ['color','aSeed','aKind'])expect(tree.lights.getAttribute(name).count).toBe(lights);
    }finally{dispose(tree);}
  });

  it('重复后台任务使用相同种子，但不共享可转移缓冲或几何资源',()=>{
    const first=buildCentralTree(2),second=buildCentralTree(2);
    try{
      expect(first.leaves).toEqual(second.leaves);
      for(const key of ['wood','lights'] as const){
        const a=first[key],b=second[key];
        expect(a).not.toBe(b);
        for(const name of Object.keys(a.attributes)){
          expect(a.getAttribute(name).array).toEqual(b.getAttribute(name).array);
          expect(a.getAttribute(name).array.buffer).not.toBe(b.getAttribute(name).array.buffer);
        }
      }
    }finally{dispose(first);dispose(second);}
  });
});
