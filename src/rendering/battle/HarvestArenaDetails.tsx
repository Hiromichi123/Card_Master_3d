import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferGeometry, CatmullRomCurve3, Color, ExtrudeGeometry, Float32BufferAttribute,
  IcosahedronGeometry, Matrix4, Path, Shape, Vector3,
  type InstancedMesh, type Material, type MeshStandardMaterial,
} from 'three';
import { buildMaterial, type QualityLevel } from '../table/materials';
import { BATTLE_CARD_SCALE, CARD_SIZE, LAYOUT, PREP_CARD_SCALE, buildSlots } from './layout';

type Vec2=readonly [number,number];
type Vec3=readonly [number,number,number];
interface Piece {readonly position:Vec3;readonly scale?:Vec3;readonly yaw?:number;readonly color?:number}
const noHit=():void=>{};
function randomAt(i:number,j=0):number{const n=Math.sin(i*127.1+j*311.7+59.2)*43758.5453;return n-Math.floor(n);}
function polygon(points:readonly Vec2[]):Shape{
  const shape=new Shape();points.forEach(([x,z],i)=>{if(i===0)shape.moveTo(x,z);else shape.lineTo(x,z);});shape.closePath();return shape;
}
function addHole(shape:Shape,points:readonly Vec2[]):void{
  const hole=new Path();[...points].reverse().forEach(([x,z],i)=>{if(i===0)hole.moveTo(x,z);else hole.lineTo(x,z);});hole.closePath();shape.holes.push(hole);
}
function clipped(width:number,depth:number,cut:number):Shape{
  const x=width/2,z=depth/2;
  return polygon([[-x+cut,-z],[x-cut,-z],[x,-z+cut],[x,z-cut],[x-cut,z],[-x+cut,z],[-x,z-cut],[-x,-z+cut]]);
}
function solid(shape:Shape|Shape[],depth:number,top:number,bevel:number):ExtrudeGeometry{
  const geometry=new ExtrudeGeometry(shape,{depth,bevelEnabled:bevel>0,bevelSize:bevel,bevelThickness:bevel,bevelSegments:2,curveSegments:1});
  geometry.rotateX(-Math.PI/2);geometry.translate(0,top-depth-bevel,0);planarUV(geometry);return geometry;
}
function planarUV(geometry:BufferGeometry):void{
  const positions=geometry.getAttribute('position'),uv:number[]=[];
  for(let i=0;i<positions.count;i++)uv.push(positions.getX(i)/13+.5,positions.getZ(i)/13+.5);
  geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));
}
const CANYON=new CatmullRomCurve3([
  new Vector3(-5.6,-.018,0),new Vector3(-4.7,-.48,.025),new Vector3(-3.2,-.71,-.035),
  new Vector3(-1.5,-.75,.028),new Vector3(0,-.72,-.025),new Vector3(1.6,-.75,.024),
  new Vector3(3.3,-.70,-.025),new Vector3(4.7,-.47,.025),new Vector3(5.6,-.018,0),
],false,'centripetal');
// Each canyon mouth goes around a different flank to the opposite player's edge centre.
const FLANKS=[new CatmullRomCurve3([
  new Vector3(-5.6,-.012,0),new Vector3(-5.72,-.009,-1.6),new Vector3(-5.7,-.009,-3.65),
  new Vector3(-5.0,-.009,-5.1),new Vector3(-3.4,-.009,-5.55),new Vector3(-1.65,.018,-5.84),new Vector3(0,.052,-6.45),
],false,'centripetal'),new CatmullRomCurve3([
  new Vector3(5.6,-.012,0),new Vector3(5.72,-.009,1.6),new Vector3(5.7,-.009,3.65),
  new Vector3(5.0,-.009,5.1),new Vector3(3.4,-.009,5.55),new Vector3(1.65,.018,5.84),new Vector3(0,.052,6.45),
],false,'centripetal')];

function edges(curve:CatmullRomCurve3,width:number,steps:number):{left:Vector3[];right:Vector3[]}{
  const left:Vector3[]=[],right:Vector3[]=[];
  for(let i=0;i<=steps;i++){
    const t=i/steps,p=curve.getPoint(t),tangent=curve.getTangent(t),normal=new Vector3(-tangent.z,0,tangent.x).normalize();
    left.push(p.clone().addScaledVector(normal,width/2));right.push(p.clone().addScaledVector(normal,-width/2));
  }
  return {left,right};
}
function canyonOutline():Vec2[]{
  const edge=edges(CANYON,.91,72);
  return [...edge.right.map(p=>[p.x,p.z] as const),...edge.left.reverse().map(p=>[p.x,p.z] as const)];
}
export function harvestDeckShape(outline:readonly Vec2[]):Shape{
  const shape=polygon(outline);
  // One connected excavation, so branch mouths do not form overlapping holes.
  addHole(shape,[[-4.88,-3.13],[4.88,-3.13],[5.1,-2.91],[5.1,-.48],[5.84,-.48],
    [5.84,.48],[5.1,.48],[5.1,2.91],[4.88,3.13],[-4.88,3.13],[-5.1,2.91],[-5.1,.48],
    [-5.84,.48],[-5.84,-.48],[-5.1,-.48],[-5.1,-2.91]]);
  return shape;
}
export function harvestSupportShape(outline:readonly Vec2[]):Shape{
  const shape=polygon(outline);addHole(shape,canyonOutline());return shape;
}

function strip(curve:CatmullRomCurve3,width:number,steps:number):BufferGeometry{
  const edge=edges(curve,width,steps),vertices:number[]=[];
  for(let i=0;i<steps;i++)for(const p of [edge.right[i]!,edge.left[i+1]!,edge.right[i+1]!,edge.right[i]!,edge.left[i]!,edge.left[i+1]!])vertices.push(p.x,p.y,p.z);
  const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(vertices,3));
  geometry.computeVertexNormals();planarUV(geometry);return geometry;
}
function cliffs():BufferGeometry{
  const edge=edges(CANYON,.91,72),vertices:number[]=[];
  for(const side of [-1,1])for(let i=0;i<72;i++){
    const a=(side>0?edge.left:edge.right)[i]!,b=(side>0?edge.left:edge.right)[i+1]!;
    const pa=CANYON.getPoint(i/72),pb=CANYON.getPoint((i+1)/72);
    const lowerA=pa.clone().lerp(a,.57),lowerB=pb.clone().lerp(b,.57);
    lowerA.y-=.09;lowerB.y-=.09;
    const topA=a.clone(),topB=b.clone();topA.y=Math.max(-.33,a.y+.012);topB.y=Math.max(-.33,b.y+.012);
    const triangles=side>0?[topA,topB,lowerB,topA,lowerB,lowerA]:[lowerA,lowerB,topB,lowerA,topB,topA];
    triangles.forEach(p=>vertices.push(p.x,p.y,p.z));
  }
  const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(vertices,3));
  geometry.computeVertexNormals();planarUV(geometry);return geometry;
}
const ROAD_POINTS=[CANYON,...FLANKS].map(curve=>curve.getPoints(90));
export function nearHarvestRoad(x:number,z:number,margin=.24):boolean{
  return ROAD_POINTS.some((points,road)=>points.some(p=>Math.hypot(x-p.x,z-p.z)<margin+(road===0?.48:.27)));
}

function Batch({geometry,material,pieces,shadow=false}:{readonly geometry:BufferGeometry;readonly material:Material;readonly pieces:readonly Piece[];readonly shadow?:boolean}){
  const mesh=useRef<InstancedMesh>(null);
  const args=useMemo<[BufferGeometry,Material,number]>(()=>[geometry,material,pieces.length],[geometry,material,pieces.length]);
  useLayoutEffect(()=>{
    if(!mesh.current)return;const matrix=new Matrix4(),scale=new Vector3(),color=new Color();
    pieces.forEach((piece,i)=>{
      const size:Vec3=piece.scale??[1,1,1];matrix.makeRotationY(piece.yaw??0);matrix.scale(scale.set(...size));matrix.setPosition(...piece.position);
      mesh.current!.setMatrixAt(i,matrix);if(piece.color!==undefined)mesh.current!.setColorAt(i,color.setHex(piece.color));
    });
    mesh.current.instanceMatrix.needsUpdate=true;if(mesh.current.instanceColor)mesh.current.instanceColor.needsUpdate=true;mesh.current.computeBoundingSphere();
    if(mesh.current.boundingSphere)mesh.current.boundingSphere.radius+=.3;
  },[args,pieces]);
  return <instancedMesh ref={mesh} args={args} dispose={null} castShadow={shadow} receiveShadow raycast={noHit}/>;
}

function flowerGeometry():BufferGeometry{
  const positions:number[]=[],colors:number[]=[],color=new Color();
  const triangle=(a:Vec3,b:Vec3,c:Vec3,hex:number)=>{color.setHex(hex);for(const p of [a,b,c]){positions.push(...p);colors.push(color.r,color.g,color.b);}};
  for(let stem=0;stem<3;stem++){
    const x=(stem-1)*.18,z=Math.sin(stem*2.4)*.16,h=.84+stem*.12;
    triangle([x-.017,0,z],[x+.017,0,z],[x+.017,h,z],0x66804b);
    triangle([x-.017,0,z],[x+.017,h,z],[x-.017,h,z],0x799154);
    triangle([x,h*.4,z],[x+.3,h*.6,z+.08],[x+.04,h*.58,z],0x7d984f);
    triangle([x,h*.62,z],[x-.25,h*.72,z-.08],[x-.03,h*.77,z],0x91a965);
    const petal=[0xe7c77c,0xf0e7cb,0xc7b3d1][stem]!;
    for(let p=0;p<6;p++){
      const angle=p*Math.PI/3,centre:Vec3=[x,h,z],a:Vec3=[x+Math.cos(angle-.22)*.24,h+.035,z+Math.sin(angle-.22)*.24];
      const tip:Vec3=[x+Math.cos(angle)*.3,h-.014,z+Math.sin(angle)*.3],b:Vec3=[x+Math.cos(angle+.22)*.24,h+.035,z+Math.sin(angle+.22)*.24];
      triangle(centre,b,a,petal);triangle(a,b,tip,petal);
      const a2:Vec3=[x+Math.cos(angle)*.065,h+.04,z+Math.sin(angle)*.065],b2:Vec3=[x+Math.cos(angle+Math.PI/3)*.065,h+.04,z+Math.sin(angle+Math.PI/3)*.065];
      triangle([x,h+.045,z],b2,a2,0xb48d3e);
    }
  }
  const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new Float32BufferAttribute(colors,3));geometry.computeVertexNormals();return geometry;
}

function decoration(quality:QualityLevel):{rocks:Piece[];flowers:Piece[]}{
  const rocks:Piece[]=[],flowers:Piece[]=[],allSlots=buildSlots(),slots=allSlots.filter(slot=>slot.zone==='battle');
  const safe=(x:number,z:number,margin:number)=>!allSlots.some(slot=>{
    const scale=slot.zone==='battle'?BATTLE_CARD_SCALE:PREP_CARD_SCALE;
    return Math.abs(x-slot.position[0])<CARD_SIZE.width*.5*scale+margin && Math.abs(z-(slot.position[2]-LAYOUT.tableCenterZ))<CARD_SIZE.height*.5*scale+margin;
  }) && !(Math.abs(Math.abs(x)-4.72)<.62 && Math.abs(Math.abs(z)-4)<.8)
    && !(Math.abs(z)>5.45 && Math.abs(x)<5.05);
  for(let road=0;road<3;road++){
    const curve=road===0?CANYON:FLANKS[road-1]!,count=road===0?82:quality==='high'?60:quality==='medium'?42:24;
    for(let i=0;i<count;i++){
      const t=(i+.5)/count,p=curve.getPoint(t),tangent=curve.getTangent(t),normal=new Vector3(-tangent.z,0,tangent.x).normalize();
      const side=i%2===0?1:-1,bank=road===0?.53:.36;
      const x=p.x+normal.x*side*(bank+randomAt(i,road)*.075),z=p.z+normal.z*side*(bank+randomAt(i,road)*.075);
      const y=road===0?Math.max(-.34,p.y+.018):p.y;
      const size=.07+randomAt(i,road+11)*.10;
      rocks.push({position:[x,y+size*.27,z],scale:[size,size*.65,size*(.8+randomAt(i,17)*.55)],yaw:randomAt(i,29)*6.28});
      const distance=road===0?.48:.49,fx=p.x+normal.x*side*distance,fz=p.z+normal.z*side*distance;
      if(i%2===0 && safe(fx,fz,.08)){
        const spread=road===0?.13:.23;
        flowers.push({position:[fx,y+.006,fz],scale:[spread,.19+randomAt(i,37)*.13,spread],yaw:randomAt(i,43)*6.28,color:[0xfff6e3,0xe9e0cb,0xf5edda][i%3]!});
      }
    }
  }
  // Small flowers on the low courtyard between neighbouring raised plinths.
  for(const slot of slots){
    const x=slot.position[0]+LAYOUT.battleSpacing*.5,z=slot.position[2]-LAYOUT.tableCenterZ;
    if(x>4.1)continue;
    flowers.push({position:[x,-.318,z+(slot.side==='player'?.3:-.3)],scale:[.085,.2,.085],yaw:randomAt(slot.index,51)*6.28,color:0xf6edda});
  }
  return {rocks,flowers};
}

export function HarvestArenaDetails({quality,plantMaterial}:{readonly quality:QualityLevel;readonly plantMaterial:MeshStandardMaterial}){
  const materials=useMemo(()=>({
    base:buildMaterial({kind:'stone',color:0x6d6b52,roughness:.87,envMapIntensity:.3},{quality}),
    platform:buildMaterial({kind:'stone',color:0x9b9879,roughness:.79,envMapIntensity:.38},{quality}),
    bed:buildMaterial({kind:'stone',color:0x51533e,roughness:.94,envMapIntensity:.27},{quality}),
    road:buildMaterial({kind:'stone',color:0xa79b76,roughness:.97,envMapIntensity:.3},{quality}),
    cliff:buildMaterial({kind:'stone',color:0x696650,roughness:.92,envMapIntensity:.26},{quality}),
    rocks:buildMaterial({kind:'stone',color:0x858267,roughness:.95,envMapIntensity:.3},{quality}),
  }),[quality]);
  const geometry=useMemo(()=>{
    // Separate north/south terraces: the canyon exits the courtyard, never an out-of-bounds hole.
    const edge=edges(CANYON,.91,120);
    const north=edge.left.filter(p=>p.x> -5.11 && p.x<5.11),south=edge.right.filter(p=>p.x> -5.11 && p.x<5.11);
    const beds=[polygon([[-5.11,north[0]!.z],...north.map(p=>[p.x,p.z] as const),[5.11,north[north.length-1]!.z],
      [5.11,2.91],[4.89,3.13],[-4.89,3.13],[-5.11,2.91]]),
      polygon([[-5.11,-2.91],[-4.89,-3.13],[4.89,-3.13],[5.11,-2.91],[5.11,south[south.length-1]!.z],
        ...[...south].reverse().map(p=>[p.x,p.z] as const),[-5.11,south[0]!.z]])];
    return {base:solid(clipped(1.77,2.51,.14),.23,-.105,.022),platform:solid(clipped(1.63,2.38,.1),.105,-.012,.018),
      bed:solid(beds,.12,-.33,.018),road:strip(CANYON,.48,90),left:strip(FLANKS[0]!, .53,90),right:strip(FLANKS[1]!, .53,90),
      floor:strip(CANYON,.86,90),cliff:cliffs(),rock:new IcosahedronGeometry(1,0),flowers:flowerGeometry()};
  },[]);
  const slots=useMemo<Piece[]>(()=>buildSlots().filter(slot=>slot.zone==='battle').map(slot=>({position:[slot.position[0],0,slot.position[2]-LAYOUT.tableCenterZ]})),[]);
  const plants=useMemo(()=>decoration(quality),[quality]);
  useEffect(()=>()=>{Object.values(materials).forEach(material=>material.dispose());},[materials]);
  useEffect(()=>()=>{Object.values(geometry).forEach(item=>item.dispose());},[geometry]);
  return <>
    <mesh geometry={geometry.bed} material={materials.bed} dispose={null} receiveShadow raycast={noHit}/>
    <mesh geometry={geometry.floor} material={materials.cliff} dispose={null} position={[0,-.11,0]} receiveShadow raycast={noHit}/>
    <mesh geometry={geometry.cliff} material={materials.cliff} dispose={null} receiveShadow raycast={noHit}/>
    {[geometry.road,geometry.left,geometry.right].map((road,i)=><mesh key={i} geometry={road} material={materials.road} dispose={null} receiveShadow raycast={noHit}/>)}
    <Batch geometry={geometry.base} material={materials.base} pieces={slots} shadow/>
    <Batch geometry={geometry.platform} material={materials.platform} pieces={slots} shadow/>
    <Batch geometry={geometry.rock} material={materials.rocks} pieces={plants.rocks}/>
    <Batch geometry={geometry.flowers} material={plantMaterial} pieces={plants.flowers}/>
  </>;
}
