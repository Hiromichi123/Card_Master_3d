import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferGeometry, Euler, ExtrudeGeometry, Float32BufferAttribute, IcosahedronGeometry, InstancedBufferAttribute,
  Matrix4, NormalBlending, PlaneGeometry, Quaternion, Shape, ShapeGeometry, Vector3,
  type InstancedMesh, type MeshStandardMaterial,
} from 'three';
import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { buildMaterial, type QualityLevel } from '../table/materials';
import type { TableTheme } from '../table/themes';
import { WeatherLayer } from '../table/weather';
import { createCrystalGeometry } from '../effects/vendor/linear-native/assets/ProceduralGeometry.js';
import { createIceMaterial } from '../effects/vendor/linear-native/materials/IceMaterial.js';
import { createFrostFieldMaterial, createFrostVeilMaterial } from '../effects/vendor/linear-native/materials/FrostFieldMaterial.js';
import { BATTLE_CARD_SCALE, CARD_SIZE, LAYOUT, PREP_CARD_SCALE, buildSlots } from './layout';

type Vec3=readonly [number,number,number];
type Clock=Readonly<{current:number}>;
interface Crystal {readonly position:Vec3;readonly width:number;readonly height:number;readonly lean:Vec3;readonly seed:number;readonly animate:boolean}
const noHit=():void=>{};
const OUTLINE:readonly (readonly [number,number])[]=[[-5.05,-6.25],[4.6,-6.25],[6.3,-4.55],[6.2,4.85],[4.75,6.25],[-4.85,6.25],[-6.25,4.65],[-6.3,-4.65]];
function randomAt(i:number,salt=0):number{const n=Math.sin(i*127.1+salt*311.7+97.4)*43758.5453;return n-Math.floor(n);}
function shape(scale=1):Shape{
  const outline=new Shape();OUTLINE.forEach(([x,z],i)=>{if(i===0)outline.moveTo(x*scale,z*scale);else outline.lineTo(x*scale,z*scale);});outline.closePath();return outline;
}
function planarUV(geometry:BufferGeometry):void{
  const positions=geometry.getAttribute('position'),uv:number[]=[];
  for(let i=0;i<positions.count;i++)uv.push(positions.getX(i)/12.6+.5,positions.getZ(i)/12.6+.5);
  geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));
}
function plate(scale:number,depth:number,top:number):ExtrudeGeometry{
  const geometry=new ExtrudeGeometry(shape(scale),{depth,bevelEnabled:true,bevelSize:.065,bevelThickness:.035,bevelSegments:3,curveSegments:1});
  geometry.rotateX(-Math.PI/2);geometry.translate(0,top-depth-.035,0);planarUV(geometry);return geometry;
}
function snowHeight(x:number,z:number):number{
  const range=Math.min(1,Math.max(0,(Math.hypot(x,z)-9)/17));
  return -1.52+Math.sin(x*.22)*Math.cos(z*.18)*(.14+range*.65)+Math.sin(x*.09+z*.13)*range*.52;
}
function crystals(quality:QualityLevel):Crystal[]{
  const records:Crystal[]=[],slots=buildSlots();
  const safe=(x:number,z:number,padding:number)=>!slots.some(slot=>{
    const scale=slot.zone==='battle'?BATTLE_CARD_SCALE:PREP_CARD_SCALE;
    return Math.abs(x-slot.position[0])<CARD_SIZE.width*scale*.5+padding && Math.abs(z-(slot.position[2]-LAYOUT.tableCenterZ))<CARD_SIZE.height*scale*.5+padding;
  }) && !(Math.abs(Math.abs(x)-4.72)<.38+padding && Math.abs(Math.abs(z)-4)<.52+padding)
    && !(Math.abs(z)>5.15 && Math.abs(x)<5.35);
  const rim=quality==='high'?65:quality==='medium'?42:24;
  for(let i=0;i<rim*4 && records.length<rim;i++){
    const angle=randomAt(i,3)*Math.PI*2;
    const x=Math.cos(angle)*(5.7+randomAt(i,5)*.35),z=Math.sin(angle)*(5.7+randomAt(i,7)*.35);
    const width=.23+randomAt(i,9)*.32,height=.27+randomAt(i,11)*.72;
    if(!safe(x,z,width*.7+height*.2))continue;
    records.push({position:[x,-.01,z],width,height,lean:[(randomAt(i,13)-.5)*.48,angle,(randomAt(i,15)-.5)*.48],seed:i*.67+13,animate:i%7===0});
  }
  const landscape=quality==='high'?150:quality==='medium'?96:55;
  for(let i=0;i<landscape*4 && records.length<rim+landscape;i++){
    const angle=randomAt(i,21)*Math.PI*2,radius=9+randomAt(i,23)*21;
    const x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
    if(z>6 && Math.abs(x)<10)continue;
    const near=Math.max(0,Math.min(1,(radius-9)/12)),height=1.0+randomAt(i,25)*(3.2+near*4.4);
    records.push({position:[x,snowHeight(x,z)-.07,z],width:.55+randomAt(i,27)*1.75,height,
      lean:[(randomAt(i,29)-.5)*.56,angle,(randomAt(i,31)-.5)*.56],seed:i*.79+91,animate:i%11===0});
  }
  return records;
}

/** Reuses the Frost Lance material and Glacial Crown crystal shape, with a map-owned clock. */
function CrystalBatch({variant,records,material,clock}:{readonly variant:number;readonly records:readonly Crystal[];readonly material:MeshStandardMaterial;readonly clock:Clock}){
  const mesh=useRef<InstancedMesh>(null),lastTime=useRef(-1);
  const geometry=useMemo(()=>{
    const crystal=createCrystalGeometry({seed:3.9+variant*17.3,sides:5+variant,taper:.14+variant*.075,roughness:.055+variant*.025,bend:.025+variant*.025});
    crystal.setAttribute('aSeed',new InstancedBufferAttribute(new Float32Array(records.map(record=>record.seed)),1));
    crystal.setAttribute('aBirth',new InstancedBufferAttribute(new Float32Array(records.length),1));return crystal;
  },[variant,records]);
  const args=useMemo<[BufferGeometry,MeshStandardMaterial,number]>(()=>[geometry,material,records.length],[geometry,material,records.length]);
  const transforms=useMemo(()=>({matrix:new Matrix4(),position:new Vector3(),scale:new Vector3(),rotation:new Euler(),quaternion:new Quaternion()}),[]);
  const write=(t:number):void=>{
    if(!mesh.current)return;
    const birth=geometry.getAttribute('aBirth') as InstancedBufferAttribute;
    records.forEach((record,i)=>{
      let grow=1,flash=0;
      if(record.animate){
        const phase=((t+record.seed*.31)%28)/28;
        if(phase<.15){const k=phase/.15;grow=.45+.55*k*k*(3-2*k);flash=(1-k)*.35;}
        else if(phase>.82){const k=(phase-.82)/.18;grow=1-.55*k*k*(3-2*k);}
      }
      const {matrix,position,scale,rotation,quaternion}=transforms;
      position.set(...record.position);scale.set(record.width,record.height*grow,record.width*(.8+variant*.1));
      rotation.set(...record.lean);quaternion.setFromEuler(rotation);matrix.compose(position,quaternion,scale);
      mesh.current!.setMatrixAt(i,matrix);birth.setX(i,flash);
    });
    mesh.current.instanceMatrix.needsUpdate=true;birth.needsUpdate=true;
  };
  useLayoutEffect(()=>{write(clock.current);mesh.current?.computeBoundingSphere();},[args,records]);
  useFrame(()=>{if(lastTime.current===clock.current)return;lastTime.current=clock.current;write(clock.current);});
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <instancedMesh ref={mesh} args={args} dispose={null} frustumCulled={false} receiveShadow castShadow raycast={noHit}/>;
}

export function IcefieldTable({theme,quality,reduceMotion}:{readonly theme:TableTheme;readonly quality:QualityLevel;readonly reduceMotion:boolean}){
  const clock=useRef(0),time=useMemo(()=>({value:0}),[]);
  const materials=useMemo(()=>{
    const ice=createIceMaterial({registerShadowCasterWithPatch:(material,patch)=>{
      material.onBeforeCompile=patch;material.customProgramCacheKey=()=> 'icefield-map-crystals-v1';
    }});
    const u=ice.userData.uniforms;
    u.uTime=time;u.uColorDeep.value.set('#285c7b');u.uColorIce.value.set('#78b5d0');u.uColorRim.value.set('#badce7');u.uColorCore.value.set('#71b6d0');
    u.uGlow.value=.18;u.uEdgeGlow.value=.28;u.uSparkle.value=.12;u.uBirthGlow.value=.34;
    u.uFracture.value=.34;u.uVeins.value=.35;u.uDensity.value=1.02;u.uTranslucency.value=.7;
    ice.opacity=.91;ice.roughness=.24;ice.envMapIntensity=.3;
    const frost=createFrostFieldMaterial();frost.userData.sync({radius:10,quadSize:12.6,freeze:1,fade:1,seed:31});
    frost.blending=NormalBlending;frost.uniforms['uTime']=time;frost.uniforms['uGlobalGlow']={value:.38};
    frost.uniforms['uColorField']!.value.set('#5e9eb8');frost.uniforms['uColorEdge']!.value.set('#c0dce6');
    for(const [key,value] of Object.entries({uFill:.22,uSeam:.32,uPlates:.65,uPlateScale:1.05,uFingers:.12,uBoundaryGlow:0,uCore:0,uRings:0,uSweep:.02,uPulse:.025,uOpacity:.42}))frost.uniforms[key]!.value=value;
    const veil=createFrostVeilMaterial();veil.userData.sync({fade:1,seed:17});
    veil.uniforms['uTime']=time;veil.uniforms['uGlobalGlow']={value:.4};veil.uniforms['uOpacity']!.value=.13;
    veil.uniforms['uColorVeil']!.value.set('#6597b2');veil.uniforms['uColorCrest']!.value.set('#c5e0eb');
    // The map has no skill depth prepass; standard depth testing clips the cold veil against solid geometry.
    veil.fragmentShader=veil.fragmentShader.replace('alpha *= softFade(uSceneDepth, screenUV, vViewZ, uCameraNear, uCameraFar, uSoftFade);','alpha *= 1.0;');
    return {ice,frost,veil,
      deck:buildMaterial(theme.mat.light,{quality}),
      body:buildMaterial({kind:'glass',color:0x4c8ca9,roughness:.35,transmission:.12,thickness:.5,clearcoat:.2,envMapIntensity:.4},{quality}),
      snow:buildMaterial({kind:'stone',color:0xccdde4,roughness:.96,envMapIntensity:.3},{quality}),
      ground:buildMaterial({kind:'stone',color:0xa3bfcc,roughness:.88,envMapIntensity:.3},{quality}),
    };
  },[theme,quality,time]);
  const geometry=useMemo(()=>{
    const terrain=new PlaneGeometry(70,70,quality==='low'?36:quality==='medium'?64:90);terrain.rotateX(-Math.PI/2);
    const positions=terrain.getAttribute('position');for(let i=0;i<positions.count;i++)positions.setY(i,snowHeight(positions.getX(i),positions.getZ(i)));
    positions.needsUpdate=true;terrain.computeVertexNormals();
    const frost=new ShapeGeometry(shape());frost.rotateX(-Math.PI/2);planarUV(frost);
    return {terrain,deck:plate(1,.3,-.012),body:plate(1.015,1.36,-.30),frost,veil:new PlaneGeometry(1,1),snow:new IcosahedronGeometry(1,1)};
  },[quality]);
  const records=useMemo(()=>crystals(quality),[quality]);
  const variants=useMemo(()=>[0,1,2].map(variant=>records.filter((_,i)=>i%3===variant)),[records]);
  useEffect(()=>()=>{Object.values(materials).forEach(material=>material.dispose());},[materials]);
  useEffect(()=>()=>{Object.values(geometry).forEach(item=>item.dispose());},[geometry]);
  useFrame((_,delta)=>{if(!reduceMotion)clock.current+=Math.min(delta,.05)/ANIMATION_DURATION_SCALE;time.value=clock.current;});
  return <group position={[0,0,LAYOUT.tableCenterZ]}>
    <mesh geometry={geometry.terrain} material={materials.ground} dispose={null} receiveShadow raycast={noHit}/>
    <mesh geometry={geometry.body} material={materials.body} dispose={null} receiveShadow castShadow raycast={noHit}/>
    <mesh geometry={geometry.deck} material={materials.deck} dispose={null} receiveShadow castShadow raycast={noHit}/>
    <mesh geometry={geometry.frost} material={materials.frost} dispose={null} position={[0,.002,0]} raycast={noHit}/>
    {variants.map((group,i)=><CrystalBatch key={i} variant={i} records={group} material={materials.ice} clock={clock}/>)}
    {[-1,1].flatMap(side=>[-4.4,-2.2,0,2.2,4.4].map((z,i)=><mesh key={`${side}-${i}`} geometry={geometry.snow} material={materials.snow} dispose={null}
      position={[side*5.94,-.005,z]} scale={[.22+.09*(i%2),.13,.43]} receiveShadow raycast={noHit}/>))}
    {[-1,1].map(side=><mesh key={side} geometry={geometry.veil} material={materials.veil} dispose={null} position={[side*7.4,-1.3,-1.7]} scale={[4.8,1.2,1]} raycast={noHit}/>)}
    <group scale={[1.35,1,1.35]}><WeatherLayer themeId="snow" quality={quality} reducedMotion={reduceMotion}/></group>
    <group scale={[3.5,1.6,3.5]}><WeatherLayer themeId="snow" quality={quality} reducedMotion={reduceMotion}/></group>
  </group>;
}
