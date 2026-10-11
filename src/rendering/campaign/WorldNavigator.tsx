import { useLayoutEffect,useMemo,useRef } from 'react';
import { useFrame,useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Vector3,type PerspectiveCamera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { landmarkPoint,stagePoint,terrainHeight,WORLD_EXPANSION,WORLD_RADIUS,WORLD_SCALE } from './worldGeometry';
import { demonStage } from './demonLayout';
import { FUTURE_CHAPTER_VIEWS } from './worldFutureChapters';
import { FORTRESS_ANCHOR,TOWN_ANCHOR } from './worldLayout';
import { CHAPTER_FOCI } from './worldIslands';
import { MOON_MAX_HEIGHT,MOON_ORIGIN,MOON_VIEW_DISTANCE } from './moonLayout';
import { CENTRAL_WORLD_TOP } from './worldPlacement';

const WORLD_TOP=Math.max(CENTRAL_WORLD_TOP,MOON_MAX_HEIGHT);
const OVERVIEW_CENTER_Y=(WORLD_TOP-5.65)*.5*WORLD_SCALE;
const OVERVIEW_RADIUS=Math.hypot(WORLD_RADIUS*WORLD_SCALE,(WORLD_TOP+5.65)*.5*WORLD_SCALE);

export interface WorldViewRequest {readonly serial:number;readonly chapter:number|null;readonly stageId?:string}
export const WORLD_CAMERA_FAR=WORLD_RADIUS*WORLD_SCALE*16;
function fittedDistance(radius:number,aspect:number,fov:number):number {
  const vertical=fov*Math.PI/360,horizontal=Math.atan(Math.tan(vertical)*Math.max(.1,aspect));
  return radius*1.12/Math.sin(Math.min(vertical,horizontal));
}

export function WorldNavigator({request,still,onArrived}:{readonly request:WorldViewRequest;readonly still:boolean;readonly onArrived:(chapter:number|null)=>void}){
  const camera=useThree(state=>state.camera) as PerspectiveCamera;
  const size=useThree(state=>state.size),canvas=useThree(state=>state.gl.domElement);
  const controls=useRef<OrbitControlsImpl>(null),initialized=useRef(false),notified=useRef(-1),pendingInit=useRef(true);
  const arrived=useRef(onArrived);arrived.current=onArrived;
  const destination=useRef<{position:Vector3;target:Vector3}|null>(null);
  const aspect=size.width/Math.max(1,size.height);
  const maxDistance=Math.max(WORLD_RADIUS*WORLD_SCALE*6,fittedDistance(OVERVIEW_RADIUS,aspect,camera.fov)*1.6);
  const direction=useMemo(()=>new Vector3(.13,.64,.76).normalize(),[]);
  const scratch=useMemo(()=>({before:new Vector3(),correction:new Vector3()}),[]);
  const notify=():void=>{if(notified.current!==request.serial){notified.current=request.serial;arrived.current(request.chapter);}};
  const initializeView=():void=>{
    const orbit=controls.current;if(!orbit||size.width<=0||size.height<=0)return;
    let target:Vector3,distance:number;
    const demon=request.stageId?demonStage(request.stageId):undefined;
    if(demon){
      target=new Vector3(...landmarkPoint(...demon.center));
      // An abyss is framed around its raised mouth, not its subterranean floor or entrance flag.
      target.y=Math.max(0,target.y)+demon.focusHeight;target.multiplyScalar(WORLD_SCALE);
      distance=fittedDistance(demon.viewRadius*WORLD_SCALE,aspect,camera.fov);
    }else if(request.stageId==='1-1'){
      target=new Vector3((FORTRESS_ANCHOR[0]+TOWN_ANCHOR[0])*.5*WORLD_EXPANSION,1.35,
        (FORTRESS_ANCHOR[1]+TOWN_ANCHOR[1])*.5*WORLD_EXPANSION).multiplyScalar(WORLD_SCALE);
      distance=126;
    }else if(request.stageId){target=new Vector3(...stagePoint(request.stageId,1.15)).multiplyScalar(WORLD_SCALE);distance=request.stageId==='1-4'?110:82;}
    else if(request.chapter===null){
      target=new Vector3(0,OVERVIEW_CENTER_Y,0);
      distance=fittedDistance(OVERVIEW_RADIUS,aspect,camera.fov);
    }else if(request.chapter===3){
      target=new Vector3(...MOON_ORIGIN).multiplyScalar(WORLD_SCALE);target.y+=3;
      distance=Math.max(MOON_VIEW_DISTANCE,MOON_VIEW_DISTANCE/Math.min(1,Math.max(.1,aspect)));
    }else if(FUTURE_CHAPTER_VIEWS[request.chapter]){
      const view=FUTURE_CHAPTER_VIEWS[request.chapter]!;
      target=new Vector3(...view.target).multiplyScalar(WORLD_SCALE);
      distance=fittedDistance(view.radius*WORLD_SCALE,aspect,camera.fov);
    }else{
      const island=CHAPTER_FOCI[request.chapter]??CHAPTER_FOCI[0]!;
      target=new Vector3(island.center[0]*WORLD_EXPANSION,1.4,island.center[1]*WORLD_EXPANSION).multiplyScalar(WORLD_SCALE);
      distance=fittedDistance(island.radius*WORLD_EXPANSION*WORLD_SCALE,aspect,camera.fov);
    }
    const position=target.clone().addScaledVector(direction,distance);
    camera.aspect=aspect;camera.near=.3;camera.far=Math.max(WORLD_CAMERA_FAR,maxDistance+WORLD_RADIUS*WORLD_SCALE*2);camera.updateProjectionMatrix();
    orbit.enableDamping=false;
    if(!initialized.current||still){camera.position.copy(position);orbit.target.copy(target);orbit.update();camera.updateMatrixWorld();destination.current=null;notify();}
    else destination.current={position,target};
    initialized.current=true;pendingInit.current=false;
  };
  useLayoutEffect(()=>{pendingInit.current=true;initializeView();},[request,camera,direction,still,aspect,maxDistance,size.width,size.height]);
  useLayoutEffect(()=>{
    const focus=():void=>canvas.focus({preventScroll:true});canvas.tabIndex=0;canvas.addEventListener('pointerdown',focus);
    return()=>canvas.removeEventListener('pointerdown',focus);
  },[canvas]);
  useFrame((_,delta)=>{
    if(pendingInit.current)initializeView();
    const orbit=controls.current;if(!orbit)return;
    const move=destination.current;
    if(move){
      orbit.enableDamping=false;const blend=1-Math.exp(-Math.min(delta,.05)*4.8);
      camera.position.lerp(move.position,blend);orbit.target.lerp(move.target,blend);orbit.update();
      if(camera.position.distanceToSquared(move.position)<.04&&orbit.target.distanceToSquared(move.target)<.04){destination.current=null;notify();}
      return;
    }
    orbit.enableDamping=!still;scratch.before.copy(orbit.target);
    const radius=Math.hypot(orbit.target.x,orbit.target.z),limit=WORLD_RADIUS*WORLD_SCALE*1.16;
    if(radius>limit){orbit.target.x*=limit/radius;orbit.target.z*=limit/radius;}
    orbit.target.y=Math.max(-18,Math.min((WORLD_TOP+12)*WORLD_SCALE,orbit.target.y));scratch.correction.copy(orbit.target).sub(scratch.before);
    if(scratch.correction.lengthSq()>0){camera.position.add(scratch.correction);orbit.update();}
    if(Math.hypot(camera.position.x,camera.position.z)<WORLD_RADIUS*WORLD_SCALE){
      const floor=terrainHeight(camera.position.x/WORLD_SCALE,camera.position.z/WORLD_SCALE)*WORLD_SCALE+1.5;
      if(camera.position.y<floor){camera.position.y=floor;orbit.update();}
    }
  },-2);
  return <OrbitControls ref={controls} makeDefault enablePan enableZoom enableRotate enableDamping={!still}
    dampingFactor={.08} screenSpacePanning={false} rotateSpeed={.52} panSpeed={.85} zoomSpeed={.88}
    minDistance={14} maxDistance={maxDistance} minPolarAngle={.12} maxPolarAngle={Math.PI*.475}
    onStart={()=>{destination.current=null;notify();if(controls.current)controls.current.enableDamping=!still;}} keyEvents={canvas}/>;
}
