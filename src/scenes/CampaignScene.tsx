import { useEffect, useMemo, useRef, useState } from 'react';

import { stages } from '../data';
import { backgroundUrl, posterUrl } from '../data/assets';
import { activeDeckOf } from '../domain/progression/profile';
import { planStageLaunch } from '../domain/progression/campaign';
import type { StageLaunch } from '../domain/progression/campaign';
import { pushToast } from '../state/toastStore';
import { CurrencyBar } from '../ui/CurrencyBar';
import { DesignStage } from '../ui/DesignStage';
import { LevelBar } from '../ui/LevelBar';
import { campaignChapters } from './campaignFlow';
import type { ChapterInfo, StageInfo } from './campaignFlow';
import type { ProfileState } from '../domain/progression/types';
import type { RouteId } from '../app/routes';

/**
 * 单人战役。1:1 照旧版的两层地图：
 *
 * - **世界地图**（`scenes/map/world_map_scene.py`）：标题「世界地图」@15%、
 *   副标题「点击章节进入关卡」；章节海报横排在 (15%~75%, 60%)，540×360；
 *   右侧 (70%, 18%, 26%×68%) 是所选章节的详情；左下「返回上一级」(4%, 86%)。
 * - **章节地图**（`chapter_map_scene.py`）：标题 @12%、副标题
 *   「选择关卡（ESC 返回世界地图）」@20%；关卡海报从左下往右上排
 *   （起点 (7%, 35%)，横向铺 62%、纵向间隔 30%）；右侧 (72%, 18%, 24%×68%)
 *   是所选关卡的详情；底部一行状态。
 *
 * 旧版是**两个场景**，这里是一块屏里的两个层：路由只有一个 `campaign`，
 * ESC 从章节地图退回世界地图（旧版也是这个键位）。
 *
 * 交互照旧版：**悬停就选中**（右侧详情跟着换），**点击进入/开战**
 * （旧版 `world_map_scene.py` 也是这么分的：`selected_chapter_id` 由悬停改，
 * 点击调 `_enter_chapter`）。详情栏里的「进入章节 / 出战」是同一件事的显式入口。
 *
 * 章节与关卡**没有解锁门槛**——旧版 `game/chapter_config.py` 里就没有，
 * 全部可点；规则层 `planStageLaunch` 也不拦。通关记录（`clearedStages`）
 * 只用来在海报上盖一个「已通关」。
 */
export interface CampaignSceneProps {
  readonly profile: ProfileState;
  readonly onNavigate: (route: RouteId) => void;
  /** 带着这一关的启动参数去战斗场景。 */
  readonly onLaunch: (launch: StageLaunch) => void;
}

export function CampaignScene({ profile, onNavigate, onLaunch }: CampaignSceneProps) {
  const chapters = useMemo(() => campaignChapters(), []);
  /*
    **「选中哪一张」与「进没进去」是两件事，必须分开存。**

    早先用一个 `chapterIndex` 兼两用，于是悬停（选中）就等于进入那一章——
    鼠标扫过海报就跳进章节地图，截图里抓到的就是这个。
    现在：`enteredChapter` 决定这是世界地图还是章节地图；
    `focusChapter` / `focusStage` 只是右侧详情在看哪一个。
  */
  const [enteredChapter, setEnteredChapter] = useState<number | null>(null);
  const [focusChapter, setFocusChapter] = useState(0);
  const [focusStage, setFocusStage] = useState<number | null>(null);

  const cleared = useMemo(() => new Set(profile.campaign.clearedStages), [profile.campaign.clearedStages]);
  /**
   * 本屏内第几次开打。
   *
   * 它进 `battleId`（`stageBattleId` 的第三段），所以**每一次挑战都是新的一局**：
   * 输了重打、赢了再刷，都拿得到奖励；而「同一局的结算」仍然只能提交一次
   * （存档层按 battleId 去重）。早先这里写死 1，第二次挑战会撞上同一个 id，
   * 赢了也不发奖——那是个只在重打时才会出现的坑。
   */
  const launchSeq = useRef(0);
  const chapter = enteredChapter === null ? null : (chapters[enteredChapter] ?? null);

  // ESC：章节地图退回世界地图；已经在世界地图就回战斗菜单
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      if (enteredChapter !== null) {
        setEnteredChapter(null);
        setFocusStage(null);
      } else {
        onNavigate('battlemenu');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enteredChapter, onNavigate]);

  /** 点一关：先过规则层的启动校验，再带着参数去战斗。 */
  const launch = (stage: StageInfo): void => {
    const deck = activeDeckOf(profile);
    const result = planStageLaunch({
      profile,
      stageId: stage.id,
      chapterId: stage.chapterId,
      stageName: stage.name,
      playerDeck: deck?.cardIds ?? [],
      enemyDeck: stage.enemyDeck,
      rewardSpec: stage.reward,
      launchSeq: launchSeq.current + 1,
    });
    if ('rejected' in result) {
      pushToast(result.rejected, 'info');
      return;
    }
    if (result.clipped) {
      // 数据缺陷：旧版的 2-3 / 2-4 是 13 张，超过上限。裁了就要说出来
      pushToast(`${stage.id} 的敌方牌组超过 12 张，已裁到 ${result.enemyDeck.length} 张`, 'info');
    }
    launchSeq.current += 1;
    onLaunch(result);
  };

  /*
    背景：世界地图用 `bg/world_map`，进了章节用该章自己的 `bg/chapter_N_map`
    ——旧版的 `chapter_config.py` 里每章都配了一张（`bg_type`）。
  */
  const background = backgroundUrl(chapter ? `bg/${chapter.id}_map` : 'bg/world_map');

  return (
    <DesignStage backgroundUrl={background}>
      <div className="campaign__status">
        <LevelBar level={profile.level} />
        <CurrencyBar currencies={profile.currencies} />
      </div>

      <h1 className="campaign__title">{chapter ? chapter.name : '世界地图'}</h1>
      <p className="campaign__subtitle">
        {chapter ? '选择关卡（ESC 返回世界地图）' : '点击章节进入关卡'}
      </p>

      <button
        type="button"
        className="campaign__back"
        onClick={() => {
          if (enteredChapter !== null) {
            setEnteredChapter(null);
            setFocusStage(null);
            return;
          }
          onNavigate('battlemenu');
        }}
      >
        返回上一级
      </button>

      {chapter ? (
        <ChapterMap
          chapter={chapter}
          cleared={cleared}
          selected={focusStage}
          onSelect={setFocusStage}
          onLaunch={launch}
        />
      ) : (
        <WorldMap
          chapters={chapters}
          cleared={cleared}
          selected={focusChapter}
          onSelect={setFocusChapter}
          onEnter={(index) => {
            setEnteredChapter(index);
            setFocusChapter(index);
            setFocusStage(null);
          }}
        />
      )}

      <p className="campaign__foot">
        已通关 {cleared.size} / {stages.chapters.reduce((sum, c) => sum + c.stages.length, 0)} 关
      </p>
    </DesignStage>
  );
}

/** 世界地图：章节海报横排 + 右侧详情。 */
function WorldMap({
  chapters,
  cleared,
  selected,
  onSelect,
  onEnter,
}: {
  readonly chapters: readonly ChapterInfo[];
  readonly cleared: ReadonlySet<string>;
  readonly selected: number | null;
  readonly onSelect: (index: number) => void;
  readonly onEnter: (index: number) => void;
}) {
  const current = selected === null ? null : (chapters[selected] ?? null);

  return (
    <>
      <ul className="campaign__posters" aria-label="章节">
        {chapters.map((chapter, index) => {
          const done = chapter.stages.filter((stage) => cleared.has(stage.id)).length;
          return (
            <li key={chapter.id}>
              <button
                type="button"
                className={
                  index === selected ? 'campaign__poster campaign__poster--on' : 'campaign__poster'
                }
                data-chapter-id={chapter.id}
                /* 旧版：悬停就把右侧详情换成这一章，点击才进去 */
                onMouseEnter={() => onSelect(index)}
                onFocus={() => onSelect(index)}
                onClick={() => onEnter(index)}
              >
                <PosterArt posterId={chapter.posterId} label={chapter.name} />
                <span className="campaign__poster-name">{chapter.name}</span>
                <span className="campaign__poster-note">
                  {done} / {chapter.stages.length} 关
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <aside className="campaign__detail" aria-label="章节详情">
        {current ? (
          <>
            <h2 className="campaign__detail-title">{current.name}</h2>
            <p className="campaign__detail-line">{current.stages.length} 个关卡</p>
            <ul className="campaign__detail-list">
              {current.stages.map((stage) => (
                <li key={stage.id}>
                  {stage.id} {stage.name}
                  {cleared.has(stage.id) && <b className="campaign__done">已通关</b>}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onEnter(selected ?? 0)}
            >
              进入章节
            </button>
          </>
        ) : (
          <p className="campaign__detail-line">点一张章节海报看看里面有什么。</p>
        )}
      </aside>
    </>
  );
}

/** 章节地图：关卡海报从左下往右上排 + 右侧详情。 */
function ChapterMap({
  chapter,
  cleared,
  selected,
  onSelect,
  onLaunch,
}: {
  readonly chapter: ChapterInfo;
  readonly cleared: ReadonlySet<string>;
  readonly selected: number | null;
  readonly onSelect: (index: number) => void;
  readonly onLaunch: (stage: StageInfo) => void;
}) {
  const current = selected === null ? null : (chapter.stages[selected] ?? null);

  return (
    <>
      <ul className="campaign__posters campaign__posters--stage" aria-label="关卡">
        {chapter.stages.map((stage, index) => (
          <li key={stage.id} style={{ ['--index' as string]: index }}>
            <button
              type="button"
              className={
                index === selected ? 'campaign__poster campaign__poster--on' : 'campaign__poster'
              }
              data-stage-id={stage.id}
              /* 悬停就把右侧详情换成这一关（旧版也是悬停预览）；
                 开打在详情栏的「出战」上——不做双击开打，那是藏起来的操作 */
              onMouseEnter={() => onSelect(index)}
              onFocus={() => onSelect(index)}
              onClick={() => onLaunch(stage)}
            >
              <PosterArt posterId={stage.posterId} label={stage.name} />
              <span className="campaign__poster-name">
                {stage.id} {stage.name}
              </span>
              {cleared.has(stage.id) && <span className="campaign__poster-done">已通关</span>}
            </button>
          </li>
        ))}
      </ul>

      <aside className="campaign__detail" aria-label="关卡详情">
        {current ? (
          <>
            <h2 className="campaign__detail-title">
              {current.id} {current.name}
            </h2>
            {current.summary && <p className="campaign__detail-line">{current.summary}</p>}
            <p className="campaign__detail-line">
              敌方牌组 {current.enemyDeck.length} 张
              {current.enemyDeck.length === 0 && '（这一关没有配置）'}
            </p>
            <ul className="campaign__detail-list">
              <li>金币 {current.reward?.gold ?? 0}</li>
              <li>经验 {current.reward?.xp ?? 0}</li>
              {(current.reward?.items ?? []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn--primary"
              disabled={current.enemyDeck.length === 0}
              onClick={() => onLaunch(current)}
            >
              出战
            </button>
          </>
        ) : (
          <p className="campaign__detail-line">点一张关卡海报，看它的奖励与敌方牌组。</p>
        )}
      </aside>
    </>
  );
}

/** 海报图；manifest 里没有就退回一块带名字的底板。 */
function PosterArt({ posterId, label }: { readonly posterId: string | null; readonly label: string }) {
  const url = posterId ? posterUrl(posterId) : null;
  if (!url) {
    return (
      <span className="campaign__poster-plate" aria-hidden="true">
        {label}
      </span>
    );
  }
  return <img className="campaign__poster-art" src={url} alt="" draggable={false} />;
}
