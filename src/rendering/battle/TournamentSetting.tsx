import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { MeshReflectorMaterial } from '@react-three/drei';
import {
  BoxGeometry, Color, CylinderGeometry, Euler, ExtrudeGeometry, Matrix4, Quaternion, Shape, Vector3,
  type BufferGeometry, type InstancedMesh, type Material,
} from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { buildMaterial, type QualityLevel } from '../table/materials';
import { LAYOUT } from './layout';

type Vec3 = readonly [number,number,number];
interface Part { readonly position: Vec3; readonly size: Vec3; readonly rotation?: Vec3; readonly color?: number }
const FLOOR = -4.4, FLOOR_RADIUS = 28;
const noHit = (): void => {};

function roundedTable(): ExtrudeGeometry {
  const x=7.6,z=8.4,r=.72,shape=new Shape();
  shape.moveTo(-x+r,-z);shape.lineTo(x-r,-z);shape.quadraticCurveTo(x,-z,x,-z+r);
  shape.lineTo(x,z-r);shape.quadraticCurveTo(x,z,x-r,z);
  shape.lineTo(-x+r,z);shape.quadraticCurveTo(-x,z,-x,z-r);
  shape.lineTo(-x,-z+r);shape.quadraticCurveTo(-x,-z,-x+r,-z);
  const geometry=new ExtrudeGeometry(shape,{depth:.45,bevelEnabled:true,bevelSize:.09,bevelThickness:.04,bevelSegments:3,curveSegments:12});
  geometry.rotateX(-Math.PI/2);geometry.translate(0,-.74,0);
  const positions=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  for(let i=0;i<positions.count;i++)uv.setXY(i,positions.getX(i)/15.2+.5,positions.getZ(i)/16.8+.5);
  uv.needsUpdate=true;return geometry;
}

function Parts({geometry,material,parts,shadow=false}:{readonly geometry:BufferGeometry;readonly material:Material;readonly parts:readonly Part[];readonly shadow?:boolean}) {
  const mesh=useRef<InstancedMesh>(null);
  const args=useMemo<[BufferGeometry,Material,number]>(()=>[geometry,material,parts.length],[geometry,material,parts.length]);
  useLayoutEffect(()=>{
    if(!mesh.current)return;
    const matrix=new Matrix4(),p=new Vector3(),s=new Vector3(),e=new Euler(),q=new Quaternion(),color=new Color();
    parts.forEach((part,i)=>{
      const angles:Vec3=part.rotation??[0,0,0];
      p.set(...part.position);s.set(...part.size);e.set(...angles);q.setFromEuler(e);matrix.compose(p,q,s);
      mesh.current!.setMatrixAt(i,matrix);
      if(part.color!==undefined)mesh.current!.setColorAt(i,color.setHex(part.color));
    });
    mesh.current.instanceMatrix.needsUpdate=true;
    if(mesh.current.instanceColor)mesh.current.instanceColor.needsUpdate=true;
    mesh.current.computeBoundingSphere();
  },[args,parts]);
  return <instancedMesh ref={mesh} args={args} dispose={null} castShadow={shadow} receiveShadow raycast={noHit}/>;
}

/** Wooden tournament table on polished marble, without surrounding architecture. */
export function TournamentSetting({quality}:{readonly quality:QualityLevel}) {
  useLayoutEffect(()=>{RectAreaLightUniformsLib.init();},[]);
  const geometry=useMemo(()=>({
    box:new BoxGeometry(1,1,1),table:roundedTable(),
    foundation:new CylinderGeometry(FLOOR_RADIUS,FLOOR_RADIUS,.54,64),
  }),[]);
  const materials=useMemo(()=>({
    trim:buildMaterial({kind:'wood',light:0x59402a,dark:0x2c2017,rings:16,roughness:.5,clearcoat:.22,envMapIntensity:.45},{quality}),
    tabletop:buildMaterial({kind:'wood',light:0x906840,dark:0x50351f,rings:19,angle:.14,roughness:.36,clearcoat:.38,clearcoatRoughness:.23,envMapIntensity:.55},{quality,textureScale:2}),
    brass:buildMaterial({kind:'metal',color:0xa98a50,metalness:.76,roughness:.38,envMapIntensity:.65},{quality}),
    floor:buildMaterial({kind:'marble',base:0xbcbcb4,vein:0x5a6267,scale:3.1,roughness:.2,clearcoat:.62,clearcoatRoughness:.16,envMapIntensity:.65},{quality,textureScale:4}),
    foundation:buildMaterial({kind:'stone',color:0x373635,roughness:.8},{quality}),
    felt:buildMaterial({kind:'plain',color:0x25251e,roughness:1},{quality}),
  }),[quality]);
  const parts=useMemo(()=>{
    const timber:Part[]=[],bronze:Part[]=[];
    for(const x of [-6.35,6.35])for(const z of [-7.05,7.05]){
      timber.push({position:[x,-2.5,z],size:[.62,3.55,.62]});
      for(const y of [-4.12,-3.8,-1.25,-.85])timber.push({position:[x,y,z],size:[.83,.22,.83]});
      bronze.push({position:[x,-4.19,z],size:[.85,.14,.85]});
    }
    for(const side of [-1,1]){
      timber.push({position:[side*6.75,-1.02,0],size:[.35,.68,15.3]});
      timber.push({position:[0,-1.02,side*7.45],size:[13.8,.68,.35]});
      bronze.push({position:[side*7.63,-.49,0],size:[.028,.06,15.5]});
      bronze.push({position:[0,-.49,side*8.43],size:[14.2,.06,.028]});
      timber.push({position:[0,-3.15,side*6.95],size:[13.3,.3,.38]});
    }
    return {timber,bronze};
  },[]);
  useEffect(()=>()=>{Object.values(geometry).forEach(item=>item.dispose());},[geometry]);
  useEffect(()=>()=>{Object.values(materials).forEach(material=>material.dispose());},[materials]);
  return <group position={[0,0,LAYOUT.tableCenterZ]}>
    <mesh geometry={geometry.foundation} material={materials.foundation} dispose={null} position={[0,FLOOR-.27,0]} receiveShadow raycast={noHit}/>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,FLOOR+.012,0]} receiveShadow raycast={noHit}>
      <circleGeometry args={[FLOOR_RADIUS,64]}/>
      {quality==='low'?<primitive object={materials.floor} attach="material" dispose={null}/>:<MeshReflectorMaterial
        resolution={quality==='high'?512:256} blur={[160,60]} mixBlur={.75} mixStrength={.36} mirror={.32} mixContrast={.94}
        minDepthThreshold={.4} maxDepthThreshold={1.4} depthScale={.15} roughness={.2} metalness={.02}
        map={materials.floor.map} roughnessMap={materials.floor.roughnessMap} normalMap={materials.floor.normalMap}
        normalScale={materials.floor.normalScale} color={materials.floor.color} envMapIntensity={.65}/>}</mesh>
    <mesh geometry={geometry.table} material={materials.tabletop} dispose={null} receiveShadow castShadow raycast={noHit}/>
    <mesh geometry={geometry.box} material={materials.felt} dispose={null} position={[0,-.155,0]} scale={[11.76,.23,11.76]} receiveShadow raycast={noHit}/>
    <Parts geometry={geometry.box} material={materials.trim} parts={parts.timber} shadow/>
    <Parts geometry={geometry.box} material={materials.brass} parts={parts.bronze}/>
    <rectAreaLight position={[0,5.35,0]} rotation={[-Math.PI/2,0,0]} width={9} height={11} intensity={2.1} color={0xffe0b5}/>
  </group>;
}
