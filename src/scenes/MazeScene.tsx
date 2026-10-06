import { useEffect, useMemo, useRef, useState } from 'react';

import { cardById, cardDatabase } from '../data';
import { backgroundUrl, cardFaceUrl } from '../data/assets';
import { createRng, seedFrom } from '../domain/battle/rng';
import {
  MAZE_EVENT_RARITY,
  MAZE_FLOOR_1,
  applyMove,
  canMoveTo,
  exploredRatio,
  generateMaze,
  isMazeCleared,
  mazeDeckSize,
  mazeRngFor,
  mazeRewardPreview,
  newMazeRun,
  previewStrength,
  withShopState,
} from '../domain/progression/maze';
import type { MazeNode } from '../domain/progression/maze';
import { activeDeckOf } from '../domain/progression/profile';
import type { MazeRunState, ProfileState } from '../domain/progression/types';
import type { ProfileStore } from '../state/createProfileStore';
import { pushToast } from '../state/toastStore';
import { CurrencyBar } from '../ui/CurrencyBar';
import { DesignStage } from '../ui/DesignStage';
import { LevelBar } from '../ui/LevelBar';
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
import { mazeShopStock, planMazeLaunch, planMazePurchase } from './mazeFlow';
import type { MazeLaunch, MazeShopSlot } from './mazeFlow';
import type { RouteId } from '../app/routes';

/**
 * 迷宫第一层。1:1 照旧版 `scenes/activity/maze_scene.py`：
 *
 * - 背景 `bg/activity`，标题「迷宫挑战·第一层」@8%、副标题 @13%，都在屏幕中线上；
 * - 地图是一张**倾斜的平面**：每个节点是一块带厚度的方片，
 *   连线在平面内，节点名字与玩家光球画在**屏幕空间**（跟着平面一起算投影）；
 * - 左上货币与等级、其下图例；左下「清空探索记录」、右下「返回活动大厅」；
 * - 右侧 (72%, 10%, 24% × 80%) 是详情栏（点中的节点 / 楼层商店）。
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
 * 到达后按节点类型分流：战斗节点直接开打，补给节点开楼层商店，入口什么都不做。
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
  const version = floorRun?.version ?? 1;
  const map = useMemo(() => generateMaze(mazeRngFor(MAZE_FLOOR_1, version)), [version]);
  const nodeById = useMemo(() => new Map(map.nodes.map((node) => [node.id, node])), [map]);

  /**
   * 屏内的 run 状态。
   *
   * **位置与探索以这里为准**（走一步就立刻改，不等 300ms 的防抖落盘），
   * **货架售罄以存档为准**（购买是事务，落盘后 `mazeRun.shopByNode` 才是权威）——
   * 两者在下面 `shopRun` 里拼起来。只用 `profile.mazeRun` 会让镜头滞后，
   * 只用屏内状态会让刚买的东西还能再买一次。
   */
  const [run, setRun] = useState<MazeRunState>(
    () => floorRun ?? newMazeRun(map, MAZE_FLOOR_1, version),
  );
  const shopRun: MazeRunState = floorRun ? { ...run, shopByNode: floorRun.shopByNode } : run;

  const [camera, setCamera] = useState<GridPoint>(() => {
    const node = nodeById.get(run.playerNodeId) ?? map.nodes[map.entryId];
    return projectNode(node?.grid ?? [0, 0]);
  });
  const [move, setMove] = useState<{
    readonly from: GridPoint;
    readonly to: GridPoint;
    readonly targetId: number;
    readonly start: number;
  } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [shopNode, setShopNode] = useState<number | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const launchSeq = useRef(0);

  // `run.playerNodeId` 一定在图里（位置只由 `applyMove` 改，目标来自这张图）；
  // 落盘值被外部改坏时退回入口，别让整屏炸掉
  const playerNode = nodeById.get(run.playerNodeId) ?? map.nodes[map.entryId]!;
  const explored = useMemo(() => new Set(run.exploredNodeIds), [run.exploredNodeIds]);
  const bossCleared = isMazeCleared(profile.settledBattleIds, run.floorKey, run.version);

  // 第一次进来时把初始 run 落盘（旧版进场景也会建那个 json）
  useEffect(() => {
    if (!floorRun) {
      store.saveMazeRun(run);
    }
    // 只在挂载时做一次：之后每次移动都会自己写
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setMove(null);
      arrive(move.targetId);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // `arrive` 每次渲染都是新的，但它只读这一帧的状态；把 move 当唯一触发源
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move]);

  /** 落地：改位置、并入探索集、写盘，然后按节点类型分流。 */
  const arrive = (nodeId: number): void => {
    const next = applyMove(map, run, nodeId);
    const node = nodeById.get(nodeId);
    if (node?.type === 'supply') {
      const withShop = withShopState(next, nodeId);
      setRun(withShop);
      store.saveMazeRun(withShop);
      setShopNode(nodeId);
      return;
    }
    setRun(next);
    store.saveMazeRun(next);
    setSelected(null);
    if (node && node.type !== 'entry') {
      launchBattle(node, next);
    }
  };

  /** 开打：把这一局的参数交给 `App`（与战役走同一条管道）。 */
  const launchBattle = (node: MazeNode, currentRun: MazeRunState): void => {
    if (node.type === 'boss' && isMazeCleared(profile.settledBattleIds, currentRun.floorKey, currentRun.version)) {
      pushToast('本层的 Boss 奖励已经领过，再打不会再发', 'info');
    }
    launchSeq.current += 1;
    const result = planMazeLaunch({
      profile,
      run: currentRun,
      explored: exploredRatio(map, currentRun),
      node,
      playerDeck: activeDeckOf(profile)?.cardIds ?? [],
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
    if (move) {
      return;
    }
    if (nodeId === run.playerNodeId || !canMoveTo(map, run.playerNodeId, nodeId)) {
      // 旧版：点自己、点不可达节点都只是取消选中，不给提示
      setSelected(null);
      return;
    }
    if (selected !== nodeId) {
      setSelected(nodeId);
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
    });
  };

  /** 「清空探索记录」= 开新一轮（生成算法版本不变、`version + 1` 换一张图）。 */
  const resetRun = (): void => {
    const next = newMazeRun(generateMaze(mazeRngFor(MAZE_FLOOR_1, version + 1)), MAZE_FLOOR_1, version + 1);
    setRun(next);
    store.saveMazeRun(next);
    setSelected(null);
    setShopNode(null);
    pushToast('已开新一轮，地图与探索记录都是新的', 'info');
  };

  const buy = async (nodeId: number, slot: MazeShopSlot): Promise<void> => {
    if (buying || slot.entry.soldOut) {
      return;
    }
    const operationId = store.nextOperationId();
    setBuying(slot.entry.entryId);
    try {
      const outcome = await store.commitEconomic((current) =>
        planMazePurchase({
          profile: current,
          nodeId,
          entry: slot.entry,
          operationId,
          // 迷宫货架没有礼包（`kind` 恒为 `card`），这个随机源用不上，给一条确定的
          rng: createRng(seedFrom(operationId)),
        }),
      );
      if (!outcome.ok) {
        pushToast(outcome.message, 'error');
      }
    } finally {
      setBuying(null);
    }
  };

  const planes = useMemo(
    () => map.nodes.map((node) => ({ node, point: projectNode(node.grid) })),
    [map],
  );
  const bounds = useMemo(() => mapBounds(map.nodes.map((node) => node.grid)), [map]);

  return (
    <DesignStage backgroundUrl={backgroundUrl('bg/activity')}>
      <div className="maze__status">
        <LevelBar level={profile.level} />
        <CurrencyBar currencies={profile.currencies} />
      </div>

      <h1 className="maze__title">迷宫挑战·第一层</h1>
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
                reachable={!move && canMoveTo(map, run.playerNodeId, node.id)}
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

      <ul className="maze__legend" aria-label="图例">
        {LEGEND_ORDER.map((type) => (
          <li key={type}>
            <i style={{ background: withAlpha(NODE_STYLE[type].color, NODE_STYLE[type].alpha) }} />
            {NODE_STYLE[type].label}
          </li>
        ))}
      </ul>

      <button type="button" className="btn maze__reset" onClick={resetRun}>
        清空探索记录
      </button>
      <button type="button" className="maze__back" onClick={() => onNavigate('activity')}>
        返回活动大厅
      </button>

      <p className="maze__foot">
        探索度 {Math.round(exploredRatio(map, run) * 100)}% · 已探索 {run.exploredNodeIds.length} /{' '}
        {map.nodes.length} 个节点
      </p>

      {shopNode === null ? (
        <NodeDetail
          node={selected === null ? null : (nodeById.get(selected) ?? null)}
          explored={selected !== null && explored.has(selected)}
          exploredRatioValue={exploredRatio(map, run)}
        />
      ) : (
        <FloorShop
          run={shopRun}
          nodeId={shopNode}
          buying={buying}
          onBuy={(slot) => void buy(shopNode, slot)}
          onClose={() => setShopNode(null)}
        />
      )}

      <EventShowcase />
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
  /**
   * 是不是「一步能到」。
   *
   * 旧版对可达节点**没有任何视觉区分**（只有连线可看，见 `mazeLayout` 的注释），
   * 这里也一样不画高亮——但这个属性留着：浏览器用例要能确定地找到相邻节点，
   * 否则只能靠反推地图生成结果，那种断言一改生成规则就碎。
   */
  readonly reachable: boolean;
  readonly done: boolean;
  readonly onHover: (id: number | null) => void;
  readonly onClick: (id: number) => void;
}) {
  const style = NODE_STYLE[node.type];
  const front = frontFaceOf(style.color, style.alpha);
  const classes = ['maze__tile'];
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
      aria-label={`${NODE_STYLE[node.type].label} 节点 #${node.id}`}
      style={{
        left: u(point.x),
        top: u(point.y),
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
      <h2 className="maze__detail-title">{style.label}</h2>
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

/** 楼层商店。旧版是单独一块屏（`floor_shop`）；这里做成同一屏的右侧面板。 */
function FloorShop({
  run,
  nodeId,
  buying,
  onBuy,
  onClose,
}: {
  readonly run: MazeRunState;
  readonly nodeId: number;
  readonly buying: string | null;
  readonly onBuy: (slot: MazeShopSlot) => void;
  readonly onClose: () => void;
}) {
  const stock = useMemo(() => mazeShopStock(run, nodeId), [run, nodeId]);

  return (
    <aside className="maze__detail maze__shop" aria-label="楼层商店" data-shop-node={nodeId}>
      <h2 className="maze__detail-title">商店补给</h2>
      <p className="maze__detail-sub">节点 #{nodeId}</p>
      <p className="maze__detail-line">
        这一个节点的货架是固定的（同一轮里进来看到的都是这批），售罄不会补货。
      </p>
      <ul className="maze__shop-list">
        {stock.map((slot) => {
          const card = cardById.get(slot.item.cardId);
          const face = cardFaceUrl(slot.item.cardId, 'thumbnail');
          return (
            <li key={slot.entry.entryId} className="maze__shop-item" data-entry-id={slot.entry.entryId}>
              <span
                className="maze__shop-face"
                data-card-id={slot.item.cardId}
                style={{ ['--rarity' as string]: withAlpha(NODE_STYLE.supply.color, 255) }}
              >
                {face ? <img src={face} alt="" draggable={false} /> : <i>{slot.item.cardId}</i>}
              </span>
              <span className="maze__shop-info">
                <b>{card?.name ?? slot.item.cardId}</b>
                <em>{slot.item.label}</em>
              </span>
              <button
                type="button"
                className="btn maze__shop-buy"
                disabled={slot.entry.soldOut || buying !== null}
                onClick={() => onBuy(slot)}
              >
                {slot.entry.soldOut
                  ? '已售罄'
                  : `${slot.item.price.amount} ${slot.item.price.currency === 'gold' ? '金币' : slot.item.price.currency === 'crystal' ? '水晶' : '徽章'}`}
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

/** 左下角的 `#elna` 卡展示位（旧版每 15 秒轮换一张）。悬停详情走全局的 `CardTipHost`。 */
function EventShowcase() {
  const cards = useMemo(
    () =>
      cardDatabase.definitions
        .filter((card) => card.rarity === MAZE_EVENT_RARITY && card.status === 'complete')
        .map((card) => card.cardId)
        .sort(),
    [],
  );
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
    <div className="maze__showcase" data-card-id={cardId} title="限时活动卡牌">
      <img src={face} alt="" draggable={false} />
    </div>
  );
}
