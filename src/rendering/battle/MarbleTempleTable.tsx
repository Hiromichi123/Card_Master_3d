import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import {
  BoxGeometry, CylinderGeometry, Euler, ExtrudeGeometry,
  Matrix4, Path, Quaternion, Shape, Vector3,
  type BufferGeometry, type Group, type InstancedMesh, type Material,
} from 'three';
import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { buildMaterial, type QualityLevel } from '../table/materials';
import type { TableTheme } from '../table/themes';
import { LAYOUT } from './layout';
import { TempleWater } from './TempleWater';

type Vec3=readonly [number,number,number];
interface Part {readonly position:Vec3;readonly scale:Vec3;readonly rotation?:Vec3}
const FLOOR=-5.8,noHit=():void=>{};
function rectangle(width:number,depth:number,cut=.2):Shape{
  const x=width/2,z=depth/2,shape=new Shape();
  const points=[[-x+cut,-z],[x-cut,-z],[x,-z+cut],[x,z-cut],[x-cut,z],[-x+cut,z],[-x,z-cut],[-x,-z+cut]];
  points.forEach(([a,b],i)=>{if(i===0)shape.moveTo(a!,b!);else shape.lineTo(a!,b!);});shape.closePath();return shape;
}
function basinShape():Shape{
  const shape=rectangle(6.25,2.55,.26),hole=new Path();
  hole.moveTo(-2.75,-.95);hole.lineTo(-2.75,.95);hole.lineTo(2.75,.95);hole.lineTo(2.75,-.95);hole.closePath();shape.holes.push(hole);return shape;
}
function solid(shape:Shape|Shape[],depth:number,top:number,bevel=.035):ExtrudeGeometry{
  const geometry=new ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:2,curveSegments:1});
  geometry.rotateX(-Math.PI/2);geometry.translate(0,top-depth-bevel,0);
  const p=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  for(let i=0;i<p.count;i++)uv.setXY(i,p.getX(i)/16+.5,p.getZ(i)/17+.5);uv.needsUpdate=true;return geometry;
}
function arenaShapes():Shape[]{
  const north=new Shape();
  north.moveTo(-5.8,.28);north.lineTo(5.8,.28);north.lineTo(5.8,5.55);north.lineTo(5.55,5.8);
  north.lineTo(-5.55,5.8);north.lineTo(-5.8,5.55);north.closePath();
  const south=new Shape();
  south.moveTo(-5.8,-5.55);south.lineTo(-5.55,-5.8);south.lineTo(5.55,-5.8);south.lineTo(5.8,-5.55);
  south.lineTo(5.8,-.28);south.lineTo(-5.8,-.28);south.closePath();
  return [north,south];
}

function Batch({geometry,material,parts,shadow=false}:{readonly geometry:BufferGeometry;readonly material:Material;readonly parts:readonly Part[];readonly shadow?:boolean}){
  const mesh=useRef<InstancedMesh>(null);
  const args=useMemo<[BufferGeometry,Material,number]>(()=>[geometry,material,parts.length],[geometry,material,parts.length]);
  useLayoutEffect(()=>{
    if(!mesh.current)return;
    const matrix=new Matrix4(),p=new Vector3(),s=new Vector3(),e=new Euler(),q=new Quaternion();
    parts.forEach((part,i)=>{
      const angles:Vec3=part.rotation??[0,0,0];p.set(...part.position);s.set(...part.scale);e.set(...angles);q.setFromEuler(e);matrix.compose(p,q,s);mesh.current!.setMatrixAt(i,matrix);
    });
    mesh.current.instanceMatrix.needsUpdate=true;mesh.current.computeBoundingSphere();
  },[args,parts]);
  return <instancedMesh ref={mesh} args={args} dispose={null} castShadow={shadow} receiveShadow raycast={noHit}/>;
}

function OpenRoof({geometry,material,parts}:{readonly geometry:BufferGeometry;readonly material:Material;readonly parts:readonly Part[]}){
  const roof=useRef<Group>(null);
  useFrame(({camera})=>{if(roof.current)roof.current.visible=camera.position.y<5.0;});
  return <group ref={roof}><Batch geometry={geometry} material={material} parts={parts}/></group>;
}

/** Single white-marble arena on a carved water table, framed by a broad Doric temple. */
export function MarbleTempleTable({theme,quality,reduceMotion}:{readonly theme:TableTheme;readonly quality:QualityLevel;readonly reduceMotion:boolean}){
  const clock=useRef(0);
  const materials=useMemo(()=>({
    white:(()=>{const material=buildMaterial(theme.mat.light,{quality});material.color.multiplyScalar(.86);material.roughness=.52;material.clearcoat=.08;material.envMapIntensity=.28;return material;})(),
    architecture:buildMaterial({kind:'marble',base:0xdad7cc,vein:0xbabcb8,roughness:.5,clearcoat:.12,envMapIntensity:.45},{quality,textureScale:2}),
    edges:buildMaterial({kind:'marble',base:0xcac8bc,vein:0xa3a7a2,roughness:.46,clearcoat:.18,envMapIntensity:.45},{quality}),
    floor:buildMaterial({kind:'marble',base:0xd0d0c6,vein:0xa3aaa6,roughness:.24,clearcoat:.4,clearcoatRoughness:.2,envMapIntensity:.5},{quality,textureScale:5}),
    bronze:buildMaterial(theme.mat.frame,{quality}),
  }),[theme,quality]);
  const geometry=useMemo(()=>{
    const column=new CylinderGeometry(.86,1,1,quality==='high'?64:quality==='medium'?48:32,4);
    const positions=column.getAttribute('position');
    for(let i=0;i<positions.count;i++){
      const x=positions.getX(i),z=positions.getZ(i),angle=Math.atan2(x,z),flute=1-.065*(.5+.5*Math.cos(angle*16));
      positions.setX(i,x*flute);positions.setZ(i,z*flute);
    }
    positions.needsUpdate=true;column.computeVertexNormals();
    const gable=new Shape();gable.moveTo(-31.2,5.2);gable.lineTo(31.2,5.2);gable.lineTo(0,12.3);gable.closePath();
    return {box:new BoxGeometry(1,1,1),column,
      capital:new CylinderGeometry(1.15,1,.22,quality==='low'?24:48),
      arena:solid(arenaShapes(),.36,-.012,.025),
      fountain:new CylinderGeometry(.33,.38,.10,32),fountainFoot:new CylinderGeometry(.19,.24,.18,24),nozzle:new CylinderGeometry(.055,.085,.15,16),
      tray:solid(rectangle(15.6,16.4,.25),.27,-.85,.04),
      core:solid(rectangle(12.55,13.6,.2),.47,-.38,.025),
      basin:solid(basinShape(),.58,-4.72,.05),
      gable:new ExtrudeGeometry(gable,{depth:.36,bevelEnabled:true,bevelSize:.055,bevelThickness:.035,bevelSegments:2}),
    };
  },[quality]);
  const parts=useMemo(()=>{
    const structure:Part[]=[],columns:Part[]=[],capitals:Part[]=[],metal:Part[]=[],roof:Part[]=[],gutters:Part[]=[];
    structure.push({position:[0,FLOOR-.32,0],scale:[68,.64,72]});
    structure.push({position:[0,FLOOR+.1,0],scale:[63,.3,66.2]});
    // Central stepped pedestal is solid down to the temple platform.
    structure.push({position:[0,-5.14,0],scale:[9.2,.78,10.2]});
    structure.push({position:[0,-3.02,0],scale:[7.2,3.55,8.2]});
    structure.push({position:[0,-1.09,0],scale:[8.5,.42,9.5]});
    structure.push({position:[0,-5.35,9.1],scale:[6.7,.75,3.1]});
    structure.push({position:[0,-5.19,9.1],scale:[5.9,.18,2.2]});
    for(const side of [-1,1]){
      gutters.push({position:[side*7.3,-.62,0],scale:[1,.48,16.4]});
      gutters.push({position:[side*3.59,-.62,7.88],scale:[6.42,.48,.64]});
    }
    gutters.push({position:[0,-.62,-7.88],scale:[13.6,.48,.64]});
    gutters.push({position:[0,-.90,8.2],scale:[.86,.17,.72]});
    // The recessed cross-channel crosses the arena and drains into both side gutters.
    gutters.push({position:[0,-.30,0],scale:[12.55,.16,.56]});
    for(const side of [-1,1]){
      gutters.push({position:[side*6.38,-.78,0],scale:[.36,.16,.66]});
      metal.push({position:[side*6.31,-.19,0],scale:[.17,.04,.62]});
    }
    const positions:Vec3[]=[];
    for(const x of [-30,30])for(let i=0;i<9;i++)positions.push([x,0,-31.6+i*7.9]);
    for(const z of [-31.6,31.6])for(const x of [-22.5,-15,-7.5,0,7.5,15,22.5])positions.push([x,0,z]);
    for(const [x,,z] of positions){
      structure.push({position:[x,-5.14,z],scale:[2.25,.78,2.25]});
      structure.push({position:[x,-4.74,z],scale:[1.9,.20,1.9]});
      columns.push({position:[x,-.44,z],scale:[.79,8.4,.79]});
      capitals.push({position:[x,3.92,z],scale:[.88,1,.88]});
      structure.push({position:[x,4.16,z],scale:[2.05,.25,2.05]});
      metal.push({position:[x,4.31,z],scale:[2.10,.055,2.10]});
    }
    for(const side of [-1,1]){
      structure.push({position:[side*30,4.75,0],scale:[2.4,.82,65.6]});
      structure.push({position:[0,4.75,side*31.6],scale:[62.4,.82,2.4]});
      structure.push({position:[side*30,5.23,0],scale:[2.9,.18,66.2]});
      structure.push({position:[0,5.23,side*31.6],scale:[63,.18,2.9]});
      roof.push({position:[side*15.3,8.65,0],scale:[32.0,.23,67],rotation:[0,0,-side*.225]});
      for(let i=0;i<32;i++){
        const z=-31+i*2;
        structure.push({position:[side*31.225,4.82,z],scale:[.10,.36,.28]});
      }
      for(let i=0;i<31;i++){
        const x=-29.6+i*1.975;
        structure.push({position:[x,4.82,side*32.825],scale:[.28,.36,.10]});
      }
    }
    roof.push({position:[0,12.31,0],scale:[.28,.26,67.8]});
    return {structure,columns,capitals,metal,roof,gutters};
  },[]);
  useEffect(()=>()=>{Object.values(materials).forEach(material=>material.dispose());},[materials]);
  useEffect(()=>()=>{Object.values(geometry).forEach(item=>item.dispose());},[geometry]);
  useFrame((_,delta)=>{if(!reduceMotion)clock.current+=Math.min(delta,.05)/ANIMATION_DURATION_SCALE;});
  return <group position={[0,0,LAYOUT.tableCenterZ]}>
    <Batch geometry={geometry.box} material={materials.architecture} parts={parts.structure} shadow/>
    <Batch geometry={geometry.column} material={materials.architecture} parts={parts.columns} shadow/>
    <Batch geometry={geometry.capital} material={materials.architecture} parts={parts.capitals}/>
    <Batch geometry={geometry.box} material={materials.bronze} parts={parts.metal}/>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,FLOOR+.266,0]} receiveShadow raycast={noHit}>
      <planeGeometry args={[62.6,65.8]}/>
      {quality==='low'?<primitive object={materials.floor} attach="material" dispose={null}/>:<MeshReflectorMaterial
        resolution={quality==='high'?512:256} blur={[140,60]} mixBlur={.8} mixStrength={.12} mirror={.14} mixContrast={.95}
        roughness={.24} metalness={.02} map={materials.floor.map} roughnessMap={materials.floor.roughnessMap}
        normalMap={materials.floor.normalMap} normalScale={materials.floor.normalScale} color={materials.floor.color} envMapIntensity={.5}/>}</mesh>
    {[-32.9,32.54].map(z=><mesh key={z} geometry={geometry.gable} material={materials.architecture} dispose={null} position={[0,0,z]} receiveShadow raycast={noHit}/>)}
    <OpenRoof geometry={geometry.box} material={materials.edges} parts={parts.roof}/>
    <mesh geometry={geometry.tray} material={materials.edges} dispose={null} receiveShadow castShadow raycast={noHit}/>
    <mesh geometry={geometry.core} material={materials.architecture} dispose={null} receiveShadow castShadow raycast={noHit}/>
    <Batch geometry={geometry.box} material={materials.architecture} parts={parts.gutters} shadow/>
    <mesh geometry={geometry.arena} material={materials.white} dispose={null} receiveShadow castShadow raycast={noHit}/>
    <mesh geometry={geometry.fountainFoot} material={materials.white} dispose={null} position={[0,-.135,0]} receiveShadow raycast={noHit}/>
    <mesh geometry={geometry.fountain} material={materials.white} dispose={null} position={[0,-.005,0]} receiveShadow raycast={noHit}/>
    <mesh geometry={geometry.nozzle} material={materials.bronze} dispose={null} position={[0,.09,0]} raycast={noHit}/>
    <mesh geometry={geometry.basin} material={materials.architecture} dispose={null} position={[0,0,9.1]} receiveShadow castShadow raycast={noHit}/>
    <TempleWater clock={clock}/>
  </group>;
}
