import { useLayoutEffect,useMemo,type CSSProperties } from 'react';
import { useFrame,useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { ChapterInfo,StageInfo } from '../../scenes/campaignFlow';
import { getWorldMarkers,stagePoint,WORLD_SCALE,type Vec3 } from './worldGeometry';
import { chapterMarkerKey,projectWorldMarker,stageMarkerKey,type MarkerProjection } from './worldMarkerProjection';

interface MarkerProps {
  readonly chapters:readonly ChapterInfo[];readonly cleared:ReadonlySet<string>;readonly focusedChapter:number|null;
  readonly stagesVisible:boolean;readonly selectedStageId:string|null;
  readonly onChapterSelect:(index:number)=>void;readonly onStageSelect:(stage:StageInfo)=>void;
}
const COLORS=['#dce9b5','#d4a8cc','#c6e8ee','#e2e0ff','#a9dce4','#c4e5a6'] as const;
const noHit=():void=>{};

/** One DOM tree owned by CampaignScene; scenery and Canvas mounting never create separate roots. */
export function WorldMarkerOverlay({chapters,cleared,focusedChapter,stagesVisible,selectedStageId,onChapterSelect,onStageSelect}:MarkerProps){
  if(focusedChapter===null)return <>{chapters.map((chapter,index)=>{
    const done=chapter.stages.filter(stage=>cleared.has(stage.id)).length;
    return <div key={chapterMarkerKey(chapter.id)} className="campaign-world__pin-wrap" data-world-marker={chapterMarkerKey(chapter.id)}>
      <button type="button" className="campaign-world__pin" data-chapter-id={chapter.id}
        style={{'--region-color':COLORS[index]??COLORS[0]} as CSSProperties}
        onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();onChapterSelect(index);}} aria-label={`聚焦第${index+1}章 ${chapter.name}`}>
        <span className="campaign-world__pin-number">0{index+1}</span><strong>{chapter.name}</strong>
        <small>{chapter.stages.length?`${done} / ${chapter.stages.length}`:index>=4?'暂未实现':'云雾笼罩'}</small>
      </button>
    </div>;
  })}</>;
  const chapter=chapters[focusedChapter];if(!stagesVisible||!chapter)return null;
  return <>{chapter.stages.map(stage=><div key={stageMarkerKey(stage.id)} className="campaign-world__pin-wrap" data-world-marker={stageMarkerKey(stage.id)}>
    <button type="button" className={`campaign-world__pin campaign-world__pin--stage${stage.id===selectedStageId?' campaign-world__pin--selected':''}`} data-stage-id={stage.id}
      style={{'--region-color':COLORS[focusedChapter]??COLORS[0]} as CSSProperties}
      onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();onStageSelect(stage);}}>
      <span className="campaign-world__pin-number">{stage.id}</span><strong>{stage.name}</strong><small>{cleared.has(stage.id)?'已通关':'查看关卡'}</small>
    </button>
  </div>)}</>;
}

/** Projection runs after navigation and OrbitControls, without per-frame React state updates. */
export function WorldMarkers({chapters,cleared,focusedChapter,stagesVisible,markerPortal}:MarkerProps&{readonly markerPortal:HTMLElement|null}){
  const camera=useThree(state=>state.camera),size=useThree(state=>state.size);
  const scratch=useMemo(()=>new Vector3(),[]),projection=useMemo<MarkerProjection>(()=>({x:0,y:0,visible:false}),[]);
  const anchors=useMemo(()=>{
    const positions=new Map<string,Vec3>();
    if(focusedChapter===null){
      const markers=getWorldMarkers();
      chapters.forEach((chapter,index)=>{const point=markers[index];if(point)positions.set(chapterMarkerKey(chapter.id),[point[0]*WORLD_SCALE,point[1]*WORLD_SCALE,point[2]*WORLD_SCALE]);});
    }else if(stagesVisible){
      for(const stage of chapters[focusedChapter]?.stages??[]){
        const point=stagePoint(stage.id,stage.id==='1-1'?4.8:stage.id==='1-2'?4.6:3);
        positions.set(stageMarkerKey(stage.id),[point[0]*WORLD_SCALE,point[1]*WORLD_SCALE,point[2]*WORLD_SCALE]);
      }
    }
    return positions;
  },[chapters,focusedChapter,stagesVisible]);
  const elements=useMemo(()=>new Map<string,HTMLElement>(),[markerPortal]);
  useLayoutEffect(()=>{
    if(!markerPortal)return;
    const collect=():void=>{
      elements.clear();
      for(const node of markerPortal.querySelectorAll<HTMLElement>('[data-world-marker]')){
        const key=node.dataset['worldMarker'];if(key)elements.set(key,node);
      }
    };
    collect();
    const observer=new MutationObserver(collect);observer.observe(markerPortal,{childList:true,subtree:true});
    return()=>{observer.disconnect();elements.clear();};
  },[markerPortal,elements]);
  useFrame(()=>{
    camera.updateMatrixWorld();
    for(const [key,element] of elements){
      const point=anchors.get(key);
      if(!point){element.style.visibility='hidden';continue;}
      projectWorldMarker(point,camera,size.width,size.height,projection,scratch);
      element.style.visibility=projection.visible?'visible':'hidden';
      if(projection.visible)element.style.transform=`translate3d(${projection.x}px,${projection.y}px,0) translate(-50%,-50%)`;
    }
  },-.5);
  const chapter=focusedChapter===null?null:chapters[focusedChapter];
  if(!stagesVisible||!chapter)return null;
  return <>{chapter.stages.map(stage=>{
    const position=stagePoint(stage.id);
    return <group key={stage.id} position={[...position]}>
      <mesh position={[0,.06,0]} rotation={[-Math.PI/2,0,0]} raycast={noHit}><torusGeometry args={[.28,.025,6,24]}/><meshStandardMaterial color="#d8bc78" emissive="#b99550" emissiveIntensity={.28}/></mesh>
      <mesh position={[0,.52,0]} raycast={noHit}><cylinderGeometry args={[.022,.027,1.02,6]}/><meshStandardMaterial color="#bba16f" metalness={.45} roughness={.4}/></mesh>
      <mesh position={[.17,.85,0]} raycast={noHit}><boxGeometry args={[.32,.23,.025]}/><meshStandardMaterial color={cleared.has(stage.id)?'#97b996':'#d2b277'} roughness={.7}/></mesh>
    </group>;
  })}</>;
}
