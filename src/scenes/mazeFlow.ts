import { cardDatabase, shops } from '../data';
import { buildCardPool } from '../domain/progression/gacha';
import type { CardPoolIndex } from '../domain/progression/gacha';
import {
  MAZE_CHAPTER_ID,
  MAZE_EVENT_RARITY,
  MAZE_FLOOR_1,
  applyMove,
  canMoveTo,
  newMazeRun,
  withShopState,
  buildMazeShop,
  generateMazeEnemyDeck,
  isMazeCleared,
  mazeBossBattleId,
  mazeBossLossBattleId,
  mazeDeckSize,
  mazeNodeBattleId,
  mazeReward,
  mazeShopSeed,
  mazeShopBatchKey,
  newMazeShopState,
  generateMaze,
  mazeRngFor,
  rollStrength,
} from '../domain/progression/maze';
import type { MazeNode, MazeNodeType, MazeShopItem } from '../domain/progression/maze';
import { planPurchase } from '../domain/progression/shop';
import type { PurchaseView, ShelfEntry } from '../domain/progression/shop';
import { settlementRng } from '../domain/progression/campaign';
import type { Settlement, SettlementView, StageLaunch } from '../domain/progression/campaign';
import type { EconomyTransaction, MazeRunState, ProfileState } from '../domain/progression/types';
import { createRng, seedFrom } from '../domain/battle/rng';
import type { Rng } from '../domain/battle/rng';
import type { BattleOutcome } from '../domain/battle/types';
import { reject, type Planned } from '../domain/progression/plan';
import { mazeFailureProgress, mazeFailureRemaining, mazeProgressToken, mazeResetRemaining, settleMazeGuarantees } from '../domain/progression/mazeProgress';
import { weekKeyOf } from '../domain/progression/clock';

/**
 * 迷宫的「选点 → 开战 → 结算 → 回地图」之间要拼的那几块。
 *
 * 与 `campaignFlow.ts` 同一个角色，但**刻意不复用它的两个计划函数**：
 *
 * - `planStageLaunch` 把 `chapterId` 当章节用，而迷宫没有章节；
 * - `planSettlement` 会在胜利时写 `clearStageId`——那会把迷宫节点塞进
 *   `campaign.clearedStages`，`applyEconomyTransaction` 还会顺手把
 *   `currentChapterId` 设成 `floor1` 这种垃圾值，直接污染战役页的进度。
 *
 * 复用的是**形状与管道**：`StageLaunch` / `Settlement` 两个类型、
 * `App` 的 launch/settlement state、`BattleScene` 的 props（零改动）。
 */

const cardPool: CardPoolIndex = buildCardPool(cardDatabase.definitions);

/** 稀有度 → 可上架的 cardId（与商店屏同一口径：只收完整的卡）。**只算一次**。 */
const cardsByRarityCache: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const card of cardDatabase.definitions) {
    if (card.status !== 'complete') {
      continue;
    }
    const list = map.get(card.rarity) ?? [];
    list.push(card.cardId);
    map.set(card.rarity, list);
  }
  for (const list of map.values()) {
    list.sort();
  }
  return map;
})();

export function mazePool(): CardPoolIndex {
  return cardPool;
}

export function mazeCardsByRarity(): ReadonlyMap<string, readonly string[]> {
  return cardsByRarityCache;
}

export function mazeEventCards(): readonly string[] {
  return cardsByRarityCache.get(MAZE_EVENT_RARITY) ?? [];
}

export interface MazeProgressView {
  readonly run: MazeRunState;
  readonly rewardCardIds: readonly string[];
}

function mazeUpdatePlan(
  profile: ProfileState,
  run: MazeRunState,
  progress: ProfileState['mazeProgress'],
  operationId: string,
): Planned<MazeProgressView> {
  const rewards = settleMazeGuarantees(progress, run, mazeEventCards());
  return {
    transaction: {
      operationId, currencyDelta: {}, inventoryDelta: rewards.inventoryDelta,
      mazeUpdate: { expectedToken: mazeProgressToken(profile), run, progress: rewards.progress },
    },
    view: { run, rewardCardIds: rewards.rewardCardIds },
  };
}

/** 首次进入和空池恢复后的待发奖励，也经过同一次持久化。 */
export function planMazeEnter(args: { profile: ProfileState; operationId: string; dayKey?: string }): Planned<MazeProgressView> {
  const { profile, operationId } = args;
  let run = profile.mazeRun ?? newMazeRun(generateMaze(mazeRngFor(MAZE_FLOOR_1, 1)), MAZE_FLOOR_1, 1);
  const map = generateMaze(mazeRngFor(run.floorKey, run.version));
  if (map.nodes[run.playerNodeId]?.type === 'supply') run = withShopState(run, run.playerNodeId);
  return mazeUpdatePlan(profile, run, args.dayKey ? mazeFailureProgress(profile.mazeProgress, args.dayKey) : profile.mazeProgress, operationId);
}

export function planMazeMove(args: {
  profile: ProfileState; nodeId: number; expectedToken: string; operationId: string; dayKey?: string;
}): Planned<MazeProgressView> {
  const { profile, nodeId, expectedToken, operationId } = args;
  const run = profile.mazeRun;
  if (!run || mazeProgressToken(profile) !== expectedToken) return reject('迷宫状态已变化，请重新选择格点');
  const map = generateMaze(mazeRngFor(run.floorKey, run.version));
  const progress = args.dayKey ? mazeFailureProgress(profile.mazeProgress, args.dayKey) : profile.mazeProgress;
  if ((progress.failureChances ?? 1) <= 0) return reject('失败机会已耗尽，每天恢复1点，最多存储3点');
  if (!canMoveTo(map, run.playerNodeId, nodeId)) return reject('只能探索相邻格点');
  const firstVisit = nodeId !== map.entryId && !run.exploredNodeIds.includes(nodeId);
  let next = applyMove(map, run, nodeId);
  if (map.nodes[nodeId]?.type === 'supply') next = withShopState(next, nodeId);
  const explorationCount = profile.mazeProgress.explorationCount + (firstVisit ? 1 : 0);
  if (!Number.isSafeInteger(explorationCount)) return reject('探索累计超出可保存范围');
  return mazeUpdatePlan(profile, next, { ...progress, explorationCount }, operationId);
}

export function planMazeReset(args: {
  profile: ProfileState; dayKey: string; expectedToken: string; operationId: string;
}): Planned<MazeProgressView> {
  const { profile, dayKey, expectedToken, operationId } = args;
  const run = profile.mazeRun;
  if (!run || mazeProgressToken(profile) !== expectedToken) return reject('迷宫状态已变化，请重新操作');
  if (!mazeResetRemaining(profile.mazeProgress, dayKey)) return reject('本周清空次数已用完，下周一恢复');
  const version = run.version + 1;
  if (!Number.isSafeInteger(version)) return reject('迷宫轮次超出可保存范围');
  const next = newMazeRun(generateMaze(mazeRngFor(run.floorKey, version)), run.floorKey, version);
  return mazeUpdatePlan(profile, next, { ...mazeFailureProgress(profile.mazeProgress, dayKey), lastResetWeek: weekKeyOf(dayKey)! }, operationId);
}

/** 节点名（详情栏、战斗标题与结算分类都用它）。 */
export function mazeNodeLabel(node: MazeNode): string {
  const type: Record<MazeNodeType, string> = {
    entry: '入口',
    normal: '普通敌人',
    elite: '精英敌人',
    boss: '楼层Boss',
    supply: '商店补给',
  };
  return `${type[node.type]} #${node.id}`;
}

/** 从战斗 id 里取回节点序号（结算时要按节点类型算奖励）。 */
export function nodeIdFromBattleId(battleId: string): number | null {
  const match = /:n(\d+)/.exec(battleId);
  return match ? Number(match[1]) : null;
}

/**
 * 一次迷宫挑战的启动参数。
 *
 * 除 `StageLaunch` 的四项之外多带四个字段，**都只有迷宫用得上**：
 * 结算时要按节点类型/到场强度算奖励，而那时地图屏已经卸载、`run` 也走远了。
 * 用独立类型而不是往 `StageLaunch` 上加可选字段：战役那条路径不该看见这些。
 */
export interface MazeLaunch extends StageLaunch {
  readonly nodeType: MazeNodeType;
  /** 走到这一步**之后**的探索度（强度按它算，旧版也是到场才掷强度）。 */
  readonly explored: number;
  /** 本次挑战（含重试）的随机流键，见 `planMazeLaunch`。 */
  readonly attemptKey: string;
  /** 失败结算用的 id（Boss 可以反复重试，不能占用胜利那条 id）。 */
  readonly lossBattleId: string;
}

/** 是不是迷宫启动参数（`App` 靠它把两条结算路径分流）。 */
export function isMazeLaunch(launch: StageLaunch): launch is MazeLaunch {
  return 'attemptKey' in launch;
}

export interface MazeLaunchArgs {
  readonly dayKey?: string;
  readonly profile: ProfileState;
  readonly run: MazeRunState;
  /** 走到这一步**之后**的探索度（强度按它算，旧版也是到场才掷强度）。 */
  readonly explored: number;
  readonly node: MazeNode;
  readonly playerDeck: readonly string[];
  /** 同一屏内的第几次启动（同一节点的两次挑战据此拿到不同的 battleId）。 */
  readonly launchSeq: number;
}

/**
 * 算一次迷宫节点的战斗。
 *
 * **敌方牌组现生成、直接进内存**（清单要求）：旧版写 `temp_deck.json` 中转，
 * 这里没有那个文件。强度与牌组都从 `attemptKey` 派生随机流——于是同一局可复现，
 * 而且「预览」与「实战」不会各掷一次。
 *
 * `battleId` 的语义见 `maze.ts`：普通/精英每次挑战都是新局；
 * Boss **胜利**用稳定 id（全 run 只能结算一次），失败另用一条（可以重试）。
 *
 * **`attemptKey` 与 `battleId` 在 Boss 上分道扬镳**：Boss 的 `battleId` 必须稳定，
 * 但随机流要是也稳定，每次重试都会碰上同一副敌牌、同一个 seed——
 * 所以随机流改用每次挑战都不同的那条键（Boss 用失败 id，它本来就是「这一次」的 id）。
 */
export function planMazeLaunch(args: MazeLaunchArgs): MazeLaunch | { readonly rejected: string } {
  if ((args.dayKey ? mazeFailureRemaining(args.profile.mazeProgress, args.dayKey) : args.profile.mazeProgress.failureChances ?? 1) <= 0) return { rejected: '失败机会已耗尽，每天恢复1点，最多存储3点' };
  if (args.playerDeck.length === 0) {
    return { rejected: '还没有可用的出战卡组' };
  }
  const { node, run, profile } = args;
  const boss = node.type === 'boss';
  const battleId = boss
    ? mazeBossBattleId(run.floorKey, run.version)
    : mazeNodeBattleId(run.floorKey, run.version, node.id, profile.revision, args.launchSeq);
  const lossBattleId = boss
    ? mazeBossLossBattleId(run.floorKey, run.version, profile.revision, args.launchSeq)
    : `${battleId}@loss`;
  const attemptKey = boss ? lossBattleId : battleId;

  const strength = rollStrength(
    createRng(seedFrom(`${attemptKey}:strength`)),
    node.type,
    args.explored,
  );
  const enemyDeck = generateMazeEnemyDeck(
    createRng(seedFrom(`${attemptKey}:deck`)),
    strength,
    cardPool,
  );

  return {
    battleId,
    stageId: `maze:${run.floorKey}:v${run.version}:n${node.id}`,
    /** 哨兵：`App` 靠它把迷宫与战役的结算分流。 */
    chapterId: MAZE_CHAPTER_ID,
    stageName: mazeNodeLabel(node),
    seed: seedFrom(attemptKey),
    playerDeck: args.playerDeck,
    enemyDeck,
    // 迷宫不用战役那套魔法旗标，奖励在 `planMazeSettlement` 里现算
    rewardSpec: null,
    /*
      见 `mazeDeckSize` 的注释：本作把上界收到引擎的 12，所以这里恒为 false。
      留着这一项是因为界面会显示「被裁过」的提示——真超限时要看得见。
    */
    clipped: enemyDeck.length < mazeDeckSize(strength),
    nodeType: node.type,
    explored: args.explored,
    attemptKey,
    lossBattleId,
  };
}

/**
 * 这一局的奖励。
 *
 * 与战役那边一样是**纯函数**：随机流由 `battleId` 派生，所以重渲染、
 * 重开页面都会得到同一份结果，不用把「这次掉了什么」存下来。
 */
export function mazeSettlementFor(launch: MazeLaunch, outcome: BattleOutcome): Settlement {
  if (!(outcome.kind === 'win' && outcome.winner === 'player')) {
    // 与战役的败北口径一致：只给一点经验
    return {
      victory: false,
      gold: 0,
      xp: 60,
      crystals: 0,
      badges: 0,
      cardId: null,
      cardRarity: null,
      lines: ['败北经验 +60'],
    };
  }

  const rng = settlementRng(launch.attemptKey);
  // 与开战时同一个随机流起点，所以这里掷出的强度就是这一局真实的那个
  const strength = rollStrength(
    createRng(seedFrom(`${launch.attemptKey}:strength`)),
    launch.nodeType,
    launch.explored,
  );
  const reward = mazeReward({ rng, nodeType: launch.nodeType, strength, pool: cardPool });
  return {
    victory: true,
    gold: reward.gold,
    xp: reward.xp,
    crystals: 0,
    badges: reward.badges,
    cardId: reward.cardId,
    cardRarity: reward.cardRarity as Settlement['cardRarity'],
    lines: reward.lines,
  };
}

/**
 * 把奖励包成一次事务。
 *
 * 与战役的 `planSettlement` 有两处不同：
 * 1. **不写 `clearStageId`**（迷宫不碰战役进度）；
 * 2. **Boss 胜利用稳定 battleId** —— 第二次打同一个 Boss 会被
 *    `settledBattleIds` 判成「已经结算过」，一分钱不发。
 *    这是结构性的，不靠界面禁用。
 */
export function planMazeSettlement(
  launch: MazeLaunch,
  settlement: Settlement,
  operationId: string,
  profile?: ProfileState,
  dayKey?: string,
): Planned<SettlementView> {
  const inventoryDelta: Record<string, number> = {};
  if (settlement.cardId) {
    inventoryDelta[settlement.cardId] = 1;
  }

  // 失败用 attemptKey 那条 id：Boss 的胜利 id 是稳定的，失败不能占用它（否则只能输一次）
  const settleBattleId = settlement.victory ? launch.battleId : launch.lossBattleId;

  const transaction: EconomyTransaction = {
    operationId,
    currencyDelta: {
      ...(settlement.gold ? { gold: settlement.gold } : {}),
      ...(settlement.badges ? { badge: settlement.badges } : {}),
    },
    inventoryDelta,
    xpDelta: settlement.xp,
    settleBattleId,
    ...(!settlement.victory && profile?.mazeRun && dayKey ? { mazeUpdate: {
      expectedToken: mazeProgressToken(profile), run: profile.mazeRun,
      progress: { ...mazeFailureProgress(profile.mazeProgress, dayKey), failureChances: Math.max(0, mazeFailureRemaining(profile.mazeProgress, dayKey) - 1) },
    } } : {}),
  };

  return {
    transaction,
    view: { ...settlement, battleId: settleBattleId, stageId: launch.stageId },
  };
}

/** 本层是否已通关（Boss 的胜利结算已经在盘上）。 */
export function mazeCleared(profile: ProfileState): boolean {
  const run = profile.mazeRun;
  if (!run) {
    return false;
  }
  return isMazeCleared(profile.settledBattleIds, run.floorKey, run.version);
}

/* ---------------------------------------------------------------------------
 * 楼层商店
 * ------------------------------------------------------------------------- */

/**
 * 迷宫商品 → 商店事务认得的形状。
 *
 * `entryId` 只要**在这个节点内唯一**就够：售罄是写在
 * `mazeRun.shopByNode[nodeId].soldOut` 里的，不同节点的货架互不影响。
 */
export function toShelfEntry(
  item: MazeShopItem,
  index: number,
  soldOut: readonly string[],
  batchKey?: string,
): ShelfEntry {
  const entryId = `${batchKey ? `${batchKey}|` : ''}${index}|${item.cardId}`;
  return {
    entryId,
    shelfKey: 'maze',
    index,
    kind: 'card',
    cardId: item.cardId,
    rarity: item.rarity,
    price: item.price,
    label: item.label,
    note: item.isEvent ? '活动限定' : '',
    soldOut: soldOut.includes(entryId),
  };
}

export interface MazeShopSlot {
  readonly entry: ShelfEntry;
  readonly item: MazeShopItem;
}

/**
 * 某个补给节点当前的货架。
 *
 * 新货架读保存的seed；旧货架保持历史算法及entryId，直到主动刷新。
 */
export function mazeShopStock(run: MazeRunState, nodeId: number): readonly MazeShopSlot[] {
  const stored = run.shopByNode[String(nodeId)];
  const state = stored ?? newMazeShopState(run, nodeId);
  const legacy = stored !== undefined && stored.catalogVersion !== 2;
  const stockRun = stored ? run : { ...run, shopByNode: { ...run.shopByNode, [String(nodeId)]: state } };
  const items = buildMazeShop({
    rng: createRng(legacy ? mazeShopSeed(run.floorKey, run.version, nodeId) : state.seed),
    cardsByRarity: cardsByRarityCache,
    priceByRarity: shops.normalShop?.priceByRarity ?? {},
    fallbackPrice: shops.normalShop?.unknownRarityFallback ?? { currency: 'gold', amount: 1200 },
    legacy,
  });
  return items.map((item, index) => ({ item, entry: toShelfEntry(item, index, state.soldOut, legacy ? undefined : mazeShopBatchKey(stockRun, nodeId)) }));
}

/** 确认玩家仍在同一轮的当前补给点；不存在的/远程的/陈旧的货架都不能交易。 */
function currentMazeShop(profile: ProfileState, nodeId: number, expectedBatch: string): MazeRunState | null {
  const run = profile.mazeRun;
  if (!run || run.playerNodeId !== nodeId || !run.shopByNode[String(nodeId)] || mazeShopBatchKey(run, nodeId) !== expectedBatch) return null;
  const node = generateMaze(mazeRngFor(run.floorKey, run.version)).nodes[nodeId];
  return node?.type === 'supply' ? run : null;
}

export function planMazeRefresh(args: {
  readonly profile: ProfileState;
  readonly nodeId: number;
  readonly expectedBatch: string;
  readonly operationId: string;
}): Planned<{ readonly nodeId: number; readonly batchKey: string }> {
  const run = currentMazeShop(args.profile, args.nodeId, args.expectedBatch);
  if (!run) return reject('迷宫货架已变化，请重新打开商店');
  const state = newMazeShopState(run, args.nodeId, (run.shopByNode[String(args.nodeId)]?.refreshCount ?? 0) + 1);
  const next = { ...run, shopByNode: { ...run.shopByNode, [String(args.nodeId)]: state } };
  return {
    transaction: {
      operationId: args.operationId,
      currencyDelta: {},
      inventoryDelta: {},
      mazeShopExpected: { nodeId: args.nodeId, batchKey: args.expectedBatch },
      mazeShopRefresh: { nodeId: String(args.nodeId), state },
    },
    view: { nodeId: args.nodeId, batchKey: mazeShopBatchKey(next, args.nodeId) },
  };
}

/** 买一件楼层商店的商品：与商店屏同一条事务，售罄落到**这个节点**。 */
export function planMazePurchase(args: {
  readonly profile: ProfileState;
  readonly nodeId: number;
  readonly entry: ShelfEntry;
  readonly expectedBatch: string;
  readonly operationId: string;
  readonly rng: Rng;
}): Planned<PurchaseView> {
  const run = currentMazeShop(args.profile, args.nodeId, args.expectedBatch);
  if (!run) return reject('迷宫货架已变化，请重新打开商店');
  const entry = mazeShopStock(run, args.nodeId).find(slot => slot.entry.entryId === args.entry.entryId)?.entry;
  if (!entry) return reject('这件商品已不在当前货架');
  const planned = planPurchase({
    profile: args.profile,
    entry,
    operationId: args.operationId,
    cardsByRarity: cardsByRarityCache,
    rng: args.rng,
  });
  if ('rejected' in planned) {
    return planned;
  }
  /*
    售罄**不**写进每日货架（`soldOutAdditions` 是那个用途），改落到迷宫 run 的这个节点。
    `planPurchase` 会带上 `soldOutAdditions`，这里必须把它**去掉**而不是置 `undefined`
    ——`exactOptionalPropertyTypes` 下「有键但值为 undefined」不是合法形状。
  */
  const { soldOutAdditions: _dailyShelf, shopDayKey: _dailyDay, ...transaction } = planned.transaction;
  return {
    transaction: {
      ...transaction,
      mazeShopExpected: { nodeId: args.nodeId, batchKey: args.expectedBatch },
      mazeSoldOut: { nodeId: String(args.nodeId), entryIds: [entry.entryId] },
    },
    view: planned.view,
  };
}
