import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stages } from '../data';
import { backgroundUrl } from '../data/assets';
import { activeDeckOf } from '../domain/progression/profile';
import { planStageLaunch, type StageLaunch } from '../domain/progression/campaign';
import type { ProfileState } from '../domain/progression/types';
import type { RouteId } from '../app/routes';
import { pushToast } from '../state/toastStore';
import { useEnemyDeckConfigStore } from '../state/enemyDeckConfigStore';
import { CrossfadeBackground } from '../ui/SceneBackground';
import { useParallax } from '../ui/useParallax';
import { CampaignWorldStage, CHAPTER_LANDSCAPES } from '../rendering/campaign/CampaignWorldStage';
import type { WorldViewRequest } from '../rendering/campaign/WorldNavigator';
import { WorldMarkerOverlay } from '../rendering/campaign/WorldMarkers';
import { campaignChapters, type StageInfo } from './campaignFlow';
import '../ui/campaignWorld.css';

export interface CampaignSceneProps {
  readonly profile:ProfileState;
  readonly onNavigate:(route:RouteId)=>void;
  readonly onLaunch:(launch:StageLaunch)=>void;
}
type DetailSelection={readonly kind:'chapter';readonly index:number}|{readonly kind:'stage';readonly stage:StageInfo};

/** A single persistent full-viewport world; chapter and stage selection never replace it. */
export function CampaignScene({profile,onNavigate,onLaunch}:CampaignSceneProps){
  const enemyOverrides=useEnemyDeckConfigStore(state=>state.config.campaign);
  const chapters=useMemo(()=>campaignChapters(enemyOverrides),[enemyOverrides]);
  const [focusedChapter,setFocusedChapter]=useState<number|null>(null);
  const [arrivedChapter,setArrivedChapter]=useState<number|null>(null);
  const [detail,setDetail]=useState<DetailSelection|null>(null);
  const [detailOpen,setDetailOpen]=useState(false);
  const [viewRequest,setViewRequest]=useState<WorldViewRequest>({serial:0,chapter:null});
  const [markerPortal,setMarkerPortal]=useState<HTMLDivElement|null>(null);
  const [loadStatus,setLoadStatus]=useState('地图可操作 · 正在补充地形'),[loadRetry,setLoadRetry]=useState(0);
  const cleared=useMemo(()=>new Set(profile.campaign.clearedStages),[profile.campaign.clearedStages]);
  const launchSeq=useRef(0),parallaxRef=useParallax();
  const returnToWorld=useCallback(()=>{
    setFocusedChapter(null);setArrivedChapter(null);setDetailOpen(false);
    setViewRequest(previous=>({serial:previous.serial+1,chapter:null}));
  },[]);
  const selectChapter=(index:number):void=>{
    setFocusedChapter(index);setArrivedChapter(null);setDetail({kind:'chapter',index});setDetailOpen(true);
    setViewRequest(previous=>({serial:previous.serial+1,chapter:index}));
  };
  const selectStage=(stage:StageInfo):void=>{
    const index=chapters.findIndex(chapter=>chapter.id===stage.chapterId);
    setDetail({kind:'stage',stage});setDetailOpen(true);
    setViewRequest(previous=>({serial:previous.serial+1,chapter:index<0?0:index,stageId:stage.id}));
  };
  const launch=(stage:StageInfo):void=>{
    const deck=activeDeckOf(profile);
    const result=planStageLaunch({profile,stageId:stage.id,chapterId:stage.chapterId,stageName:stage.name,
      playerDeck:deck?.cardIds??[],enemyDeck:enemyOverrides[stage.id]??stage.enemyDeck,rewardSpec:stage.reward,launchSeq:launchSeq.current+1});
    if('rejected' in result){pushToast(result.rejected,'info');return;}
    if(result.clipped)pushToast(`${stage.id} 的敌方牌组超过 12 张，已裁到 ${result.enemyDeck.length} 张`,'info');
    launchSeq.current+=1;onLaunch(result);
  };
  useEffect(()=>{
    const key=(event:KeyboardEvent):void=>{
      if(event.key!=='Escape')return;
      if(focusedChapter!==null)returnToWorld();else onNavigate('battlemenu');
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[focusedChapter,onNavigate,returnToWorld]);
  const chapter=focusedChapter===null?null:chapters[focusedChapter]??null;
  const detailChapter=detail?.kind==='chapter'?chapters[detail.index]??null:null;
  const detailStage=detail?.kind==='stage'?chapters.flatMap(c=>c.stages).find(s=>s.id===detail.stage.id)??null:null;
  const completed=detailChapter?.stages.filter(stage=>cleared.has(stage.id)).length??0;
  return <div className={`menu campaign-world${focusedChapter!==null?' campaign-world--focused':''}`} ref={parallaxRef}>
    <CrossfadeBackground url={backgroundUrl('bg/world_map')}/><div className="menu__scrim" aria-hidden="true"/>
    <div className="campaign-world__canvas" aria-label="全屏立体世界地图">
      <CampaignWorldStage chapters={chapters} cleared={cleared} focusedChapter={focusedChapter}
        markerPortal={markerPortal} onLoadStatus={setLoadStatus} loadRetry={loadRetry}
        stagesVisible={focusedChapter!==null&&arrivedChapter===focusedChapter} onViewArrived={setArrivedChapter}
        selectedStageId={detailOpen&&detailStage?detailStage.id:null} viewRequest={viewRequest}
        onChapterSelect={selectChapter} onStageSelect={selectStage} onDismiss={()=>setDetailOpen(false)}/>
    </div>
    <div className="campaign-world__markers" ref={setMarkerPortal} aria-label="章节与关卡入口">
      <WorldMarkerOverlay chapters={chapters} cleared={cleared} focusedChapter={focusedChapter}
        stagesVisible={focusedChapter!==null&&arrivedChapter===focusedChapter}
        selectedStageId={detailOpen&&detailStage?detailStage.id:null} onChapterSelect={selectChapter} onStageSelect={selectStage}/>
    </div>
    <header className="campaign-world__header">
      <h1>{chapter?.name??'世界地图'}</h1>
      <p>{chapter?(chapter.stages.length?'点击当地关卡标记，查看奖励和敌方牌组':'本章暂未实现，可自由浏览这片区域'):'点击悬浮章节入口，前往对应区域'}</p>
    </header>
    <button type="button" className="btn campaign-world__return" onClick={focusedChapter===null?()=>onNavigate('battlemenu'):returnToWorld}>
      {focusedChapter===null?'返回战斗菜单':'返回世界地图'}
    </button>
    <aside className={`campaign-world__drawer${detailOpen?' campaign-world__drawer--open':''}`}
      aria-label={detailStage?'关卡详情':'章节详情'} aria-hidden={!detailOpen} inert={!detailOpen}>
      {detailChapter&&<>
        <span className="campaign-world__eyebrow">CHAPTER 0{detail?.kind==='chapter'?detail.index+1:1}</span>
        <h2>{detailChapter.name}</h2><p className="campaign-world__landscape">{CHAPTER_LANDSCAPES[detail?.kind==='chapter'?detail.index:0]}</p>
        <p>{detailChapter.stages.length?`${completed} / ${detailChapter.stages.length} 关已通关`:'暂未实现'}</p>
        <div className="campaign-world__progress" aria-hidden="true"><span style={{width:`${detailChapter.stages.length?completed/detailChapter.stages.length*100:0}%`}}/></div>
        <p className="campaign-world__drawer-note">{detailChapter.stages.length?'关卡已显示在这片区域的地形中，点击旗标查看。':`${detailChapter.name}暂未实现，目前仅展示地图区域，暂无可挑战关卡。`}</p>
      </>}
      {detailStage&&<>
        <span className="campaign-world__eyebrow">{detailStage.chapterName} · {detailStage.id}</span>
        <h2>{detailStage.name}</h2>
        {detailStage.summary&&<p>{detailStage.summary}</p>}
        {cleared.has(detailStage.id)&&<span className="campaign-world__done">已通关</span>}
        <p>{detailStage.enemyDeck.length?`敌方牌组 ${detailStage.enemyDeck.length} 张`:'待配置敌方卡组 · 请在 admin 导航栏配置并保存'}</p>
        <ul className="campaign-world__rewards"><li>金币 <b>{detailStage.reward?.gold??0}</b></li><li>经验 <b>{detailStage.reward?.xp??0}</b></li>
          {(detailStage.reward?.items??[]).map(item=><li key={item}>{item}</li>)}
        </ul>
        <button type="button" className="btn btn--primary" disabled={detailStage.enemyDeck.length===0} onClick={()=>launch(detailStage)}>{detailStage.enemyDeck.length?'出战':'待配置敌方卡组'}</button>
      </>}
    </aside>
    <div className="campaign-world__status"><span>左键旋转 · 右键平移 · 滚轮缩放</span>
      <span className="campaign-world__loading" role="status">{loadStatus}
        {loadStatus.includes('未能')&&<button type="button" className="btn" onClick={()=>setLoadRetry(previous=>previous+1)}>重试细节加载</button>}
      </span>
      <span>已通关 {cleared.size} / {stages.chapters.reduce((sum,c)=>sum+c.stages.length,0)} 关</span>
    </div>
  </div>;
}
