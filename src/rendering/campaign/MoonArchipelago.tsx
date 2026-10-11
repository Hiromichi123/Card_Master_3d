import { useEffect,useLayoutEffect,useMemo,useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color,InstancedBufferAttribute,Matrix4,PlaneGeometry,Quaternion,TorusGeometry,Vector3,type Group,type InstancedMesh,type Material } from 'three';
import { buildIsland,type CloudInstance } from './worldGeometry';
import { rand } from './worldLayout';
import { MOON_ISLANDS,MOON_ORIGIN } from './moonLayout';
import type { WorldClock } from './worldMaterials';

const noHit=():void=>{};
interface MoonProps {readonly clock:WorldClock;readonly ground:Material;readonly gold:Material;readonly clouds:Material}

/** Floating landforms change size; the existing capital ring keeps its original dimensions. */
export function MoonArchipelago({clock,ground,gold,clouds}:MoonProps){
  const group=useRef<Group>(null);
  const geometry=useMemo(()=>({
    islands:MOON_ISLANDS.map(island=>buildIsland(island.radius,island.depth,island.seed)),
    ring:new TorusGeometry(1.5,.045,6,64).rotateX(Math.PI/2),
  }),[]);
  const banks=useMemo(()=>MOON_ISLANDS.flatMap((island,index):CloudInstance[]=>{
    const count=index===0?8:4;
    return Array.from({length:count},(_,i)=>{
      const seed=index*31+i,a=i/count*Math.PI*2+rand(seed,401)*.7;
      const r=island.radius*(1.02+rand(seed,402)*.42);
      return {
        position:[island.position[0]+Math.cos(a)*r,island.position[1]-.28+(rand(seed,403)-.5)*.55,island.position[2]+Math.sin(a)*r],
        size:[island.radius*(1.05+rand(seed,404)*.6),.62+rand(seed,405)*.52],
        color:'#d3dfef',opacity:.32+rand(seed,406)*.12,seed:seed*.61+70,
      };
    });
  }),[]);
  useEffect(()=>()=>{geometry.islands.forEach(island=>island.dispose());geometry.ring.dispose();},[geometry]);
  useFrame(()=>{if(group.current)group.current.position.y=Math.sin(clock.value*.3)*.045;});
  return <group ref={group}>
    {MOON_ISLANDS.map((island,index)=><mesh key={island.id} geometry={geometry.islands[index]!} material={ground}
      position={[...island.position]} dispose={null} castShadow receiveShadow raycast={noHit}/>)}
    <mesh geometry={geometry.ring} material={gold} position={[MOON_ORIGIN[0],MOON_ORIGIN[1]+.28,MOON_ORIGIN[2]]}
      dispose={null} raycast={noHit}/>
    <MoonCloudBank records={banks} material={clouds}/>
  </group>;
}

/** Each bank skirts an island rim, leaving the plateau and tapered rock silhouette exposed. */
function MoonCloudBank({records,material}:{readonly records:readonly CloudInstance[];readonly material:Material}){
  const mesh=useRef<InstancedMesh>(null);
  const geometry=useMemo(()=>{
    const g=new PlaneGeometry(1,1),tint:number[]=[];
    records.forEach(record=>{const color=new Color(record.color);tint.push(color.r,color.g,color.b);});
    g.setAttribute('aTint',new InstancedBufferAttribute(new Float32Array(tint),3));
    g.setAttribute('aSeed',new InstancedBufferAttribute(new Float32Array(records.map(record=>record.seed)),1));
    g.setAttribute('aOpacity',new InstancedBufferAttribute(new Float32Array(records.map(record=>record.opacity)),1));
    return g;
  },[records]);
  useLayoutEffect(()=>{
    if(!mesh.current)return;
    const matrix=new Matrix4(),position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();
    records.forEach((record,index)=>mesh.current!.setMatrixAt(index,matrix.compose(position.set(...record.position),rotation,scale.set(record.size[0],record.size[1],1))));
    mesh.current.instanceMatrix.needsUpdate=true;
  },[records,geometry]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <instancedMesh ref={mesh} args={[geometry,material,records.length]} dispose={null} frustumCulled={false} renderOrder={2} raycast={noHit}/>;
}
