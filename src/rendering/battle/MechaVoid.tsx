import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, Matrix4, type Group, type InstancedMesh, type Material } from 'three';
import { buildMaterial, type QualityLevel } from '../table/materials';

type Vec3 = readonly [number,number,number];
type SceneClock = Readonly<{current:number}>;
interface Part { readonly position: Vec3; readonly size: Vec3 }
const noHit=():void=>{};
const MAIN_SIZE=Math.sqrt(11.55*11.35*4);
const CUBES: readonly { position:Vec3; rotation:Vec3; size:number; turn:number; phase:number }[] = [
  // Eight compass directions surround the board's stationary central cube.
  {position:[0,-18,-62],rotation:[.08,.3,-.07],size:22,turn:.033,phase:0},
  {position:[44,-24,-44],rotation:[-.07,-.42,.08],size:24,turn:-.026,phase:1.2},
  {position:[62,-20,0],rotation:[.13,.65,.1],size:22.5,turn:-.029,phase:2.3},
  {position:[44,-27,44],rotation:[-.1,.32,-.08],size:23,turn:.024,phase:3.1},
  {position:[0,-24,62],rotation:[.12,-.62,.05],size:23.5,turn:.023,phase:4.2},
  {position:[-44,-28,44],rotation:[-.08,.57,.13],size:22,turn:-.031,phase:5.1},
  {position:[-62,-19,0],rotation:[.09,.2,-.14],size:24,turn:.022,phase:6.3},
  {position:[-44,-23,-44],rotation:[-.12,-.25,.09],size:22.5,turn:-.025,phase:7.3},
];

function PartBatch({ geometry, material, parts }: {readonly geometry:BoxGeometry; readonly material:Material; readonly parts:readonly Part[]}) {
  const mesh=useRef<InstancedMesh>(null);
  const args=useMemo<[BoxGeometry,Material,number]>(()=>[geometry,material,parts.length],[geometry,material,parts.length]);
  useLayoutEffect(()=>{
    if(!mesh.current)return;
    const matrix=new Matrix4();
    parts.forEach((part,index)=>{
      matrix.makeScale(...part.size); matrix.setPosition(...part.position);
      mesh.current!.setMatrixAt(index,matrix);
    });
    mesh.current.instanceMatrix.needsUpdate=true; mesh.current.computeBoundingSphere();
  },[geometry,material,parts]);
  return <instancedMesh ref={mesh} args={args} dispose={null} raycast={noHit} />;
}

function TechnologyCube({ position, rotation=[0,0,0], size, turn=0, phase=0, clock, geometry, materials, parts, main=false }: {
  readonly position:Vec3; readonly rotation?:Vec3; readonly size:number; readonly turn?:number; readonly phase?:number;
  readonly clock:SceneClock; readonly geometry:BoxGeometry;
  readonly materials:{ readonly hull:Material; readonly armor:Material; readonly inset:Material; readonly energy:Material };
  readonly parts:{readonly armor:readonly Part[];readonly inset:readonly Part[];readonly energy:readonly Part[]};
  readonly main?:boolean;
}) {
  const group=useRef<Group>(null);
  useFrame(()=>{
    if(!group.current || main)return;
    const t=clock.current;
    group.current.position.y=position[1]+Math.sin(t*.18+phase)*1.1;
    group.current.rotation.set(rotation[0]+Math.sin(t*.09+phase)*.025,rotation[1]+t*turn,rotation[2]+Math.cos(t*.08+phase)*.025);
  });
  return <group ref={group} position={position} rotation={rotation} scale={size}>
    <mesh geometry={geometry} material={materials.hull} dispose={null} castShadow={main} receiveShadow={main} raycast={noHit} />
    <PartBatch geometry={geometry} material={materials.armor} parts={parts.armor} />
    <PartBatch geometry={geometry} material={materials.inset} parts={parts.inset} />
    <PartBatch geometry={geometry} material={materials.energy} parts={parts.energy} />
  </group>;
}

/** Main cube top area is exactly four times the actual plate; eight distant cubes share the prototype. */
export function MechaVoid({ clock, quality }: {readonly clock:SceneClock;readonly quality:QualityLevel}) {
  const geometry=useMemo(()=>new BoxGeometry(1,1,1),[]);
  const materials=useMemo(()=>({
    hull:buildMaterial({kind:'plain',color:0xaab5bf,metalness:.68,roughness:.43,clearcoat:.12,envMapIntensity:.7},{quality}),
    armor:buildMaterial({kind:'plain',color:0xc1c9cf,metalness:.63,roughness:.46,clearcoat:.1,envMapIntensity:.65},{quality}),
    inset:buildMaterial({kind:'plain',color:0x4b5b68,metalness:.78,roughness:.38},{quality}),
    energy:buildMaterial({kind:'plain',color:0x359bea,roughness:.4,metalness:.1,emissive:0x228fed,emissiveIntensity:.95},{quality}),
  }),[quality]);
  const parts=useMemo(()=>{
    const armor:Part[]=[],inset:Part[]=[],energy:Part[]=[];
    for(const side of [-1,1]) {
      armor.push({position:[0,-.13,side*.507],size:[.82,.52,.016]});
      armor.push({position:[side*.507,-.13,0],size:[.016,.52,.82]});
      inset.push({position:[0,.24,side*.519],size:[.92,.07,.012]});
      inset.push({position:[side*.519,.24,0],size:[.012,.07,.92]});
      energy.push({position:[0,.24,side*.526],size:[.84,.016,.008]});
      energy.push({position:[side*.526,.24,0],size:[.008,.016,.84]});
      inset.push({position:[side*.42,.506,0],size:[.07,.012,.9]});
      energy.push({position:[side*.42,.513,0],size:[.016,.008,.84]});
      inset.push({position:[0,.506,side*.42],size:[.9,.012,.07]});
      energy.push({position:[0,.513,side*.42],size:[.84,.008,.016]});
      for(const edge of [-1,1]) {
        inset.push({position:[side*.479,0,edge*.479],size:[.041,.98,.041]});
        inset.push({position:[edge*.32,-.12,side*.519],size:[.057,.6,.011]});
        energy.push({position:[edge*.32,-.12,side*.526],size:[.014,.54,.008]});
        inset.push({position:[side*.519,-.12,edge*.32],size:[.011,.6,.057]});
        energy.push({position:[side*.526,-.12,edge*.32],size:[.008,.54,.014]});
      }
    }
    return {armor,inset,energy};
  },[]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  useEffect(()=>()=>{Object.values(materials).forEach(material=>material.dispose());},[materials]);
  useFrame(()=>{materials.energy.emissiveIntensity=.88+Math.sin(clock.current*.7)*.08;});
  return <>
    <TechnologyCube position={[0,-1.12-MAIN_SIZE/2,0]} size={MAIN_SIZE} clock={clock}
      geometry={geometry} materials={materials} parts={parts} main />
    {CUBES.map((cube,index)=><TechnologyCube key={index} {...cube} clock={clock}
      geometry={geometry} materials={materials} parts={parts} />)}
  </>;
}
