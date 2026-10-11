import { useEffect,useMemo } from 'react';
import { IcosahedronGeometry,MeshStandardMaterial } from 'three';
import { landmarkPoint } from './worldGeometry';
import { sparkMaterial,type WorldClock } from './worldMaterials';
import { CENTRAL_TREE_ANCHOR } from './worldPlacement';
import type { CentralTreeGeometry } from './centralTreeGeometry';
import { WorldScatter } from './WorldScatter';

const noHit=():void=>{};

/** The central world tree consumes worker-built geometry owned by the map resource layer. */
export function CentralWorldTree({clock,tree}:{readonly clock:WorldClock;readonly tree:CentralTreeGeometry}){
  const base=useMemo(()=>landmarkPoint(...CENTRAL_TREE_ANCHOR),[]);
  const materials=useMemo(()=>({
    wood:new MeshStandardMaterial({vertexColors:true,roughness:.96}),
    leaves:new MeshStandardMaterial({color:'#ffffff',roughness:.91,flatShading:true}),
    lights:sparkMaterial(clock),
  }),[clock]);
  const leafGeometry=useMemo(()=>new IcosahedronGeometry(1,1),[]);
  useEffect(()=>()=>{materials.wood.dispose();materials.leaves.dispose();materials.lights.dispose();},[materials]);
  useEffect(()=>()=>leafGeometry.dispose(),[leafGeometry]);
  return <group position={[...base]} dispose={null}>
    <mesh geometry={tree.wood} material={materials.wood} castShadow receiveShadow raycast={noHit}/>
    <WorldScatter geometry={leafGeometry} material={materials.leaves} records={tree.leaves} nearDistance={Infinity}/>
    <points geometry={tree.lights} material={materials.lights} raycast={noHit}/>
  </group>;
}
