import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferGeometry, Color, DoubleSide, ExtrudeGeometry, Float32BufferAttribute,
  Matrix4, MeshStandardMaterial, Path, PlaneGeometry, Shape, ShapeGeometry, Vector3,
  type InstancedMesh, type Mesh, type ShaderMaterial,
} from 'three';
import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { buildMaterial, type QualityLevel } from '../table/materials';
import type { TableTheme } from '../table/themes';
import { WeatherLayer } from '../table/weather';
import { HarvestArenaDetails, harvestDeckShape, harvestSupportShape, nearHarvestRoad } from './HarvestArenaDetails';
import { BATTLE_CARD_SCALE, CARD_SIZE, LAYOUT, PILE_CARD_SCALE, PREP_CARD_SCALE, buildSlots } from './layout';

type Vec2=readonly [number,number];
interface Plant { readonly x:number;readonly y:number;readonly z:number;readonly size:number;readonly yaw:number;readonly tint:number }
type Clock=Readonly<{current:number}>;
const HALF=6.6,CUT=1.7,FIELD_RADIUS=32;
const noHit=():void=>{};
function randomAt(a:number,b=0):number {const n=Math.sin(a*127.1+b*311.7+37.2)*43758.5453;return n-Math.floor(n);}
function octagon(half:number,cut:number):Vec2[]{return [[-half+cut,-half],[half-cut,-half],[half,-half+cut],[half,half-cut],[half-cut,half],[-half+cut,half],[-half,half-cut],[-half,-half+cut]];}
function polygon(points:readonly Vec2[]):Shape {const shape=new Shape();points.forEach(([x,y],i)=>{if(i===0)shape.moveTo(x,y);else shape.lineTo(x,y);});shape.closePath();return shape;}
function ring(outer:number,inner:number,cut:number):Shape {
  const shape=polygon(octagon(outer,cut));const hole=new Path();
  [...octagon(inner,Math.max(.15,cut-(outer-inner)*.58))].reverse().forEach(([x,y],i)=>{if(i===0)hole.moveTo(x,y);else hole.lineTo(x,y);});
  hole.closePath();shape.holes.push(hole);return shape;
}
function solid(shape:Shape,depth:number,top:number,bevel:number):ExtrudeGeometry {
  const geometry=new ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:2,curveSegments:1});
  geometry.rotateX(-Math.PI/2);geometry.translate(0,top-depth-bevel,0);
  const p=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  for(let i=0;i<p.count;i++)uv.setXY(i,p.getX(i)/(HALF*2)+.5,p.getZ(i)/(HALF*2)+.5);
  uv.needsUpdate=true;return geometry;
}
function groundHeight(x:number,z:number):number {
  const distance=Math.hypot(x,z),hills=Math.min(1,Math.max(0,(distance-9)/13));
  return -1.55+Math.sin(x*.19)*Math.cos(z*.17)*(.16+hills*.86)+Math.sin(z*.09+x*.11)*hills*.55;
}

/** Three crossed, tapered stalks with leaves, lozenge-shaped grain and short awns. */
function wheatGeometry():BufferGeometry {
  const vertices:number[]=[],colors:number[]=[],color=new Color();
  const quad=(corners:readonly (readonly [number,number,number])[],hex:number)=>{
    color.setHex(hex);
    for(const i of [0,1,2,0,2,3]){vertices.push(...corners[i]!);colors.push(color.r,color.g,color.b);}
  };
  for(let stalk=0;stalk<3;stalk++) {
    const height=1.12+stalk*.18,yaw=stalk*2.399,ox=Math.cos(yaw)*.12,oz=Math.sin(yaw)*.12;
    const point=(x:number,y:number,z=0):readonly [number,number,number]=>[ox+x*Math.cos(yaw)-z*Math.sin(yaw),y,oz+x*Math.sin(yaw)+z*Math.cos(yaw)];
    for(let segment=0;segment<5;segment++){
      const y0=height*.8*segment/5,y1=height*.8*(segment+1)/5,w0=.027*(1-segment*.1),w1=.027*(1-(segment+1)*.1);
      quad([point(-w0,y0),point(w0,y0),point(w1,y1),point(-w1,y1)],0xa6a064);
      quad([point(0,y0,-w0),point(0,y0,w0),point(0,y1,w1),point(0,y1,-w1)],0x98965e);
    }
    for(const side of [-1,1]){
      const base=height*(side>0?.36:.53);
      quad([point(0,base),point(side*.23,base+.13),point(side*.31,base+.33),point(side*.045,base+.26)],side>0?0x8a9c55:0xa8ac69);
    }
    for(let grain=0;grain<5;grain++)for(const side of [-1,1]){
      const y=height*.77+grain*.052,x=side*(.052-grain*.004),w=.055-grain*.005;
      quad([point(0,y-.035),point(x,y-.012),point(x+side*w,y+.045),point(0,y+.048)],grain%2?0xd7b15f:0xe2c47d);
      // Tiny tapering awns catch the light without billboard sprites.
      quad([point(x,y+.023),point(x+side*.008,y+.023),point(x+side*.04,y+.13),point(x+side*.038,y+.13)],0xe6cf8e);
    }
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();return geometry;
}

function wheatMaterial(time:{value:number}):MeshStandardMaterial {
  const material=new MeshStandardMaterial({vertexColors:true,side:DoubleSide,roughness:.9,metalness:0});
  material.onBeforeCompile=shader=>{
    shader.uniforms['harvestTime']=time;
    shader.vertexShader='uniform float harvestTime;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 root=(modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).xz;
        float wave=sin(root.x*0.19+root.y*0.16-harvestTime*1.05);
        float gust=wave+0.42*sin(root.y*0.44-root.x*0.12-harvestTime*1.63);
        float weight=pow(clamp(position.y/1.48,0.0,1.0),2.0);
        transformed.x+=gust*0.16*weight;
        transformed.z+=cos(root.x*0.23+root.y*0.18-harvestTime*0.85)*0.085*weight;
      #endif
    `);
  };
  material.customProgramCacheKey=()=> 'harvest-stalk-wind-v1';return material;
}

function WheatBatch({geometry,material,plants}:{readonly geometry:BufferGeometry;readonly material:MeshStandardMaterial;readonly plants:readonly Plant[]}) {
  const mesh=useRef<InstancedMesh>(null);
  const args=useMemo<[BufferGeometry,MeshStandardMaterial,number]>(()=>[geometry,material,plants.length],[geometry,material,plants.length]);
  useLayoutEffect(()=>{
    if(!mesh.current)return;const matrix=new Matrix4(),color=new Color(),scale=new Vector3();
    plants.forEach((plant,i)=>{
      matrix.makeRotationY(plant.yaw);matrix.scale(scale.setScalar(plant.size));matrix.setPosition(plant.x,plant.y,plant.z);
      mesh.current!.setMatrixAt(i,matrix);mesh.current!.setColorAt(i,color.setHex(plant.tint));
    });
    mesh.current.instanceMatrix.needsUpdate=true;if(mesh.current.instanceColor)mesh.current.instanceColor.needsUpdate=true;
    mesh.current.computeBoundingSphere();
    // Wind displaces geometry outside the static instance bound by a small margin.
    if(mesh.current.boundingSphere)mesh.current.boundingSphere.radius+=.35;
  },[args,plants]);
  return <instancedMesh ref={mesh} args={args} dispose={null} receiveShadow raycast={noHit}/>;
}

function buildPlants(quality:QualityLevel):{field:Plant[];border:Plant[]} {
  const field:Plant[]=[],border:Plant[]=[],slots=buildSlots();
  const count=quality==='high'?5200:quality==='medium'?3000:1200;
  for(let i=0;field.length<count && i<count*4;i++){
    const x=(randomAt(i,3)-.5)*FIELD_RADIUS*2,z=(randomAt(i,7)-.5)*FIELD_RADIUS*2;
    if(Math.hypot(x,z)>FIELD_RADIUS-.7 || (Math.abs(x)<7.7 && Math.abs(z)<7.7 && Math.abs(x)+Math.abs(z)<13.6))continue;
    const size=.65+randomAt(i,13)*.45;
    field.push({x,z,y:groundHeight(x,z),size,yaw:randomAt(i,17)*Math.PI*2,tint:[0xe7d2a2,0xffefc1,0xdbbc81,0xd1c091][i%4]!});
  }
  const wanted=quality==='high'?190:quality==='medium'?120:65;
  for(let i=0;border.length<wanted && i<2200;i++) {
    const x=(randomAt(i,31)-.5)*12.1,z=(randomAt(i,37)-.5)*12.1;
    if(Math.abs(x)+Math.abs(z)>10.8 || (Math.abs(x)<4.7 && Math.abs(z)<3.2))continue;
    if(Math.abs(z)>5.5 && Math.abs(x)<5.1)continue;
    if(nearHarvestRoad(x,z,.24))continue;
    if(slots.some(slot=>{
      const scale=slot.zone==='battle'?BATTLE_CARD_SCALE:PREP_CARD_SCALE;
      return Math.abs(x-slot.position[0])<CARD_SIZE.width*scale*.5+.28 && Math.abs(z-(slot.position[2]-LAYOUT.tableCenterZ))<CARD_SIZE.height*scale*.5+.28;
    }))continue;
    if(Math.abs(Math.abs(x)-4.72)<CARD_SIZE.width*PILE_CARD_SCALE*.5+.36 && Math.abs(Math.abs(z)-4)<CARD_SIZE.height*PILE_CARD_SCALE*.5+.36)continue;
    border.push({x,z,y:-.014,size:.15+randomAt(i,41)*.13,yaw:randomAt(i,43)*Math.PI*2,tint:[0x96b26f,0xb6bd85,0xb9ba76][i%3]!});
  }
  return {field,border};
}

function SunHaze({clock}:{readonly clock:Clock}) {
  const mesh=useRef<Mesh>(null),material=useRef<ShaderMaterial>(null);
  const uniforms=useMemo(()=>({uTime:{value:0}}),[]);
  useFrame(({camera})=>{mesh.current?.quaternion.copy(camera.quaternion);if(material.current)material.current.uniforms['uTime']!.value=clock.current;});
  return <mesh ref={mesh} position={[-18,13,-37]} raycast={noHit}>
    <planeGeometry args={[12,12]}/>
    <shaderMaterial ref={material} uniforms={uniforms} transparent depthWrite={false} toneMapped={false}
      vertexShader="varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}"
      fragmentShader={`
        uniform float uTime;varying vec2 vUv;
        void main(){
          float r=length(vUv-0.5);
          float a=exp(-r*r*32.0)*0.28*(0.96+sin(uTime*0.3)*0.04);
          gl_FragColor=vec4(vec3(1.0,0.88,0.59),a);
          #include <colorspace_fragment>
        }
      `}/>
  </mesh>;
}

/** Continuous octagonal stone arena, planted low at the rim and surrounded by waving wheat. */
export function HarvestTable({theme,quality,reduceMotion}:{readonly theme:TableTheme;readonly quality:QualityLevel;readonly reduceMotion:boolean}) {
  const clock=useRef(0),time=useMemo(()=>({value:0}),[]);
  const materials=useMemo(()=>({
    deck:buildMaterial(theme.mat.dark,{quality}),frame:buildMaterial(theme.mat.frame,{quality}),
    support:buildMaterial({kind:'stone',color:0x4b4939,roughness:.94},{quality}),
    ground:buildMaterial({kind:'stone',color:0x777854,roughness:1,envMapIntensity:.24},{quality}),
    inlay:buildMaterial({kind:'plain',color:theme.mat.inlay,emissive:theme.mat.inlay,emissiveIntensity:.12,roughness:.45,metalness:.25},{quality}),
    wheat:wheatMaterial(time),
  }),[theme,quality,time]);
  const geometry=useMemo(()=>{
    const terrain=new PlaneGeometry(FIELD_RADIUS*2.2,FIELD_RADIUS*2.2,quality==='low'?36:quality==='medium'?64:96);
    terrain.rotateX(-Math.PI/2);const positions=terrain.getAttribute('position');
    for(let i=0;i<positions.count;i++)positions.setY(i,groundHeight(positions.getX(i),positions.getZ(i)));
    positions.needsUpdate=true;terrain.computeVertexNormals();
    return {
      deck:solid(harvestDeckShape(octagon(HALF-.53,CUT-.31)),.40,-.016,.022),
      frame:solid(ring(HALF,HALF-.48,CUT),.4,.033,.04),
      support:solid(harvestSupportShape(octagon(HALF+.09,CUT)),.93,-.45,.04),
      inlay:new ShapeGeometry(ring(HALF-.45,HALF-.50,CUT-.27)),
      terrain,wheat:wheatGeometry(),
    };
  },[quality]);
  const plants=useMemo(()=>buildPlants(quality),[quality]);
  useEffect(()=>()=>{Object.values(materials).forEach(material=>material.dispose());},[materials]);
  useEffect(()=>()=>{Object.values(geometry).forEach(item=>item.dispose());},[geometry]);
  useFrame((_,delta)=>{if(!reduceMotion)clock.current+=Math.min(delta,.05)/ANIMATION_DURATION_SCALE;time.value=clock.current;});
  return <group position={[0,0,LAYOUT.tableCenterZ]}>
    <mesh geometry={geometry.terrain} material={materials.ground} dispose={null} receiveShadow raycast={noHit}/>
    <WheatBatch geometry={geometry.wheat} material={materials.wheat} plants={plants.field}/>
    <mesh geometry={geometry.support} material={materials.support} dispose={null} receiveShadow castShadow raycast={noHit}/>
    <mesh geometry={geometry.deck} material={materials.deck} dispose={null} receiveShadow castShadow raycast={noHit}/>
    <mesh geometry={geometry.frame} material={materials.frame} dispose={null} receiveShadow castShadow raycast={noHit}/>
    <mesh geometry={geometry.inlay} material={materials.inlay} dispose={null} rotation={[-Math.PI/2,0,0]} position={[0,.009,0]} raycast={noHit}/>
    <HarvestArenaDetails quality={quality} plantMaterial={materials.wheat}/>
    <WheatBatch geometry={geometry.wheat} material={materials.wheat} plants={plants.border}/>
    <SunHaze clock={clock}/>
    <WeatherLayer themeId="wasteland" quality={quality} reducedMotion={reduceMotion}/>
  </group>;
}
