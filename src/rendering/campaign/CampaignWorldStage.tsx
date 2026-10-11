import { useEffect, useLayoutEffect, useMemo, useRef,useState,type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, CircleGeometry, Color, ConeGeometry,
  CylinderGeometry, DoubleSide, Float32BufferAttribute, IcosahedronGeometry, InstancedBufferAttribute,
  Matrix4, MeshStandardMaterial, PlaneGeometry, Quaternion, TorusGeometry,
  TubeGeometry, Vector3,
  type DirectionalLight, type InstancedMesh, type Material,
} from 'three';
import { useSettingsStore } from '../../state/settingsStore';
import { WebGLGuard } from '../../scenes/WebGLGuard';
import type { QualityProfile } from '../quality';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import type { ChapterInfo, StageInfo } from '../../scenes/campaignFlow';
import { cloudMaterial, flowMaterial, grassMaterial, groundMaterial, sparkMaterial } from './worldMaterials';
import {
  buildGrassGeometry, buildPath, buildVolcano, mainlandLandmark, rand,
  WORLD_EXPANSION, WORLD_RADIUS, WORLD_SCALE, type CloudInstance, type Vec3,
} from './worldGeometry';

import { WORLD_CAMERA_FAR, WorldNavigator, type WorldViewRequest } from './WorldNavigator';
import { MoonArchipelago } from './MoonArchipelago';
import { CentralWorldTree } from './CentralWorldTree';
import { DemonLandmarks } from './DemonLandmarks';
import { CENTRAL_WORLD_TOP,mainlandOriginal,mainlandPoint,type Mainland } from './worldPlacement';
import { WorldScatter as Scatter } from './WorldScatter';
import { WorldMarkers } from './WorldMarkers';
import { WorldLandmarkDetails } from './WorldLandmarkDetails';
import { AncientSeaFortress } from './AncientSeaFortress';
import { CoastalTownWalls } from './CoastalTownWalls';
import { FORTRESS_ANCHOR, TOWN_ANCHOR, TOWN_RADIUS } from './worldLayout';
import { createCrystalGeometry } from '../effects/vendor/linear-native/assets/ProceduralGeometry.js';
import { useWorldBuild } from './useWorldBuild';
import { buildWorldPreview } from './worldPreview';
import { pauseWorldLoading,scheduleWorldTask } from './worldLoadScheduler';

export const CHAPTER_LANDSCAPES = [
  '西方人界大岛 · 临海要塞与白墙城镇 · 森林冰原与火山',
  '东方魔域大岛 · 高祭塔与环崖神庙 · 紫色深渊与南岛门扉',
  '北方圣域小岛 · 山口科技大门 · 云雾中的圣山',
  '高空主岛与五座卫星空岛 · 云带中的月之都',
  '南端群岛 · 古海 · 暂未实现',
  '中央破碎大陆 · 世界树 · 暂未实现',
] as const;
const noHit = (): void => {};

export interface CampaignWorldStageProps {
  readonly markerPortal:HTMLElement|null;readonly onLoadStatus:(status:string)=>void;readonly loadRetry?:number;
  readonly chapters:readonly ChapterInfo[];readonly cleared:ReadonlySet<string>;
  readonly focusedChapter:number|null;readonly stagesVisible:boolean;readonly selectedStageId:string|null;
  readonly viewRequest:WorldViewRequest;readonly onViewArrived:(chapter:number|null)=>void;
  readonly onChapterSelect:(index:number)=>void;readonly onStageSelect:(stage:StageInfo)=>void;readonly onDismiss:()=>void;
}
export function CampaignWorldStage(props:CampaignWorldStageProps){
  const profile=useSettingsStore(state=>state.profile);
  const camera=useMemo(()=>({position:[WORLD_RADIUS*WORLD_SCALE*.8,WORLD_RADIUS*WORLD_SCALE*2.8,WORLD_RADIUS*WORLD_SCALE*3.2] as [number,number,number],fov:40,near:.3,far:WORLD_CAMERA_FAR}),[]);
  return <WebGLGuard><Canvas camera={camera} dpr={[1,profile.dprCap]} shadows={profile.shadows} gl={{alpha:true,antialias:true}}
    onPointerDown={()=>pauseWorldLoading()} onPointerMove={event=>{if(event.buttons)pauseWorldLoading();}} onWheel={()=>pauseWorldLoading()}
    onPointerMissed={event=>{if(event.button===0)props.onDismiss();}}><WorldContent {...props}/></Canvas></WebGLGuard>;
}

function Clouds({records, material}: {readonly records: readonly CloudInstance[]; readonly material: Material}) {
  const mesh = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(1, 1), tint: number[] = [];
    records.forEach((record) => {const c = new Color(record.color);tint.push(c.r, c.g, c.b);});
    g.setAttribute('aTint', new InstancedBufferAttribute(new Float32Array(tint), 3));
    g.setAttribute('aSeed', new InstancedBufferAttribute(new Float32Array(records.map((r) => r.seed)), 1));
    g.setAttribute('aOpacity', new InstancedBufferAttribute(new Float32Array(records.map((r) => r.opacity)), 1));return g;
  }, [records]);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new Matrix4(), p = new Vector3(), q = new Quaternion(), s = new Vector3();
    records.forEach((r, i) => mesh.current!.setMatrixAt(i, matrix.compose(p.set(...r.position), q, s.set(r.size[0], r.size[1], 1))));
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [records, geometry]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <instancedMesh ref={mesh} args={[geometry, material, records.length]} dispose={null} frustumCulled={false} renderOrder={2} raycast={noHit}/>;
}

function route(points: readonly Vec3[], width: number): TubeGeometry {
  return new TubeGeometry(new CatmullRomCurve3(points.map((p) => new Vector3(...p))), 40, width, 5, false);
}
function mountain(): ConeGeometry {
  const g = new ConeGeometry(1, 1, 14, 5);g.translate(0, .5, 0);
  const p = g.getAttribute('position'), colors: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const h=p.getY(i),a=Math.atan2(p.getZ(i),p.getX(i)),rough=1+Math.sin(a*7+h*17)*.095;
    p.setX(i,p.getX(i)*rough);p.setZ(i,p.getZ(i)*rough);
    const snow=Math.max(0,Math.min(1,(h-.45+Math.sin(a*3)*.07)/.22));
    const c = new Color('#8698a8').lerp(new Color('#e6eeea'),snow);colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));g.computeVertexNormals();return g;
}

function WorldContent({chapters, cleared, focusedChapter, stagesVisible, selectedStageId, viewRequest, onViewArrived, onChapterSelect, onStageSelect,markerPortal,onLoadStatus,loadRetry=0}: CampaignWorldStageProps) {
  const quality = useSettingsStore((state) => state.quality);
  const still = useSettingsStore((state) => state.reduceMotion);
  const profile = useSettingsStore((state) => state.profile);
  const clock = useMemo(() => ({value: 0}), []);
  const detail = quality === 'high' ? 40 : quality === 'medium' ? 28 : 18;
  const built=useWorldBuild(detail,loadRetry,onLoadStatus),props=built.props;
  const geometry = useMemo(() => {
    const townOrigin=mainlandOriginal('human',TOWN_ANCHOR[0],TOWN_ANCHOR[1]);
    const humanRoute: Vec3[] = [[townOrigin[0],0,townOrigin[1]-TOWN_RADIUS/WORLD_EXPANSION],[-2.8,.24,4.9],[-4.25,.24,3.25],[-6,.3,1.2],[-7.8,.46,-.7]];
    const townX=TOWN_ANCHOR[0]*WORLD_EXPANSION,townZ=TOWN_ANCHOR[1]*WORLD_EXPANSION;
    return {
      ...buildWorldPreview(),
      trunk: new CylinderGeometry(.65, 1, 1, 7), crown: new IcosahedronGeometry(1, 2),
      pine: new ConeGeometry(1, 1, 7), mountain: mountain(), box: new BoxGeometry(1, 1, 1), roof: gableRoof(),grass:buildGrassGeometry(),rock:new IcosahedronGeometry(1,1),
      crystal:createCrystalGeometry({seed:91,sides:6,taper:.25,roughness:.12,bend:.08}),
      basalt: new CylinderGeometry(1, 1, 1, 6),
      lava: new CircleGeometry(.74, 36).rotateX(-Math.PI / 2), volcano: buildVolcano(),
      support: new CylinderGeometry(WORLD_RADIUS+.25,WORLD_RADIUS-.15,1.3,160),foot:new CylinderGeometry(WORLD_RADIUS-.15,WORLD_RADIUS*.88,1.2,160),
      rim: new TorusGeometry(WORLD_RADIUS+.24,.055,6,160).rotateX(Math.PI / 2),
      road: geographicPath(humanRoute,.12), fork: geographicPath([[-4.25,.24,3.25],[-5.35,.23,3.15],[-6.8,.26,4.1]],.11),
      river:geographicPath([[-6.9,0,1.7],[-5.4,0,1.96],[-4,0,1.66],[-2.5,0,1.2],[-1,0,1.2],[.2,0,1.6]],.085*WORLD_EXPANSION,.018),
      townRoad:buildPath([[townX,0,townZ-TOWN_RADIUS],[townX,0,townZ],[townX,0,townZ+TOWN_RADIUS],
        [FORTRESS_ANCHOR[0]*WORLD_EXPANSION+.29,0,FORTRESS_ANCHOR[1]*WORLD_EXPANSION-2.2]],.22),
      roots: [0,1,2,3,4,5].map((i) => {
        const a = i / 6 * Math.PI * 2;return route([[0,.55,0],[Math.cos(a)*.3,.22,Math.sin(a)*.3],[Math.cos(a)*.93,.02,Math.sin(a)*.93]], .075);
      }),
      branches: [0,1,2,3,4,5].map((i) => {
        const a = i * 2.399;return route([[0,.9+i*.12,0],[Math.cos(a)*.6,1.5+i*.12,Math.sin(a)*.6],[Math.cos(a)*1.25,2.04+i*.095,Math.sin(a)*1.25]], .11);
      }),
    };
  }, [detail]);
  const materials = useMemo(() => ({
    relief: groundMaterial(clock),preview:new MeshStandardMaterial({vertexColors:true,roughness:.95,side:DoubleSide}),
    scatter: new MeshStandardMaterial({color: '#ffffff', roughness: .86}),
    mountain: new MeshStandardMaterial({color: '#ffffff', vertexColors: true, roughness: .84, flatShading: true}),
    body: new MeshStandardMaterial({color: '#46535b', roughness: .68, metalness: .25}),
    foot: new MeshStandardMaterial({color: '#29333d', roughness: .58, metalness: .42}),
    gold: new MeshStandardMaterial({color: '#bfa36b', roughness: .38, metalness: .65}),
    road: new MeshStandardMaterial({color: '#c6b386', roughness: .95}),
    trunk: new MeshStandardMaterial({color: '#76634d', roughness: .89}),
    leaves: new MeshStandardMaterial({color: '#597f5d', roughness: .8}),
    leavesLight: new MeshStandardMaterial({color: '#80a270', roughness: .8}),
    grass:grassMaterial(clock),ice:new MeshStandardMaterial({color:'#a2d3dd',roughness:.18,metalness:.04,side:DoubleSide,transparent:true,opacity:.91,flatShading:true}),
    windows:new MeshStandardMaterial({color:'#ffffff',emissive:'#8c764f',emissiveIntensity:.24,roughness:.5}),
    water: flowMaterial(clock, 0), sea: flowMaterial(clock, 0, true), lava: flowMaterial(clock, 1), clouds: cloudMaterial(clock), sparks: sparkMaterial(clock),
  }), [clock]);
  const sparks = useMemo(() => {
    const g = new BufferGeometry(), positions: number[] = [], colors: number[] = [], seeds: number[] = [], kinds: number[] = [];
    for (let i = 0; i < detail * 5; i++) {
      const tree = i % 2 === 0, a = rand(i, 70) * 6.28, r = rand(i, 71) * (tree ? 1.3 : .7);
      const c = new Color(tree ? '#c7d99a' : '#ff8539');
      const center=mainlandLandmark('human',tree?-4.15:-7.75,tree?3:4.05);
      positions.push(center[0]+Math.cos(a)*r,center[1]+(tree?1.8+rand(i,72)*.5:1.2),center[2]+Math.sin(a)*r);
      colors.push(c.r,c.g,c.b);seeds.push(rand(i,73));kinds.push(tree ? 1 : 0);
    }
    g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('color',new Float32BufferAttribute(colors,3));
    g.setAttribute('aSeed',new Float32BufferAttribute(seeds,1));g.setAttribute('aKind',new Float32BufferAttribute(kinds,1));return g;
  }, [detail]);
  useEffect(() => () => {
    Object.values(geometry).forEach((item) => {if (Array.isArray(item)) item.forEach((g) => g.dispose());else item.dispose();});
  }, [geometry]);
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);
  useEffect(() => () => sparks.dispose(), [sparks]);
  useFrame((_, delta) => {
    if (!still) clock.value += Math.min(delta, .05) / ANIMATION_DURATION_SCALE;
  });
  return <>
    <WorldNavigator request={viewRequest} still={still} onArrived={onViewArrived}/>
    <ambientLight intensity={.55}/><hemisphereLight color="#d5e7e6" groundColor="#7a6557" intensity={1.15}/>
    <WorldSun profile={profile} closeView={viewRequest.stageId!==undefined||viewRequest.chapter===3}/>
    <directionalLight position={[160,280,-280]} color="#b8d5ef" intensity={.8}/>
    <group scale={WORLD_SCALE}>
      <mesh geometry={geometry.support} material={materials.body} dispose={null} position={[0,-3.82,0]} receiveShadow castShadow raycast={noHit}/>
      <mesh geometry={geometry.foot} material={materials.foot} dispose={null} position={[0,-5.05,0]} castShadow raycast={noHit}/>
      {[-3.18,-4.47].map((y)=><mesh key={y} geometry={geometry.rim} material={materials.gold} dispose={null} position={[0,y,0]} raycast={noHit}/>)}
      <mesh geometry={built.terrain??geometry.terrain} material={built.terrain?materials.relief:materials.preview} dispose={null} receiveShadow castShadow raycast={noHit}/>
      <mesh geometry={built.sea??geometry.sea} material={built.sea?materials.sea:materials.water} dispose={null} raycast={noHit}/>
      {built.landmarks&&<>
      <mesh geometry={geometry.road} material={materials.road} dispose={null} raycast={noHit}/>
      <mesh geometry={geometry.fork} material={materials.road} dispose={null} raycast={noHit}/>
      <mesh geometry={geometry.townRoad} material={materials.road} dispose={null} raycast={noHit}/>
      <mesh geometry={geometry.river} material={materials.water} dispose={null} raycast={noHit}/>
      </>}
      <Scatter geometry={geometry.grass} material={materials.grass} records={props.grasses} castShadow={false} maxDistance={125}/>
      <Scatter geometry={geometry.rock} material={materials.scatter} records={props.rocks} maxDistance={230}/>
      <Scatter geometry={geometry.rock} material={materials.scatter} records={props.shoreRocks}/>
      <Scatter geometry={geometry.crown} material={materials.scatter} records={props.flowers} castShadow={false} maxDistance={115}/>
      <Scatter geometry={geometry.box} material={materials.windows} records={props.windows}/>
      <Scatter geometry={geometry.box} material={materials.scatter} records={props.doors}/>
      <Scatter geometry={geometry.box} material={materials.scatter} records={props.beams}/>
      <Scatter geometry={geometry.pine} material={materials.scatter} records={props.snowCaps}/>
      <Scatter geometry={geometry.crystal} material={materials.ice} records={props.crystals}/>
      <Scatter geometry={geometry.trunk} material={materials.scatter} records={props.trunks}/>
      <Scatter geometry={geometry.trunk} material={materials.scatter} records={props.branches}/>
      <Scatter geometry={geometry.crown} material={materials.scatter} records={props.crowns}/>
      <Scatter geometry={geometry.pine} material={materials.scatter} records={props.pines}/>
      <Scatter geometry={geometry.box} material={materials.scatter} records={props.houses}/>
      <Scatter geometry={geometry.roof} material={materials.scatter} records={props.roofs}/>
      <Scatter geometry={geometry.basalt} material={materials.scatter} records={props.basalt}/>
      <Scatter geometry={geometry.mountain} material={materials.mountain} records={props.snowPeaks}/>
      <Scatter geometry={geometry.mountain} material={materials.mountain} records={props.sacredPeaks}/>
      {built.tree&&<CentralWorldTree clock={clock} tree={built.tree}/>}
      {built.landmarks&&<>
      <ProgressiveLandmark priority={focusedChapter===0}>
      {/* The human chapter retains its original small tree landmark. */}
      <group position={[...mainlandLandmark('human',-4.15,3)]} scale={1.16}>
        <mesh geometry={geometry.trunk} material={materials.trunk} dispose={null} position={[0,1.05,0]} scale={[.32,2.1,.28]} castShadow raycast={noHit}/>
        {[...geometry.roots,...geometry.branches].map((g,i)=><mesh key={i} geometry={g} material={materials.trunk} dispose={null} castShadow raycast={noHit}/>)}
        {Array.from({length:26},(_,i)=>{const a=i*2.399,r=.32+rand(i,93)*1.17,s=.4+rand(i,94)*.36;return <mesh key={i}
          geometry={geometry.crown} material={i%2?materials.leavesLight:materials.leaves} dispose={null}
          position={[Math.cos(a)*r,2.27+rand(i,95)*.91,Math.sin(a)*r]} scale={[s,s*.72,s*.95]} castShadow receiveShadow raycast={noHit}/>;})}
      </group>
      </ProgressiveLandmark>
      <ProgressiveLandmark priority={focusedChapter===0}><CoastalTownWalls box={geometry.box}/></ProgressiveLandmark>
      <ProgressiveLandmark priority={focusedChapter===0}><AncientSeaFortress box={geometry.box} rock={geometry.rock}/></ProgressiveLandmark>
      <ProgressiveLandmark priority={focusedChapter!==null}><WorldLandmarkDetails box={geometry.box} stone={materials.road} wood={materials.trunk} gold={materials.gold}/></ProgressiveLandmark>
      <ProgressiveLandmark priority={focusedChapter===0}>
      <group position={[...mainlandLandmark('human',-7.75,4.05)]} scale={[WORLD_EXPANSION,1.75,WORLD_EXPANSION]}>
        <mesh geometry={geometry.volcano} material={materials.relief} dispose={null} castShadow receiveShadow raycast={noHit}/>
        <mesh geometry={geometry.lava} material={materials.lava} dispose={null} position={[0,.86,0]} raycast={noHit}/>
      </group>
      <LavaBranches material={materials.lava}/>
      </ProgressiveLandmark>
      {built.terrain&&built.demon&&<ProgressiveLandmark priority={focusedChapter===1}>
        <DemonLandmarks geometry={built.demon} clock={clock}/>
      </ProgressiveLandmark>}
      <ProgressiveLandmark priority={focusedChapter===2}><SacredGate box={geometry.box} stone={materials.scatter} gold={materials.gold}/></ProgressiveLandmark>
      </>}
      {built.atmosphere&&<>
      <ProgressiveLandmark priority={focusedChapter===3}><MoonArchipelago clock={clock} ground={materials.relief} gold={materials.gold} clouds={materials.clouds}/></ProgressiveLandmark>
      <Clouds records={props.clouds} material={materials.clouds}/>
      <points geometry={sparks} material={materials.sparks} dispose={null} raycast={noHit}/>
      </>}
      <WorldMarkers markerPortal={markerPortal} chapters={chapters} cleared={cleared} focusedChapter={focusedChapter} stagesVisible={stagesVisible}
        selectedStageId={selectedStageId} onChapterSelect={onChapterSelect} onStageSelect={onStageSelect}/>
    </group>
    {built.atmosphere&&profile.bloom&&<EffectComposer multisampling={0}><Bloom intensity={.28*profile.bloomScale} luminanceThreshold={1.25} mipmapBlur/></EffectComposer>}
  </>;
}

function ProgressiveLandmark({children,priority=false}:{readonly children:ReactNode;readonly priority?:boolean}){
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    if(ready)return;
    if(priority){setReady(true);return;}
    return scheduleWorldTask(()=>setReady(true));
  },[ready,priority]);
  return ready?<>{children}</>:null;
}

function SacredGate({box,stone,gold}:{readonly box:BufferGeometry;readonly stone:Material;readonly gold:Material}){
  return <group position={[...mainlandLandmark('sacred',0,-4.95)]}>
    {[-1,1].map((side)=><group key={side}>
      <mesh geometry={box} material={stone} dispose={null} position={[side*1.07,1.07,0]} scale={[.45,2.15,.7]} rotation={[0,0,-side*.09]} castShadow raycast={noHit}/>
      <mesh geometry={box} material={gold} dispose={null} position={[side*.81,1.15,.365]} scale={[.055,1.65,.05]} raycast={noHit}/>
      <mesh position={[side*1.07,1.25,.36]} scale={[.08,1.48,.035]} raycast={noHit}><boxGeometry/><meshStandardMaterial color="#88deec" emissive="#82dbe8" emissiveIntensity={1.25}/></mesh>
    </group>)}
    <mesh geometry={box} material={stone} dispose={null} position={[0,2.27,0]} scale={[2.78,.36,.72]} castShadow raycast={noHit}/>
    <mesh geometry={box} material={gold} dispose={null} position={[0,2.44,.37]} scale={[2.8,.045,.06]} raycast={noHit}/>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.025,.62]} raycast={noHit}><planeGeometry args={[2.1,2.2]}/><meshStandardMaterial color="#d0dbd8" roughness={.5}/></mesh>
    <mesh position={[0,1.2,.05]} raycast={noHit}><planeGeometry args={[1.7,2.1]}/><meshBasicMaterial color="#91c9d8" transparent opacity={.16} depthWrite={false}/></mesh>
  </group>;
}
function LavaBranches({material}:{readonly material:Material}){
  const geometry=useMemo(()=>[
    geographicPath([[-7.8,0,4],[-8.8,0,3.3],[-9.6,0,2.8],[-10.1,0,1.9]],.065,.028),
    geographicPath([[-7.7,0,4.1],[-7.35,0,5.5],[-7.8,0,6.6]],.09,.028),
    geographicPath([[-7.8,0,4],[-6.6,0,4.45],[-5.8,0,4.9]],.05,.028),
    geographicPath([[-8.8,0,3.3],[-9.2,0,4.5],[-9.55,0,5.8]],.035,.028),
    geographicPath([[-7.35,0,5.5],[-8.2,0,6.2],[-8.75,0,6.75]],.04,.028),
    geographicPath([[-7.1,0,5.2],[-6.55,0,5.7],[-6,0,5.95]],.027,.028),
    geographicPath([[-9.3,0,3],[-10,0,3.9],[-10.35,0,4.35]],.026,.028),
  ],[]);
  useEffect(()=>()=>geometry.forEach((g)=>g.dispose()),[geometry]);
  return <>{geometry.map((g,i)=><mesh key={i} geometry={g} material={material} dispose={null} raycast={noHit}/>)}</>;
}


function gableRoof():BufferGeometry{
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute([-.5,0,-.5,.5,0,-.5,0,.7,-.5,-.5,0,.5,.5,0,.5,0,.7,.5],3));
  g.setIndex([0,2,1,3,4,5,0,3,2,2,3,5,1,2,4,2,5,4,0,1,3,1,4,3]);g.computeVertexNormals();return g;
}


function geographicPath(points:readonly Vec3[],width:number,offset=.021,region:Mainland='human'):BufferGeometry{
  return buildPath(points.map(([x,y,z]):Vec3=>{
    const point=mainlandPoint(region,x,z);return [point[0]*WORLD_EXPANSION,y,point[1]*WORLD_EXPANSION];
  }),width,offset);
}
function WorldSun({profile,closeView}:{readonly profile:QualityProfile;readonly closeView:boolean}){
  const light=useRef<DirectionalLight>(null);
  const controls=useThree(state=>state.controls);
  const target=useMemo(()=>new Vector3(),[]),origin=useMemo(()=>new Vector3(),[]);
  const offset=useMemo(()=>new Vector3(-210,450,225).multiplyScalar(closeView?1:WORLD_RADIUS*WORLD_SCALE/295),[closeView]);
  useFrame(()=>{
    if(!light.current)return;
    const orbit=controls as OrbitControlsImpl|null;
    target.copy(closeView&&orbit?.target?orbit.target:origin);
    light.current.position.copy(target).add(offset);
    light.current.target.position.copy(target);light.current.target.updateMatrixWorld();
  });
  const worldExtent=Math.hypot(WORLD_RADIUS,CENTRAL_WORLD_TOP)*WORLD_SCALE;
  const range=closeView?90:worldExtent*1.14;
  const far=closeView?1400:offset.length()+worldExtent*1.6;
  useLayoutEffect(()=>light.current?.shadow.camera.updateProjectionMatrix(),[range,far]);
  return <directionalLight ref={light} color="#ffe8c2" intensity={2.2} castShadow={profile.shadows}
    shadow-mapSize={[profile.shadowMapSize,profile.shadowMapSize]} shadow-camera-left={-range} shadow-camera-right={range}
    shadow-camera-top={range} shadow-camera-bottom={-range} shadow-camera-near={1} shadow-camera-far={far} shadow-bias={-.0001}/>;
}
