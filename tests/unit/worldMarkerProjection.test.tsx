import { describe,expect,it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PerspectiveCamera,Vector3 } from 'three';
import { campaignChapters } from '../../src/scenes/campaignFlow';
import { getWorldMarkers,WORLD_EXPANSION } from '../../src/rendering/campaign/worldGeometry';
import { FUTURE_CHAPTER_VIEWS } from '../../src/rendering/campaign/worldFutureChapters';
import { CENTRAL_TREE_ANCHOR,CENTRAL_WORLD_TOP } from '../../src/rendering/campaign/worldPlacement';
import { WorldMarkerOverlay } from '../../src/rendering/campaign/WorldMarkers';
import { projectWorldMarker,type MarkerProjection } from '../../src/rendering/campaign/worldMarkerProjection';

const chapters=campaignChapters();
const callbacks={onChapterSelect:()=>{},onStageSelect:()=>{}};
function overlay(focusedChapter:number|null,stagesVisible:boolean):string {
  return renderToStaticMarkup(<WorldMarkerOverlay chapters={chapters} cleared={new Set()} focusedChapter={focusedChapter}
    stagesVisible={stagesVisible} selectedStageId={null} {...callbacks}/>);
}

describe('世界地图统一入口与首帧投影',()=>{
  it('首次总览和从其它章节返回总览都有六章，入口不依赖装饰进度',()=>{
    const first=overlay(null,false);
    expect(first.match(/data-chapter-id=/g)).toHaveLength(6);
    expect(first).toContain('data-world-marker="chapter:chapter_1"');
    expect(first).toContain('聚焦第1章 人界');
    expect(overlay(1,true)).toContain('data-stage-id="2-1"');
    expect(overlay(null,false)).toBe(first);
  });
  it('古海与世界树仅作空章占位，入口编号正确且不增加可玩关卡',()=>{
    expect(chapters.slice(4).map(c=>[c.id,c.name,c.stages.length])).toEqual([['chapter_5','古海',0],['chapter_6','世界树',0]]);
    expect(chapters.reduce((count,c)=>count+c.stages.length,0)).toBe(12);
    const markup=overlay(null,false);
    expect(markup).toContain('聚焦第5章 古海');expect(markup).toContain('聚焦第6章 世界树');
    expect(markup.match(/暂未实现/g)).toHaveLength(2);
    expect(overlay(4,true)).toBe('');expect(overlay(5,true)).toBe('');
  });
  it('新增标记和专用取景分别定位南端群岛与中央树冠，不回落人界',()=>{
    const markers=getWorldMarkers();expect(markers).toHaveLength(6);
    expect(markers[4]).toEqual(FUTURE_CHAPTER_VIEWS[4]!.marker);
    expect(markers[4]![2]).toBeGreaterThan(15*WORLD_EXPANSION);
    expect(markers[5]).toEqual(FUTURE_CHAPTER_VIEWS[5]!.marker);
    expect(markers[5]![0]).toBe(CENTRAL_TREE_ANCHOR[0]*WORLD_EXPANSION);
    expect(markers[5]![2]).toBe(CENTRAL_TREE_ANCHOR[1]*WORLD_EXPANSION);
    expect(markers[5]![1]).toBeGreaterThan(CENTRAL_WORLD_TOP);
    expect(FUTURE_CHAPTER_VIEWS[4]!.target[2]).toBe(15*WORLD_EXPANSION);
    expect(FUTURE_CHAPTER_VIEWS[5]!.target[1]).toBe(CENTRAL_WORLD_TOP*.5);
    for(const view of Object.values(FUTURE_CHAPTER_VIEWS)){
      expect(view.radius).toBeGreaterThan(0);expect([...view.marker,...view.target].every(Number.isFinite)).toBe(true);
    }
  });
  it('索引零的人界是有效章节，镜头到达后正常显示第一关',()=>{
    expect(overlay(0,false)).toBe('');
    const local=overlay(0,true);
    expect(local).toContain('data-stage-id="1-1"');
    expect(local).not.toContain('data-chapter-id=');
  });
  it('首帧用当前矩阵投影，窗口尺寸变化立即映射到新画布',()=>{
    const camera=new PerspectiveCamera(40,2,.3,1000),scratch=new Vector3(),out:MarkerProjection={x:0,y:0,visible:false};
    camera.position.set(0,0,100);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    projectWorldMarker([0,0,0],camera,800,400,out,scratch);
    expect(out).toEqual({x:400,y:200,visible:true});
    camera.aspect=1;camera.updateProjectionMatrix();
    projectWorldMarker([0,0,0],camera,500,500,out,scratch);
    expect(out).toEqual({x:250,y:250,visible:true});
    camera.position.set(-100,0,0);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    projectWorldMarker([0,0,0],camera,500,500,out,scratch);
    expect(out.visible).toBe(true);expect(out.x).toBeCloseTo(250,8);
  });
  it('零尺寸、非有限值、相机背后与视锥外不生成可点击的错误标签',()=>{
    const camera=new PerspectiveCamera(40,2,.3,1000),scratch=new Vector3(),out:MarkerProjection={x:0,y:0,visible:false};
    camera.position.set(0,0,100);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    projectWorldMarker([0,0,0],camera,0,400,out,scratch);expect(out.visible).toBe(false);
    projectWorldMarker([NaN,0,0],camera,800,400,out,scratch);expect(out.visible).toBe(false);
    projectWorldMarker([0,0,200],camera,800,400,out,scratch);expect(out.visible).toBe(false);
    projectWorldMarker([1000,0,0],camera,800,400,out,scratch);expect(out.visible).toBe(false);
    projectWorldMarker([0,0,-1500],camera,800,400,out,scratch);expect(out.visible).toBe(false);
    projectWorldMarker([0,0,0],camera,800,400,out,scratch);expect(out.visible).toBe(true);
  });
});
