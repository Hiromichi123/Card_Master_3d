import { useCallback, useMemo, useState } from 'react';

import type { CardDefinition } from '../domain/cards/types';
import { GachaStage } from '../rendering/gacha/GachaStage';

import { cardById, cardDatabase, gachaPools } from '../data';
import { backgroundUrl } from '../data/assets';
import { createRng, seedFrom } from '../domain/battle/rng';
import {
  buildCardPool,
  planPull,
  probabilityRows,
  rarePercent,
  raritySlots,
} from '../domain/progression/gacha';
import type { GachaResult } from '../domain/progression/types';
import type { ProfileState } from '../domain/progression/types';
import type { ProfileStore } from '../state/createProfileStore';
import { useRarityIndex } from '../state/useRarityIndex';
import { SPEED_SCALE, useSettingsStore } from '../state/settingsStore';
import { GachaMenu } from '../ui/GachaMenu';
import { CardShowcase } from '../ui/CardShowcase';
import { GachaProbabilityStrip } from '../ui/GachaProbabilityStrip';
import { UI_EXIT } from '../rendering/gacha/choreography';

/**
 * 抽卡。
 *
 * ## 数据流：结果先落盘，再演出
 *
 * 点下按钮到看见结果的链路是**一条**：
 *
 * ```
 * 点十连 → operationId = store.nextOperationId()
 *        → rng = createRng(seedFrom(operationId))      // 与 saveStore.test.ts 同一个范式
 *        → await store.commitEconomic(p => planPull(...))
 *    ├─ rejected   → 屏内一行提示（store 已经 toast 过，不重复）；不演出
 *    ├─ saveFailed → 快照逐字节不变，按钮可再点；不演出
 *    └─ ok         → setRun({ view })   ← 货币已扣、库存已加**且已落盘**，这才开始演出
 * ```
 *
 * 采样发生在 `commitEconomic` 的队列里——`busy` 检查与 operationId 去重**之后**、
 * 落盘**之前**。所以「抽到哪十张」与「落盘的那笔事务」是同一个执行体，
 * 不存在两套采样各算一次。
 *
 * **代价写清楚**：演出中途硬刷新会丢演出（结果已在盘上，但动画不会重放，
 * `lastResult` 也只在内存里）。反过来做——把「待播的结果」也持久化——要动存档 schema
 * 与迁移，收益（刷新后能补看一次动画）远小于风险。
 *
 * ## 概率一律现算
 *
 * 用 `probabilityRows` / `rarePercent` 从权重表现算，**绝不渲染 `pool.probLabel`**：
 * 导入报告里 `normal` 手写 8.9% 而实际 6.3%、`special` 手写 100% 而实际 94%，
 * `src/data/index.ts` 的字段注释也写明界面不得渲染它。
 */
export interface GachaSceneProps {
  readonly profile: ProfileState;
  readonly store: ProfileStore;
  readonly busy: boolean;
  readonly onReturn?: (() => void) | undefined;
}

interface Run {
  readonly operationId: string;
  readonly view: GachaResult;
}

/**
 * 抽卡页的三个阶段。
 *
 * `reveal` 与 `result` 分开是有理由的：演出**还没播完**时不该先把结果列出来，
 * 而演出结束之后舞台要留在画面上（卡片停在最终位姿）——那是这段演出的落点，
 * 一结束就把画布撤掉，等于把刚抽到的东西收走。
 */
type Phase = 'select' | 'reveal' | 'result';

/** 测试按钮每次发多少。 */
const GRANT_AMOUNT = 50_000;

export function GachaScene({ profile, store, busy, onReturn }: GachaSceneProps) {
  const rarityIndex = useRarityIndex();
  const presentationSpeed = useSettingsStore((state) => state.presentationSpeed);

  const pools = gachaPools.pools;
  const [poolIndex, setPoolIndex] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  const [phase, setPhase] = useState<Phase>('select');
  /** Skip still presents physical cards, but jumps straight to their final pose. */
  const [animated, setAnimated] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [uiStarted, setUIStarted] = useState(false);
  const [uiDismissed, setUIDismissed] = useState(false);
  const [transitionOrigin, setTransitionOrigin] = useState<'menu' | 'result'>('menu');
  const [outgoingCards, setOutgoingCards] = useState<readonly CardDefinition[]>([]);
  const [showcaseHovered, setShowcaseHovered] = useState<number | null>(null);
  const [showcasePointer, setShowcasePointer] = useState<readonly [number, number]>([0, 0]);
  const handleStarted = useCallback(() => setUIStarted(true), []);
  const handleMenuHidden = useCallback(() => { setUIDismissed(true); setOutgoingCards([]); }, []);
  const handleFinished = useCallback(() => setPhase('result'), []);

  const pool = pools[poolIndex] ?? pools[0];
  const showcaseCards = useMemo(() => (pool?.showcaseCards ?? []).map((id) => cardById.get(id))
    .filter((card): card is CardDefinition => card !== undefined), [pool]);

  /*
    权重表按**池里写的表名**取，不按池名猜——`probTable` 就是为这件事存在的。
    `raritySlots` 会丢掉零权重与表里没有的稀有度：那些档位是真的抽不到。
  */
  const slots = useMemo(
    () => (pool ? raritySlots(gachaPools.tables[pool.probTable] ?? {}, rarityIndex.order) : []),
    [pool, rarityIndex],
  );
  const cardPool = useMemo(() => buildCardPool(cardDatabase.definitions), []);
  const rows = useMemo(() => probabilityRows(slots), [slots]);
  /*
    高稀有合计。**注意它和 `gacha-pools.json` 里的 `computedRarePercent` 不是一回事**：
    那个字段是导入脚本按「100 分制直接求和」算的，只在权重表总和恰好是 100 时才等于真实概率。

    `special` 表就是反例：SSS..A 有权重、B+ 及以下全是 0，总和 94——
    JSON 里写 94，而按「表内总和归一化」这条规则，实际每次抽都落在 A 及以上，
    真实概率是 **100%**。界面上显示的必须是后者（旧版那个 94 是把 6 个百分点
    送给了根本不存在的低稀有度）。
  */
  const rare = useMemo(
    () => rarePercent(slots, (rarity) => rarityIndex.isHighRarity(rarity)),
    [slots, rarityIndex],
  );

  /**
   * 测试用：直接给自己发一笔钱。
   *
   * 走**和抽卡同一条提交路径**（`commitEconomic`）——它不关心事务里是什么，
   * 只保证「一次原子写」。绕过它直接改 profile 的话，货币会只存在内存里，
   * 一刷新就回去了（那正是抽卡页面最不该出现的行为）。
   */
  const grant = async (currency: 'gold' | 'crystal'): Promise<void> => {
    if (running) {
      return;
    }
    setError(null);
    const outcome = await store.commitEconomic<null>(() => ({
      transaction: {
        operationId: store.nextOperationId(),
        currencyDelta: { [currency]: GRANT_AMOUNT },
        inventoryDelta: {},
      },
      view: null,
    }));
    if (!outcome.ok) {
      setError(outcome.message);
    }
  };

  const pull = async (count: 1 | 10): Promise<void> => {
    if (!pool || pending || busy) {
      return;
    }
    const cost = count === 10 ? pool.tenCost : pool.singleCost;
    if ((profile.currencies[pool.currency] ?? 0) < cost) {
      // 余额不足在领域层也会被拒，这里先给一条**点得动的解释**
      setError(`${count === 10 ? '十连' : '单抽'}需要 ${cost}，余额不够`);
      return;
    }
    const operationId = store.nextOperationId();
    const rng = createRng(seedFrom(operationId));
    setPending(true);
    setError(null);
    try {
      const outcome = await store.commitEconomic<GachaResult>((current) =>
        planPull({
          profile: current,
          poolId: pool.id,
          currency: pool.currency,
          cost,
          slots,
          pool: cardPool,
          count,
          rng,
          operationId,
        }),
      );
      if (!outcome.ok) {
        // store 已经 toast 过；屏内再留一行，免得 toast 消失后无迹可寻
        setError(outcome.message);
        return;
      }
      setPreviewId(null);
      setTransitionOrigin(phase === 'result' ? 'result' : 'menu');
      setOutgoingCards(runCards);
      setUIStarted(false); setUIDismissed(false); setShowcaseHovered(null);
      setRun({ operationId, view: outcome.view });
      // Skip reveals the same physical cards immediately; it never opens a result list dialog.
      const withStage = presentationSpeed !== 'skip';
      setAnimated(withStage);
      setPhase(withStage ? 'reveal' : 'result');
    } finally {
      setPending(false);
    }
  };

  if (!pool) {
    return <div className="screen gacha">没有可用的卡池配置。</div>;
  }

  const running = pending || busy;

  /** 这一批抽到的卡（按抽出顺序，重复的也在）。 */
  const runCards = useMemo((): CardDefinition[] => {
    if (!run) {
      return [];
    }
    return run.view.cardIds
      .map((cardId) => cardById.get(cardId))
      .filter((card): card is CardDefinition => card !== undefined);
  }, [run]);

  const closeRun = (): void => {
    setPreviewId(null);
    setUIStarted(false); setUIDismissed(false); setOutgoingCards([]);
    setRun(null);
    setAnimated(false);
    setPhase('select');
  };

  return (
    <div className="screen gacha">
      {(phase === 'select' || (phase === 'reveal' && transitionOrigin === 'menu' && !uiDismissed)) && <GachaMenu
        pools={pools} pool={pool} poolIndex={poolIndex} onSelectPool={setPoolIndex}
        currencies={profile.currencies} running={running || phase !== 'select'} error={error}
        onPull={(count) => { void pull(count); }} onGrant={(currency) => { void grant(currency); }}
        onReturn={onReturn}
        leaving={phase === 'reveal' && uiStarted} exitSeconds={UI_EXIT * SPEED_SCALE[presentationSpeed]}
        onHoverCard={setShowcaseHovered} onCardPointer={setShowcasePointer}
      />}

      {/*
        演出中与演出后舞台都留着：`reveal` 时先看翻卡，
        `result` 时实体卡可直接预览，只覆盖离开与继续抽卡的操作。
      */}
      <GachaStage cards={runCards} backdropUrl={backgroundUrl(pool.bgType)} onFinished={handleFinished}
        completed={phase === 'result'} skipAnimation={!animated} onPreview={(card) => setPreviewId(card.cardId)}
        runKey={run?.operationId ?? null} mode={phase} showcaseCards={showcaseCards}
        showcaseHovered={showcaseHovered} showcasePointer={showcasePointer}
        menuVisible={phase === 'select' || (phase === 'reveal' && transitionOrigin === 'menu' && !uiDismissed)}
        outgoingCards={phase === 'reveal' && transitionOrigin === 'result' && !uiDismissed ? outgoingCards : []}
        onStarted={handleStarted} onMenuHidden={handleMenuHidden} />
      <GachaProbabilityStrip rows={rows} rare={rare} />
      {run && (phase === 'result' || (phase === 'reveal' && transitionOrigin === 'result' && !uiDismissed)) && (
        <section className={`gacha-complete${phase === 'reveal' && uiStarted ? ' gacha-complete--leaving' : ''}`} aria-label="抽卡完成"
          style={{ ['--gacha-exit-duration' as string]: `${UI_EXIT * SPEED_SCALE[presentationSpeed]}s` }}>
          <header className="gacha-complete__head"><h2>抽卡完成</h2><p>获得 {run.view.cardIds.length} 张卡牌 · 点击卡牌查看预览</p></header>
          <div className="gacha-complete__actions">
            <button type="button" className="btn" onClick={closeRun} disabled={running || phase !== 'result'}>离开</button>
            <button type="button" className="btn btn--primary" disabled={running || phase !== 'result'} data-testid="pull-again"
              onClick={() => void pull(run.view.cardIds.length === 1 ? 1 : 10)}>
              继续抽卡<span>{run.view.cardIds.length === 1 ? pool.singleCost : pool.tenCost} {pool.currency === 'gold' ? '金币' : '水晶'} · {run.view.cardIds.length === 1 ? '单抽' : '十连'}</span>
            </button>
          </div>
          {error && <p className="gacha__error gacha-complete__error" role="status">{error}</p>}
        </section>
      )}
      {previewId && <CardShowcase cardId={previewId} cardIds={[...new Set(runCards.map((card) => card.cardId))]}
        onSelect={setPreviewId} onClose={() => setPreviewId(null)} />}
    </div>
  );
}
