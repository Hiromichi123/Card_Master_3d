import '../ui/mazeLayers.css';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { cardById } from '../data';
import { backgroundUrl, cardFaceUrl } from '../data/assets';
import { createRng, seedFrom } from '../domain/battle/rng';
import {
  MAZE_FLOOR_1,
  canMoveTo,
  exploredRatio,
  generateMaze,
  isMazeCleared,
  mazeDeckSize,
  mazeRngFor,
  mazeRewardPreview,
  mazeShopBatchKey,
  newMazeRun,
  previewStrength,
} from '../domain/progression/maze';
import type { MazeNode } from '../domain/progression/maze';
import { activeDeckOf } from '../domain/progression/profile';
import type { MazeRunState, ProfileState } from '../domain/progression/types';
import type { EconomicResult, ProfileStore } from '../state/createProfileStore';
import { pushToast } from '../state/toastStore';
import { PlayerStatus } from '../ui/PlayerStatus';
import { DesignStage } from '../ui/DesignStage';
import { MazeNodeIcon } from '../ui/MazeNodeIcon';
import {
  LEGEND_ORDER,
  MAZE_FOCUS,
  MAZE_MOVE_MS,
  MAZE_PERSPECTIVE,
  MAZE_TILE,
  MAZE_TILE_DEPTH,
  MAZE_TILT_DEG,
  NODE_STYLE,
  UNEXPLORED_VEIL,
  frontFaceOf,
  lerpPoint,
  mapBounds,
  projectNode,
  projectToScreen,
  withAlpha,
} from './mazeLayout';
import type { GridPoint } from './mazeLayout';
import { mazeShopStock, mazeEventCards, planMazeEnter, planMazeMove, planMazeReset, planMazeLaunch, planMazePurchase, planMazeRefresh } from './mazeFlow';
import { mazeFailureRemaining, mazeProgressToken, mazeResetRemaining } from '../domain/progression/mazeProgress';
import type { MazeLaunch, MazeShopSlot } from './mazeFlow';
import type { RouteId } from '../app/routes';

/**
 * 世界树迷宫第一层。保留既有探索规则与倾斜地图：
 *
 * - 背景 `bg/activity`，标题「世界树迷宫·第一层」与副标题位于屏幕中线上；
 * - 地图是一张**倾斜的平面**：每个节点是一块带厚度的方片，
 *   连线在平面内，节点名字与玩家光球画在**屏幕空间**（跟着平面一起算投影）；
 * - 左上货币与等级、其下图例；左下「清空探索记录」、右下「返回活动大厅」；
 * - 右侧详情 / 商店共用可收起侧栏，默认收起，只有手动按钮控制可见性。
 *
 * ## 与旧版有意不同的三处
 *
 * 1. **平面是斜的、方块是真的立体**（清单要求「倾斜节点场景」）。
 *    旧版是正对屏幕 + 假前脸；这里用 CSS 3D 的 `perspective` + `rotateX`。
 *    代价是标签必须自己算投影才能与格子对齐，见 `mazeLayout.projectToScreen`。
 * 2. **旧版那条「连线冻结」的 bug 不复现**：它把连线缓存成整屏位图、
 *    只在换图时置脏，于是走动时节点在动、连线不动。这里连线是平面内的 SVG，
 *    每帧跟 `transform` 一起走，不存在这个问题。
 * 3. **不写 `temp_deck.json`**：敌牌组现生成、直接进内存（见 `mazeFlow`）。
 *
 * 交互照旧版：**两次点击确认**——第一次点相邻节点看详情，再点同一个才出发；
 * 点到不可达的节点只是取消选中，不给提示（旧版也是这样）。
 * 到达后按类型分流：战斗节点开打，补给节点准备货架但不弹出侧栏，入口不触发事件。
 */
export interface MazeSceneProps {
  readonly profile: ProfileState;
  readonly store: ProfileStore;
  readonly onNavigate: (route: RouteId) => void;
  readonly onLaunch: (launch: MazeLaunch) => void;
}

/** 设计单位 → CSS 长度。整个屏幕只有 `--ui` 一个缩放系数（见 `DesignStage`）。 */
function u(value: number): string {
  return `calc(${value} * var(--ui))`;
}

const DETAIL_HINT: Readonly<Record<MazeNode['type'], string>> = {
  entry: '安全区域',
  normal: '普通奖励',
  elite: '稀有战利品',
  boss: '进入下一层',
  supply: '补给资源',
};

/**
 * 玩家光球在屏幕上的位置（设计单位）。
 *
 * 镜头永远把玩家摆在取景点上（`mazeLayout.MAZE_FOCUS`），所以光球的位置
 * 是个常量：只要算出「离面 `ORB_HEIGHT` 高的一点」在屏幕上比平面点高多少。
 */
const ORB_HEIGHT = MAZE_TILE_DEPTH + 26;
const ORB = projectToScreen({ x: 0, y: 0, z: ORB_HEIGHT }, { x: 0, y: 0 });

export function MazeScene({ profile, store, onNavigate, onLaunch }: MazeSceneProps) {
  const floorRun = profile.mazeRun?.floorKey === MAZE_FLOOR_1 ? profile.mazeRun : null;
  const [run, setRun] = useState<MazeRunState>(() => floorRun ?? newMazeRun(
    generateMaze(mazeRngFor(MAZE_FLOOR_1, 1)), MAZE_FLOOR_1, 1,
  ));
  const version = run.version;
  const map = useMemo(() => generateMaze(mazeRngFor(MAZE_FLOOR_1, version)), [version]);
  const nodeById = useMemo(() => new Map(map.nodes.map((node) => [node.id, node])), [map]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const savedRun = snapshot.profile?.mazeRun ?? floorRun;
  // 购买与刷新只更新 store；同一轮货架使用最新已落盘状态。
  const shopRun: MazeRunState = savedRun?.floorKey === run.floorKey && savedRun.version === run.version
    ? { ...run, shopByNode: { ...run.shopByNode, ...savedRun.shopByNode } }
    : run;

  const [camera, setCamera] = useState<GridPoint>(() => {
    const node = nodeById.get(run.playerNodeId) ?? map.nodes[map.entryId];
    return projectNode(node?.grid ?? [0, 0]);
  });
  const [move, setMove] = useState<{
    readonly from: GridPoint;
    readonly to: GridPoint;
    readonly targetId: number;
    readonly start: number;
    readonly operationId: string;
    readonly expectedToken: string;
  } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [shopNode, setShopNode] = useState<number | null>(() =>
    nodeById.get(run.playerNodeId)?.type === 'supply' ? run.playerNodeId : null,
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const economicLock = useRef(false);
  const [saving, setSaving] = useState(true);
  const [ready, setReady] = useState(false);
  const [today, setToday] = useState(() => store.todayKey());
  const busy = snapshot.busy || buying !== null || refreshing || saving || !ready;
  const launchSeq = useRef(0);
  const mounted = useRef(true);
  const initTicket = useRef(0);
  const initialization = useRef<Promise<EconomicResult<{ run: MazeRunState; rewardCardIds: readonly string[] }>> | null>(null);
  const activeProfile = snapshot.profile ?? profile;
  const progress = activeProfile.mazeProgress;
  const resetRemaining = mazeResetRemaining(progress, today);
  const failureRemaining = mazeFailureRemaining(progress, today);

  // `run.playerNodeId` 一定在图里（位置只由 `applyMove` 改，目标来自这张图）；
  // 落盘值被外部改坏时退回入口，别让整屏炸掉
  const playerNode = nodeById.get(run.playerNodeId) ?? map.nodes[map.entryId]!;
  const explored = useMemo(() => new Set(run.exploredNodeIds), [run.exploredNodeIds]);
  const bossCleared = isMazeCleared(activeProfile.settledBattleIds, run.floorKey, run.version);

  const reportRewards = (cards: readonly string[]): void => {
    for (const cardId of cards) pushToast(`探索保底获得：${cardById.get(cardId)?.name ?? cardId}`, 'info');
  };
  const restoreRun = (next: MazeRunState): void => {
    const nextMap = generateMaze(mazeRngFor(next.floorKey, next.version));
    setRun(next);
    setCamera(projectNode(nextMap.nodes[next.playerNodeId]!.grid));
    setSelected(null);
    setHovered(null);
    setShopNode(nextMap.nodes[next.playerNodeId]?.type === 'supply' ? next.playerNodeId : null);
  };
  const initialize = async (): Promise<void> => {
    const ticket = ++initTicket.current;
    setSaving(true);
    // StrictMode effect重放共用同一笔提交，不重复初始化或补发。
    initialization.current ??= store.commitEconomic(current => planMazeEnter({
      profile: current, operationId: store.nextOperationId(), dayKey: store.todayKey(),
    }));
    const result = await initialization.current;
    if (!mounted.current || ticket !== initTicket.current) return;
    if (result.ok) {
      restoreRun(result.view.run);
      reportRewards(result.view.rewardCardIds);
      setReady(true);
    } else {
      initialization.current = null;
      pushToast(result.message, 'error');
    }
    setSaving(false);
  };
  useEffect(() => {
    mounted.current = true;
    void initialize();
    return () => { mounted.current = false; };
    // 首次进入使用受控事务，之后移动和重开各自原子保存。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const update = (): void => setToday(store.todayKey());
    const timer = window.setInterval(update, 30_000);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [store]);

  /** 移动动画：线性插值、每帧把镜头拉到插值点（旧版 `update` 里就是这么做的）。 */
  useEffect(() => {
    if (!move) {
      return;
    }
    let frame = 0;
    const step = (now: number): void => {
      const t = Math.min(1, (now - move.start) / MAZE_MOVE_MS);
      setCamera(lerpPoint(move.from, move.to, t));
      if (t < 1) {
        frame = requestAnimationFrame(step);
        return;
      }
      void arrive(move.targetId, move.expectedToken, move.operationId);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // `arrive` 每次渲染都是新的，但它只读这一帧的状态；把 move 当唯一触发源
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move]);

  /** 到达只提交一次：位置、探索计数和保底卡全部写入成功后才开战。 */
  const arrive = async (nodeId: number, expectedToken: string, operationId: string): Promise<void> => {
    if (economicLock.current || !mounted.current) return;
    economicLock.current = true;
    setSaving(true);
    try {
      const result = await store.commitEconomic(current => planMazeMove({
        profile: current, dayKey: store.todayKey(), nodeId, expectedToken, operationId,
      }));
      if (!mounted.current) return;
      const currentProfile = store.getSnapshot().profile!;
      if (!result.ok) {
        if (currentProfile.mazeRun) restoreRun(currentProfile.mazeRun);
        pushToast(result.message, 'error');
        return;
      }
      restoreRun(result.view.run);
      reportRewards(result.view.rewardCardIds);
      const node = nodeById.get(nodeId);
      if (node && node.type !== 'entry' && node.type !== 'supply') {
        launchBattle(node, result.view.run, currentProfile);
      }
    } finally {
      economicLock.current = false;
      if (mounted.current) { setSaving(false); setMove(null); }
    }
  };

  /** 开打：把这一局的参数交给 `App`（与战役走同一条管道）。 */
  const launchBattle = (node: MazeNode, currentRun: MazeRunState, currentProfile: ProfileState): void => {
    if (node.type === 'boss' && isMazeCleared(currentProfile.settledBattleIds, currentRun.floorKey, currentRun.version)) {
      pushToast('本层的 Boss 奖励已经领过，再打不会再发', 'info');
    }
    launchSeq.current += 1;
    const result = planMazeLaunch({
      profile: currentProfile, dayKey: store.todayKey(),
      run: currentRun,
      explored: exploredRatio(map, currentRun),
      node,
      playerDeck: activeDeckOf(currentProfile)?.cardIds ?? [],
      launchSeq: launchSeq.current,
    });
    if ('rejected' in result) {
      pushToast(result.rejected, 'info');
      return;
    }
    if (result.clipped) {
      pushToast(`敌方牌组超过 12 张，已裁到 ${result.enemyDeck.length} 张`, 'info');
    }
    onLaunch(result);
  };

  const clickNode = (nodeId: number): void => {
    if (move || busy || economicLock.current || store.getSnapshot().busy) return;
    if (failureRemaining <= 0) { pushToast('失败机会已耗尽，每天恢复1点，最多存储3点', 'info'); return; }
    if (nodeId === run.playerNodeId) {
      setSelected(null);
      if (playerNode.type === 'supply') setShopNode(nodeId);
      return;
    }
    if (!canMoveTo(map, run.playerNodeId, nodeId)) {
      setSelected(null);
      return;
    }
    if (selected !== nodeId) {
      setSelected(nodeId);
      setShopNode(null);
      return;
    }
    const target = nodeById.get(nodeId);
    if (!target) {
      return;
    }
    setMove({
      from: projectNode(playerNode.grid),
      to: projectNode(target.grid),
      targetId: nodeId,
      start: performance.now(),
      operationId: store.nextOperationId(),
      expectedToken: mazeProgressToken(store.getSnapshot().profile!),
    });
  };

  /** 「清空探索记录」= 开新一轮（生成算法版本不变、`version + 1` 换一张图）。 */
  const resetRun = async (): Promise<void> => {
    if (move || busy || economicLock.current || store.getSnapshot().busy) return;
    economicLock.current = true;
    setSaving(true);
    const operationId = store.nextOperationId();
    const expectedToken = mazeProgressToken(store.getSnapshot().profile!);
    try {
      const result = await store.commitEconomic(current => planMazeReset({
        profile: current, dayKey: store.todayKey(), expectedToken, operationId,
      }));
      if (!mounted.current) return;
      setToday(store.todayKey());
      if (!result.ok) { pushToast(result.message, 'error'); return; }
      restoreRun(result.view.run);
      reportRewards(result.view.rewardCardIds);
      pushToast('已清空本轮探索，本周剩余 0/1；保底进度已保留', 'info');
    } finally {
      economicLock.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const buy = async (nodeId: number, slot: MazeShopSlot): Promise<void> => {
    if (move || busy || economicLock.current || store.getSnapshot().busy || slot.entry.soldOut) return;
    economicLock.current = true;
    const operationId = store.nextOperationId();
    const expectedBatch = mazeShopBatchKey(shopRun, nodeId);
    setBuying(slot.entry.entryId);
    try {
      const outcome = await store.commitEconomic((current) =>
        planMazePurchase({
          profile: current,
          nodeId,
          entry: slot.entry,
          expectedBatch,
          operationId,
          // 迷宫货架没有礼包（`kind` 恒为 `card`），这个随机源用不上，给一条确定的
          rng: createRng(seedFrom(operationId)),
        }),
      );
      if (!outcome.ok) {
        pushToast(outcome.message, 'error');
      }
    } finally {
      economicLock.current = false;
      setBuying(null);
    }
  };

  const refresh = async (nodeId: number): Promise<void> => {
    if (move || busy || economicLock.current || store.getSnapshot().busy) return;
    economicLock.current = true;
    setRefreshing(true);
    const operationId = store.nextOperationId();
    const expectedBatch = mazeShopBatchKey(shopRun, nodeId);
    try {
      const outcome = await store.commitEconomic((current) => planMazeRefresh({
        profile: current, nodeId, expectedBatch, operationId,
      }));
      if (!outcome.ok) pushToast(outcome.message, 'error');
    } finally {
      economicLock.current = false;
      setRefreshing(false);
    }
  };

  const planes = useMemo(
    () => map.nodes.map((node) => ({ node, point: projectNode(node.grid) })),
    [map],
  );
  const bounds = useMemo(() => mapBounds(map.nodes.map((node) => node.grid)), [map]);

  return (
    <DesignStage className="maze-menu" backgroundUrl={backgroundUrl('bg/activity')}>
      <div className="maze__left-rail">
        <div className="maze__status">
          <PlayerStatus level={activeProfile.level} currencies={activeProfile.currencies} />
        </div>
        <ul className="maze__legend" aria-label="图例">
          {LEGEND_ORDER.map((type) => (
            <li key={type}>
              <span className="maze__legend-icon" style={{ color: NODE_STYLE[type].color }}><MazeNodeIcon type={type} /></span>
              {NODE_STYLE[type].label}
            </li>
          ))}
        </ul>
        <EventShowcase />
      </div>

      <h1 className="maze__title">世界树迷宫·第一层</h1>
      <p className="maze__subtitle">
        点击相邻节点前进，再点一次确认；探索记录会自动保存
        {bossCleared && <b className="maze__cleared">本层已通关</b>}
      </p>

      <div
        className="maze__view"
        /*
          三个几何常量只写在 `mazeLayout` 里，CSS 通过变量读——
          否则「倾角改了但透视还按老值算」这种错误只会表现为「标签慢慢对不上格子」。
        */
        style={{
          ['--maze-perspective' as string]: MAZE_PERSPECTIVE,
          ['--maze-tilt' as string]: MAZE_TILT_DEG,
          ['--maze-focus-x' as string]: MAZE_FOCUS.x,
          ['--maze-focus-y' as string]: MAZE_FOCUS.y,
        }}
      >
        <div className="maze__tilt">
          <div
            className="maze__plane"
            style={{ transform: `translate(${u(-camera.x)}, ${u(-camera.y)})` }}
          >
            <svg
              className="maze__links"
              aria-hidden="true"
              viewBox={`${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`}
              style={{
                left: u(bounds.minX),
                top: u(bounds.minY),
                width: u(bounds.maxX - bounds.minX),
                height: u(bounds.maxY - bounds.minY),
              }}
            >
              {map.nodes.flatMap((node) =>
                node.neighbors
                  .filter((neighbor) => neighbor > node.id)
                  .map((neighbor) => {
                    const other = nodeById.get(neighbor);
                    if (!other) {
                      return null;
                    }
                    const from = projectNode(node.grid);
                    const to = projectNode(other.grid);
                    return (
                      <line
                        key={`${node.id}-${neighbor}`}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        className="maze__link"
                      />
                    );
                  }),
              )}
            </svg>

            {planes.map(({ node, point }) => (
              <MapTile
                key={node.id}
                node={node}
                point={point}
                explored={explored.has(node.id)}
                selected={selected === node.id}
                hovered={hovered === node.id}
                current={node.id === run.playerNodeId}
                reachable={failureRemaining > 0 && !move && !busy && canMoveTo(map, run.playerNodeId, node.id)}
                disabled={failureRemaining <= 0 || !!move || busy}
                done={node.type === 'boss' && bossCleared}
                onHover={setHovered}
                onClick={clickNode}
              />
            ))}
          </div>
        </div>

        {/* 屏幕空间：节点名字与玩家光球。位置由 `projectToScreen` 现算，
            与上面那层的 CSS 3D 是同一套数学，所以会跟着贴合 */}
        <div className="maze__float">
          {planes.map(({ node, point }) => {
            const anchor = projectToScreen({ x: point.x, y: point.y + MAZE_TILE / 2 }, camera);
            const style = NODE_STYLE[node.type];
            return (
              <span
                key={node.id}
                className={explored.has(node.id) ? 'maze__label' : 'maze__label maze__label--dim'}
                style={{ left: u(anchor.x), top: u(anchor.y), zIndex: 1000 + Math.round(anchor.depth) }}
              >
                {style.label}
              </span>
            );
          })}
          {/*
            光球**恒在取景点上**：镜头就是玩家所在的那个点，
            所以它不需要跟着插值走，只要按离面高度算一次投影。
          */}
          <span className="maze__orb" style={{ left: u(ORB.x), top: u(ORB.y) }} aria-hidden="true" />
        </div>
      </div>

      <p className="maze__failure-chances" role="status">失败机会 {failureRemaining}/3 · 每天获得1点，最多存储3点 · 战败或中途退出扣1点{failureRemaining === 0 ? ' · 机会耗尽，暂不可移动' : ''}</p>
      <button type="button" className="btn maze__reset" disabled={!!move || busy || resetRemaining === 0}
        title="每周一恢复1次，清空不影响活动卡保底进度" onClick={() => void resetRun()}>
        清空探索记录 · 本周剩余 {resetRemaining}/1
        <small>{resetRemaining === 0 ? '下周一恢复 · 保底进度保留' : '每周一次 · 保底进度保留'}</small>
      </button>
      {!ready && !saving && (
        <button type="button" className="btn maze__retry" onClick={() => void initialize()}>重新载入迷宫</button>
      )}
      <button type="button" className="maze__back" disabled={!!move || snapshot.busy || saving || buying !== null || refreshing} onClick={() => onNavigate('activity')}>
        返回活动大厅
      </button>

      <p className="maze__foot">
        探索度 {Math.round(exploredRatio(map, run) * 100)}% · 已探索 {run.exploredNodeIds.length} /{' '}
        {map.nodes.length} 个节点
      </p>

      <aside className="maze__pity" aria-label="活动卡保底">
        <div className="maze__pity-heading">
          <strong>活动卡保底</strong><span>{Math.min(progress.explorationCount, 100)} / 100</span>
        </div>
        <div className="maze__pity-bar" role="progressbar" aria-label="探索保底进度"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(progress.explorationCount, 100)}>
          <span style={{ width: `${Math.min(progress.explorationCount, 100)}%` }} />
        </div>
        <p>每首次探索一格 +1，满100随机获得一张当期活动卡。</p>
        <p>往返不计 · 跨周和清空保留</p>
        {progress.explorationCount >= 100 && <p className="maze__pity-pending">已累计 {progress.explorationCount} 次，等待活动卡池恢复后补发。</p>}
        {progress.lastRewardCardId && <p className="maze__pity-reward">最近获得：{cardById.get(progress.lastRewardCardId)?.name ?? progress.lastRewardCardId}</p>}
      </aside>

      <button type="button" className="btn maze__sidebar-toggle"
        aria-expanded={sidebarOpen} aria-controls="maze-sidebar"
        onClick={() => setSidebarOpen((open) => !open)}>
        {sidebarOpen ? '收起提示 ›' : shopNode !== null ? '‹ 打开商店' : '‹ 展开提示'}
      </button>
      <div id="maze-sidebar" className="maze__sidebar" hidden={!sidebarOpen}>
        {sidebarOpen && (shopNode === null ? (
          <NodeDetail
            node={selected === null ? null : (nodeById.get(selected) ?? null)}
            explored={selected !== null && explored.has(selected)}
            exploredRatioValue={exploredRatio(map, run)}
          />
        ) : (
          <FloorShop
            run={shopRun}
            nodeId={shopNode}
            busy={busy || !!move}
            refreshing={refreshing}
            onBuy={(slot) => void buy(shopNode, slot)}
            onRefresh={() => void refresh(shopNode)}
            onClose={() => setSidebarOpen(false)}
          />
        ))}
      </div>

    </DesignStage>
  );
}

/** 一块方片：顶面 + 南侧立面。顶面抬高 `MAZE_TILE_DEPTH`，立面从顶面南沿垂到平面上。 */
function MapTile({
  node,
  point,
  explored,
  selected,
  hovered,
  current,
  reachable,
  disabled,
  done,
  onHover,
  onClick,
}: {
  readonly node: MazeNode;
  readonly point: GridPoint;
  readonly explored: boolean;
  readonly selected: boolean;
  readonly hovered: boolean;
  readonly current: boolean;
  /** 一步可达；样式和测试定位均使用此状态。 */
  readonly reachable: boolean;
  readonly disabled: boolean;
  readonly done: boolean;
  readonly onHover: (id: number | null) => void;
  readonly onClick: (id: number) => void;
}) {
  const style = NODE_STYLE[node.type];
  const front = frontFaceOf(style.color, style.alpha);
  const classes = ['maze__tile'];
  if (explored) classes.push('maze__tile--explored');
  if (reachable) classes.push('maze__tile--reachable');
  if (selected) {
    classes.push('maze__tile--selected');
  }
  if (hovered) {
    classes.push('maze__tile--hovered');
  }
  if (current) {
    classes.push('maze__tile--current');
  }

  return (
    <button
      type="button"
      className={classes.join(' ')}
      data-node-id={node.id}
      data-node-type={node.type}
      data-reachable={reachable ? 'true' : 'false'}
      data-current={current ? 'true' : 'false'}
      data-explored={explored ? 'true' : 'false'}
      disabled={disabled}
      aria-label={`${style.label} 节点 #${node.id} · ${explored ? '已探索' : '未探索'}${done ? ' · 已通关' : ''}`}
      style={{
        left: u(point.x),
        top: u(point.y),
        ['--tile-accent' as string]: style.color,
        ['--tile-top' as string]: withAlpha(style.color, style.alpha),
        ['--tile-front' as string]: withAlpha(front.color, front.alpha),
      }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick(node.id)}
    >
      <span className="maze__tile-front" aria-hidden="true" />
      <span className="maze__tile-top" aria-hidden="true">
        {!explored && (
          <span className="maze__tile-veil" style={{ background: UNEXPLORED_VEIL }} aria-hidden="true" />
        )}
        <span className="maze__tile-emblem"><MazeNodeIcon type={node.type} /></span>
        {explored && <span className="maze__tile-complete" title="已探索"><MazeNodeIcon type="complete" /></span>}
        {done && <span className="maze__tile-done">已通关</span>}
      </span>
    </button>
  );
}

/** 右侧详情栏。旧版是 `PosterDetailPanel`（纯展示、没有按钮）。 */
function NodeDetail({
  node,
  explored,
  exploredRatioValue,
}: {
  readonly node: MazeNode | null;
  readonly explored: boolean;
  readonly exploredRatioValue: number;
}) {
  if (!node) {
    return (
      <aside className="maze__detail" aria-label="节点详情">
        <p className="maze__detail-line">点一个相邻的节点看看它是什么。</p>
      </aside>
    );
  }
  const style = NODE_STYLE[node.type];
  const battle = node.type === 'normal' || node.type === 'elite' || node.type === 'boss';
  const strength = previewStrength(node.type, exploredRatioValue);

  return (
    <aside className="maze__detail" aria-label="节点详情" data-node-id={node.id}>
      <h2 className="maze__detail-title"><MazeNodeIcon type={node.type} />{style.label}</h2>
      <p className="maze__detail-sub">节点 #{node.id}</p>
      <p className="maze__detail-line">
        类型：{style.label} · 状态：{explored ? '已探索' : '未探索'}
        {battle && ` · 预估强度系数：${strength.toFixed(2)}`}
      </p>
      <ul className="maze__detail-tags">
        <li>{style.label}</li>
        <li>相邻 {node.neighbors.length} 格</li>
      </ul>
      <h3 className="maze__detail-head">奖励：</h3>
      {battle ? (
        <ul className="maze__detail-list">
          <li>敌方牌组约 {mazeDeckSize(strength)} 张</li>
          {mazeRewardPreview({ nodeType: node.type, strength }).lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <ul className="maze__detail-list">
          <li>{DETAIL_HINT[node.type]}</li>
        </ul>
      )}
    </aside>
  );
}

function priceText(price: MazeShopSlot['item']['price']): string {
  return `${price.amount} ${price.currency === 'gold' ? '金币' : price.currency === 'crystal' ? '水晶' : '徽章'}`;
}

/** 楼层商店，与节点详情共用手动收展的侧栏。 */
function FloorShop({
  run,
  nodeId,
  busy,
  refreshing,
  onBuy,
  onRefresh,
  onClose,
}: {
  readonly run: MazeRunState;
  readonly nodeId: number;
  readonly busy: boolean;
  readonly refreshing: boolean;
  readonly onBuy: (slot: MazeShopSlot) => void;
  readonly onRefresh: () => void;
  readonly onClose: () => void;
}) {
  const stock = useMemo(() => mazeShopStock(run, nodeId), [run, nodeId]);

  return (
    <aside className="maze__detail maze__shop" aria-label="楼层商店" data-shop-node={nodeId}>
      <h2 className="maze__detail-title"><MazeNodeIcon type="supply" />树荫商店</h2>
      <p className="maze__detail-sub">补给点 #{nodeId} · 本批 {stock.length} 张卡牌</p>
      <p className="maze__detail-line">每次刷新 3–5 张。八折 30% · 半价 15% · 1金币 5%，每张独立抽取，不叠加。</p>
      <button type="button" className="btn maze__shop-refresh" disabled={busy} onClick={onRefresh}>
        {refreshing ? '正在保存…' : '免费刷新'}
      </button>
      <p className="maze__shop-note">只有手动刷新才换货，离开后保留本批与售罄记录。</p>
      <ul className="maze__shop-list">
        {stock.map((slot) => {
          const card = cardById.get(slot.item.cardId);
          const face = cardFaceUrl(slot.item.cardId, 'thumbnail');
          return (
            <li key={slot.entry.entryId} className={`maze__shop-item${slot.entry.soldOut ? ' maze__shop-item--sold' : ''}`}
              data-entry-id={slot.entry.entryId} data-discount={slot.item.discount}>
              <span
                className="maze__shop-face"
                data-card-id={slot.item.cardId}
                style={{ ['--rarity' as string]: withAlpha(NODE_STYLE.supply.color, 255) }}
              >
                {face ? <img src={face} alt="" draggable={false} /> : <i>{slot.item.cardId}</i>}
              </span>
              <span className="maze__shop-info">
                <b>{card?.name ?? slot.item.cardId}</b>
                <em>{slot.item.rarity} · {slot.item.label}</em>
                {slot.item.discount !== 'none' && <>
                  <span className={`maze__discount maze__discount--${slot.item.discount}`}>
                    {slot.item.discount === 'twenty' ? '-20%' : slot.item.discount === 'half' ? '-50% · 半价' : '-99% · 1金币'}
                  </span>
                  <del className="maze__shop-original">{priceText(slot.item.originalPrice)}</del>
                </>}
              </span>
              <button
                type="button"
                className="btn maze__shop-buy"
                disabled={slot.entry.soldOut || busy}
                onClick={() => onBuy(slot)}
              >
                {slot.entry.soldOut
                  ? '已售罄'
                  : priceText(slot.item.price)}
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn maze__shop-close" onClick={onClose}>
        回到地图
      </button>
    </aside>
  );
}

/** 图例下方的活动卡展示，每15秒轮换；与保底共用卡池，悬停详情走全局 CardTipHost。 */
function EventShowcase() {
  const cards = useMemo(() => mazeEventCards(), []);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (cards.length <= 1) {
      return undefined;
    }
    const timer = setInterval(() => setIndex((current) => (current + 1) % cards.length), 15_000);
    return () => clearInterval(timer);
  }, [cards.length]);

  const cardId = cards[index];
  const face = cardId ? cardFaceUrl(cardId, 'battle') : null;
  if (!cardId || !face) {
    return null;
  }
  return (
    <section className="maze__showcase" aria-label="当期活动卡牌">
      <h2>当期活动卡牌</h2>
      <div className="maze__showcase-card" data-card-id={cardId}>
        <img src={face} alt={cardById.get(cardId)?.name ?? cardId} draggable={false} />
      </div>
    </section>
  );
}
