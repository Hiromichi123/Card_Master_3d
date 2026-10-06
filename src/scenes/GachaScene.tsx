import { useMemo, useState } from 'react';

import type { CardDefinition } from '../domain/cards/types';
import { GachaStage } from '../rendering/gacha/GachaStage';

import { cardById, cardDatabase, gachaPools } from '../data';
import { backgroundUrl, cardFaceUrl } from '../data/assets';
import { createRng, seedFrom } from '../domain/battle/rng';
import {
  buildCardPool,
  formatPercent,
  planPull,
  probabilityRows,
  rarePercent,
  raritySlots,
} from '../domain/progression/gacha';
import type { GachaResult } from '../domain/progression/types';
import type { ProfileState } from '../domain/progression/types';
import type { ProfileStore } from '../state/createProfileStore';
import { useRarityIndex } from '../state/useRarityIndex';
import { useSettingsStore } from '../state/settingsStore';
import { CurrencyBar } from '../ui/CurrencyBar';
import { GachaWheel } from '../ui/GachaWheel';
import { CardTile } from '../ui/CardTile';
import { ScrollArea } from '../ui/ScrollArea';

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

export function GachaScene({ profile, store, busy }: GachaSceneProps) {
  const rarityIndex = useRarityIndex();
  const presentationSpeed = useSettingsStore((state) => state.presentationSpeed);
  const reduceMotion = useSettingsStore((state) => state.reduceMotion);

  const pools = gachaPools.pools;
  const [poolIndex, setPoolIndex] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  const [phase, setPhase] = useState<Phase>('select');
  /**
   * 这一次抽卡走不走 3D 演出。
   *
   * **不能靠 `phase` 推**：`result` 阶段舞台要留在后面当背景，
   * 于是「不演出的那次」也会因为 `phase === 'result'` 把 Canvas 挂起来——
   * 正好是「跳过」要避免的那件事（白开一个 WebGL 上下文）。
   */
  const [animated, setAnimated] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pool = pools[poolIndex] ?? pools[0];

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
      setRun({ operationId, view: outcome.view });
      /*
        「跳过」不走舞台：挂一个 WebGL 上下文只为了立刻跳到最后，是白花的。
        这也是**所有不进演出的路径唯一的降级出口**（见本文件头的说明）。
      */
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
  const cheap = !run;

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
    setRun(null);
    setAnimated(false);
    setPhase('select');
  };

  return (
    <div className="screen gacha">
      <header className="screen__head">
        <div>
          <h1 className="screen__title">抽卡</h1>
          <p className="gacha__lead">
            八个卡池，概率由权重表现算 · 演出速度：{presentationSpeed === 'skip' ? '跳过' : presentationSpeed === 'fast' ? '快速' : '正常'}
          </p>
        </div>
        <CurrencyBar currencies={profile.currencies} />
      </header>

      <div className="gacha__body">
        <GachaWheel
          pools={pools}
          activeIndex={poolIndex}
          onSelect={setPoolIndex}
          still={reduceMotion}
        />

        <aside className="gacha__panel">
          <h2 className="gacha__pool-name">{pool.name}</h2>
          <p className="gacha__desc">{pool.description}</p>

          {/*
            概率是**算出来的**：每一档的百分比 + 高稀有合计。
            高稀有的口径来自 `rarities.json`（`isHighRarity`），不是硬编码一档。
          */}
          <ul className="gacha__probs">
            {rows.map((row) => (
              <li key={row.rarity} className="gacha__prob">
                <span
                  className="gacha__prob-dot"
                  style={{ background: rarityIndex.colorOf(row.rarity) }}
                  aria-hidden="true"
                />
                <span className="gacha__prob-rarity">{row.rarity}</span>
                <b className="gacha__prob-value">{formatPercent(row.percent)}</b>
              </li>
            ))}
          </ul>
          <p className="gacha__rare">稀有及以上合计 {formatPercent(rare)}</p>

          <div className="gacha__buttons">
            <button
              type="button"
              className="btn"
              onClick={() => void pull(1)}
              disabled={running}
              data-testid="pull-1"
            >
              单抽 · {pool.singleCost}
              {pool.currency === 'gold' ? ' 金币' : ' 水晶'}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void pull(10)}
              disabled={running}
              data-testid="pull-10"
            >
              十连 · {pool.tenCost}
              {pool.currency === 'gold' ? ' 金币' : ' 水晶'}
            </button>
          </div>

          {/*
            测试用：给自己发钱。真实玩法里货币来自关卡与商店，
            这两颗按钮只是让「抽到没钱」不至于卡住验收。
          */}
          <div className="gacha__dev">
            <span className="gacha__dev-label">测试</span>
            <button
              type="button"
              className="btn btn--tiny"
              onClick={() => void grant('gold')}
              disabled={running}
              data-testid="grant-gold"
            >
              +50000 金币
            </button>
            <button
              type="button"
              className="btn btn--tiny"
              onClick={() => void grant('crystal')}
              disabled={running}
              data-testid="grant-crystal"
            >
              +50000 水晶
            </button>
          </div>

          {error && (
            <p className="gacha__error" role="status">
              {error}
            </p>
          )}

          {/* 开奖之前列一下这个池子里会出现的卡，给个直观预期 */}
          {cheap && pool.showcaseCards.length > 0 && (
            <div className="gacha__showcase">
              <h3 className="gacha__heading">可能抽到</h3>
              <div className="gacha__showcase-grid">
                {pool.showcaseCards.slice(0, 6).map((cardId) => (
                  <CardTile key={cardId} cardId={cardId} size="sm" />
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/*
        演出中与演出后舞台都留着：`reveal` 时结果面板还没出来（先看翻卡），
        `result` 时面板浮在舞台上面，卡片停在最终位姿当背景。
      */}
      {run && animated && (
        <GachaStage
          cards={runCards}
          backdropUrl={backgroundUrl(pool.bgType)}
          onFinished={() => {
            setPhase('result');
          }}
        />
      )}

      {run && phase === 'result' && (
        <GachaResultPanel run={run} onContinue={closeRun} onClose={closeRun} />
      )}
    </div>
  );
}

/**
 * 结果面板。
 *
 * **按下标逐条渲染**，不按 cardId 去重——十连抽到三张同卡就是三条，
 * 每一张都是玩家真拿到的。去重会把「抽到三张」显示成「抽到一张」。
 *
 * 现阶段这里是 DOM 列表；3D 舞台接上之后，舞台留在后面、这块浮在上面。
 */
function GachaResultPanel({
  run,
  onContinue,
  onClose,
}: {
  readonly run: Run;
  readonly onContinue: () => void;
  readonly onClose: () => void;
}) {
  const rarityIndex = useRarityIndex();
  return (
    <div className="overlay overlay--fixed" role="dialog" aria-label="抽卡结果">
      <div className="overlay__panel gacha-result">
        <header className="gacha-result__head">
          <h2 className="gacha-result__title">抽卡结果</h2>
          <p className="gacha-result__count">{run.view.cardIds.length} 张</p>
        </header>
        <ScrollArea>
          <ul className="gacha-result__list">
            {run.view.cardIds.map((cardId, index) => {
              const rarity = run.view.rarities[index] ?? cardById.get(cardId)?.rarity ?? '';
              return (
                <li
                  key={`${cardId}-${index}`}
                  className="gacha-result__item"
                  data-card-id={cardId}
                  data-rarity={rarity}
                  style={{ borderColor: rarityIndex.colorOf(rarity) }}
                >
                  {cardFaceUrl(cardId, 'thumbnail') && (
                    <img
                      className="gacha-result__art"
                      src={cardFaceUrl(cardId, 'thumbnail') ?? ''}
                      alt={cardById.get(cardId)?.name ?? cardId}
                    />
                  )}
                  <span className="gacha-result__name">
                    {cardById.get(cardId)?.name ?? cardId}
                  </span>
                  <span
                    className="gacha-result__rarity"
                    style={{ color: rarityIndex.colorOf(rarity) }}
                  >
                    {rarity}
                  </span>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
        <div className="gacha-result__actions">
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="btn btn--primary" onClick={onContinue}>
            继续抽卡
          </button>
        </div>
      </div>
    </div>
  );
}
