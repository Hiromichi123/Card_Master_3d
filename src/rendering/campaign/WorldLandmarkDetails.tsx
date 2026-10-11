import { useEffect, useMemo } from 'react';
import { IcosahedronGeometry,MeshStandardMaterial,type BufferGeometry,type Material } from 'three';
import { mainlandLandmark } from './worldGeometry';

interface DetailProps {readonly box:BufferGeometry;readonly stone:Material;readonly wood:Material;readonly gold:Material}

/** Local coordinates share the same world scale as the terrain. All decoration is noninteractive. */
export function WorldLandmarkDetails({box,stone,wood,gold}:DetailProps){
  const geometry=useMemo(()=>({orb:new IcosahedronGeometry(1,2)}),[]);
  const material=useMemo(()=>({ice:new MeshStandardMaterial({color:'#a2c8d3',roughness:.24,metalness:.06}),
    lamp:new MeshStandardMaterial({color:'#ead099',emissive:'#d9bc75',emissiveIntensity:.55,roughness:.6}),metal:new MeshStandardMaterial({color:'#798d97',metalness:.65,roughness:.35})}),[]);
  useEffect(()=>()=>Object.values(geometry).forEach(g=>g.dispose()),[geometry]);
  useEffect(()=>()=>Object.values(material).forEach(m=>m.dispose()),[material]);
  const noHit=():void=>{};
  const treeCenter=mainlandLandmark('human',-4.15,3);
  return <>
    {/* A small timber bridge joins the woodland footpath across the natural stream. */}
    <group position={[...mainlandLandmark('human',-3.3,1.35,.15)]}>
      {Array.from({length:9},(_,i)=><mesh key={i} geometry={box} material={wood} dispose={null} position={[0,0,-.42+i*.105]} scale={[.56,.035,.084]} castShadow raycast={noHit}/>)}
      {[-1,1].map(side=><group key={side}>
        <mesh geometry={box} material={wood} dispose={null} position={[side*.28,.18,0]} scale={[.035,.045,1.02]} raycast={noHit}/>
        {[-.45,0,.45].map(z=><mesh key={z} geometry={box} material={wood} dispose={null} position={[side*.28,.095,z]} scale={[.045,.26,.045]} raycast={noHit}/>)}
      </group>)}
    </group>
    {/* Partly buried ruins, broken beams and ice sheets reinforce the alpine terrain. */}
    <group position={[...mainlandLandmark('human',-6.65,-.75)]} rotation={[0,.22,0]}>
      {[-1,1].map(side=><mesh key={side} geometry={box} material={stone} dispose={null} position={[side*.34,.36,0]} scale={[.18,.72,.26]} rotation={[0,0,side*.05]} castShadow raycast={noHit}/>)}
      <mesh geometry={box} material={stone} dispose={null} position={[0,.74,0]} scale={[.91,.18,.28]} rotation={[0,0,.04]} castShadow raycast={noHit}/>
      <mesh geometry={box} material={material.ice} dispose={null} position={[0,.05,.12]} scale={[1.1,.03,.88]} rotation={[0,.19,0]} raycast={noHit}/>
    </group>
    {/* White panel ribs and inset blue strips extend the gate into its rock walls. */}
    <group position={[...mainlandLandmark('sacred',0,-4.95)]}>
      {[-1,1].flatMap(side=>Array.from({length:5},(_,i)=><group key={`${side}-${i}`} position={[side*(1.4+i*.18),.38+i*.17,-.25-i*.12]}>
        <mesh geometry={box} material={material.metal} dispose={null} scale={[.12,.8,.42]} rotation={[0,0,-side*.2]} castShadow raycast={noHit}/>
        <mesh geometry={box} material={material.ice} dispose={null} position={[0,.22,.22]} scale={[.04,.45,.02]} raycast={noHit}/>
      </group>))}
      <mesh geometry={box} material={gold} dispose={null} position={[0,2.04,.39]} scale={[1.6,.035,.035]} raycast={noHit}/>
    </group>
    {/* Small lamps among the roots and inside the leaves of the world tree. */}
    {[0,1,2,3,4,5,6,7].map(i=><mesh key={i} geometry={geometry.orb} material={material.lamp} dispose={null}
      position={[treeCenter[0]+Math.cos(i*2.399)*1.15,treeCenter[1]+1.95+(i%3)*.2,treeCenter[2]+Math.sin(i*2.399)*1.03]} scale={.035} raycast={noHit}/>)}
  </>;
}
