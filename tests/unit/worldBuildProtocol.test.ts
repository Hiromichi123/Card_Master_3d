import { describe,expect,it,vi } from 'vitest';
import { BufferGeometry,Float32BufferAttribute } from 'three';
import { geometryTransfers,packGeometry,unpackGeometry,type WorldBuildPart } from '../../src/rendering/campaign/worldBuildProtocol';

type Point=readonly [number,number];
function cross(a:Point,b:Point,c:Point):number {return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function contains(point:Point,a:Point,b:Point,c:Point):boolean {
  if(Math.abs(cross(a,b,c))<1e-10)return false;
  const sides=[cross(a,b,point),cross(b,c,point),cross(c,a,point)];
  return sides.every(v=>v>=-1e-8)||sides.every(v=>v<=1e-8);
}
function expectFiniteGeometry(geometry:BufferGeometry):void {
  const p=geometry.getAttribute('position');
  expect(p.count).toBeGreaterThan(0);
  for(const attribute of Object.values(geometry.attributes))expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
  const index=geometry.getIndex();
  if(index){
    expect(index.count%3).toBe(0);
    expect(Array.from(index.array).every(i=>Number.isInteger(i)&&i>=0&&i<p.count)).toBe(true);
  }
}

describe('世界地图后台几何协议',()=>{
  it('打包复制属性与索引，解包保留顶点数据，释放责任互相独立',()=>{
    const source=new BufferGeometry();
    source.setAttribute('position',new Float32BufferAttribute([0,0,0,0,0,1,1,0,0],3));
    source.setAttribute('color',new Float32BufferAttribute([1,0,0,0,1,0,0,0,1],3));
    source.setIndex([0,1,2]);source.computeVertexNormals();
    const disposed=vi.fn();source.addEventListener('dispose',disposed);
    const packed=packGeometry(source),restored=unpackGeometry(packed);
    try{
      expect(disposed).toHaveBeenCalledTimes(1);
      expectFiniteGeometry(restored);
      expect(Array.from(restored.getIndex()!.array)).toEqual([0,1,2]);
      for(const [name,attribute] of Object.entries(source.attributes)){
        expect(Array.from(restored.getAttribute(name).array)).toEqual(Array.from(attribute.array));
        expect(packed.attributes[name]!.array.buffer).not.toBe(attribute.array.buffer);
        expect(restored.getAttribute(name).itemSize).toBe(attribute.itemSize);
      }
      expect(packed.index!.buffer).not.toBe(source.getIndex()!.array.buffer);
      const transfers=geometryTransfers(packed);
      expect(transfers).toHaveLength(Object.keys(packed.attributes).length+1);
      expect(new Set(transfers).size).toBe(transfers.length);
      for(const buffer of transfers)expect(buffer).toBeInstanceOf(ArrayBuffer);
      expect(restored.boundingSphere).not.toBeNull();
      expect(Number.isFinite(restored.boundingSphere!.radius)).toBe(true);
    }finally{restored.dispose();}
  });

  it('微光等非索引几何不凭空增加索引，保留自定义标量属性',()=>{
    const source=new BufferGeometry();
    source.setAttribute('position',new Float32BufferAttribute([1,2,3,-1,4,2],3));
    source.setAttribute('aSeed',new Float32BufferAttribute([.25,.75],1));
    const packed=packGeometry(source),restored=unpackGeometry(packed);
    try{
      expect(packed.index).toBeNull();expect(restored.getIndex()).toBeNull();
      expect(restored.getAttribute('aSeed').itemSize).toBe(1);
      expect(Array.from(restored.getAttribute('aSeed').array)).toEqual([.25,.75]);
      expect(geometryTransfers(packed)).toHaveLength(2);
      expectFiniteGeometry(restored);
    }finally{restored.dispose();}
  });

  it('魔域四种合并网格独立传输，恢复后保留每层属性且不共享缓冲',()=>{
    const make=(height:number)=>{
      const source=new BufferGeometry();
      source.setAttribute('position',new Float32BufferAttribute([0,height,0,0,height,1,1,height,0],3));
      source.setAttribute('color',new Float32BufferAttribute([.4,.2,.6,.4,.2,.6,.4,.2,.6],3));
      source.setAttribute('aSite',new Float32BufferAttribute([0,1,2],1));
      source.setAttribute('aKind',new Float32BufferAttribute([0,0,0],1));
      source.setIndex([0,1,2]);source.computeVertexNormals();
      return packGeometry(source);
    };
    const part:WorldBuildPart={kind:'demon',demon:{stone:make(1),trim:make(2),glow:make(3),abyss:make(-2.8)}};
    const payloads=Object.values(part.demon),transfers=payloads.flatMap(geometryTransfers);
    expect(new Set(transfers).size).toBe(transfers.length);
    const restored=payloads.map(unpackGeometry);
    try{
      expect(restored).toHaveLength(4);
      for(const [index,geometry] of restored.entries()){
        expectFiniteGeometry(geometry);
        expect(Array.from(geometry.getAttribute('position').array)).toEqual(Array.from(payloads[index]!.attributes.position!.array));
        expect(Array.from(geometry.getAttribute('color').array)).toEqual(Array.from(payloads[index]!.attributes.color!.array));
        expect(Array.from(geometry.getAttribute('aSite').array)).toEqual([0,1,2]);
        expect(Array.from(geometry.getAttribute('aKind').array)).toEqual([0,0,0]);
        expect(geometry.boundingSphere).not.toBeNull();
      }
      expect(restored[3]!.getAttribute('position').getY(0)).toBeGreaterThan(-3.1);
    }finally{restored.forEach(geometry=>geometry.dispose());}
  });

  it('首屏轮廓底图无需全图采样，海面朝上且不覆盖内陆深坑',async()=>{
    vi.resetModules();
    const islands=await import('../../src/rendering/campaign/worldIslands');
    const previewModule=await import('../../src/rendering/campaign/worldPreview');
    const {WORLD_EXPANSION,WORLD_RADIUS}=await import('../../src/rendering/campaign/worldGeometry');
    const {SEA_LEVEL}=await import('../../src/rendering/campaign/worldLayout');
    const {DEMON_SITES}=await import('../../src/rendering/campaign/demonLayout');
    expect(islands.shoreFieldStats().sampled).toBe(0);
    const outlines=islands.WORLD_ISLANDS.map(island=>island.outline.map(p=>[...p]));
    const {terrain,sea}=previewModule.buildWorldPreview();
    try{
      expect(islands.shoreFieldStats().sampled).toBeGreaterThan(0);
      expect(islands.shoreFieldStats().sampled).toBeLessThan(islands.shoreFieldStats().total*.1);
      expect(islands.shoreFieldStats().complete).toBe(false);
      expect(islands.WORLD_ISLANDS.map(island=>island.outline.map(p=>[...p]))).toEqual(outlines);
      expectFiniteGeometry(terrain);expectFiniteGeometry(sea);
      const pit=DEMON_SITES['2-4'].center,pitModel:Point=[pit[0]*WORLD_EXPANSION,pit[1]*WORLD_EXPANSION];
      expect(islands.sampleIslandExact(pit[0],pit[1]).island?.id).toBe('demon');
      const position=sea.getAttribute('position'),index=sea.getIndex()!;
      for(let i=0;i<position.count;i++){
        expect(position.getY(i)).toBeCloseTo(SEA_LEVEL,6);
        expect(Math.hypot(position.getX(i),position.getZ(i))).toBeLessThanOrEqual(WORLD_RADIUS+.001);
      }
      let seaTriangles=0;
      for(let i=0;i<index.count;i+=3){
        const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2);
        const p:Point=[position.getX(a),position.getZ(a)],q:Point=[position.getX(b),position.getZ(b)],r:Point=[position.getX(c),position.getZ(c)];
        expect(cross(p,q,r)).toBeLessThanOrEqual(1e-6);
        expect(contains(pitModel,p,q,r)).toBe(false);
        if(Math.abs(cross(p,q,r))>1e-8)seaTriangles++;
      }
      expect(seaTriangles).toBeGreaterThan(0);
      const top=terrain.getAttribute('position'),topIndex=terrain.getIndex()!;
      let topTriangles=0;
      for(let i=0;i<topIndex.count;i+=3){
        const a=topIndex.getX(i),b=topIndex.getX(i+1),c=topIndex.getX(i+2);
        const area=cross([top.getX(a),top.getZ(a)],[top.getX(b),top.getZ(b)],[top.getX(c),top.getZ(c)]);
        // Vertical skirts have zero projected area; every horizontal top faces upward.
        if(Math.abs(area)<1e-8)continue;
        expect(area).toBeLessThan(0);topTriangles++;
      }
      expect(topTriangles).toBeGreaterThan(0);
    }finally{terrain.dispose();sea.dispose();}
  });
});
