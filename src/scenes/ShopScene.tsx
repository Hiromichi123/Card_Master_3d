import { useMemo, useState } from 'react';

import { backgroundUrl, cardFaceUrl } from '../data/assets';
import { cardById, cardDatabase, shopSpecs } from '../data';
import { createRng, seedFrom } from '../domain/battle/rng';
import { buildShelf, planPurchase } from '../domain/progression/shop';
import type { ShelfEntry } from '../domain/progression/shop';
import type { ProfileState } from '../domain/progression/types';
import type { ProfileStore } from '../state/createProfileStore';
import { useRarityIndex } from '../state/useRarityIndex';
import { CurrencyBar } from '../ui/CurrencyBar';
import { DesignStage } from '../ui/DesignStage';
import { LevelBar } from '../ui/LevelBar';
import { LineChart } from '../ui/LineChart';
import { SHELF_METRICS, SHOP_TEXT, WEEK_LABELS, marketSeries, seriesColor } from './shopLayout';
import type { RouteId } from '../app/routes';

/**
 * 商店。1:1 照旧版的两块屏：常规商店 `scenes/shop_scene.py`、
 * 活动商店 `scenes/activity/activity_shop_scene.py`。
 *
 * 两者结构完全一致、只有内容不同，所以是同一块屏加一个 `kind`：
 *
 * ```
 * ┌ 货币与等级 (4%, 3%)                         [返回主菜单] (84%, 5%) ┐
 * │              标题 (11%) / 副标题 (16%)                             │
 * ├───────────────────────────┬────────────────────────────────────────┤
 * │ 左栏 (4%, 18%, 62% × 78%)  │ 右栏 (66%+26, 18%, 其余 × 78%)          │
 * │  三排货架：                │  常规：特典卡包（上 45%）+ 两张行情图    │
 * │  神话 / 传承 / 探索        │  活动：徽章计数 + 一张汇率图            │
 * └───────────────────────────┴────────────────────────────────────────┘
 * ```
 *
 * 每张卡的画法也照旧版（`_draw_card_offer`）：**卡名在上、稀有度描边的卡图、
 * 下方价格按钮**；售罄时卡上盖「已售罄」、价格按钮失效。
 *
 * 坐标走「2880 × 1800 设计空间 + 整体等比缩放」，见 `DesignStage`。
 *
 * ## 每日刷新
 *
 * 货架按**当天**的日键现算（`store.todayKey()`，走存档自己的时钟，
 * 所以开发期的 `?day=` 也管用），而售罄标识 `entryId` 里**自带那个日键**——
 * 跨日之后新货架用新日键，昨天那批标识自然一个都匹配不上，货架「自己就刷新了」。
 * 代价如实写：旧标识会留在存档里（每天至多十几条），要清得加存档字段。
 */
export interface ShopSceneProps {
  readonly profile: ProfileState;
  readonly store: ProfileStore;
  readonly busy: boolean;
  readonly kind: 'normal' | 'activity';
  readonly onNavigate: (route: RouteId) => void;
}

export function ShopScene({ profile, store, busy, kind, onNavigate }: ShopSceneProps) {
  const rarityIndex = useRarityIndex();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const spec = shopSpecs[kind];
  const text = SHOP_TEXT[kind];
  const metrics = SHELF_METRICS[kind];
  const dayKey = store.todayKey();

  /** 稀有度 → 可上架的 cardId（只收完整的卡，与 `buildShelf` 的约定一致）。 */
  const cardsByRarity = useMemo(() => {
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
  }, []);

  const shelf = useMemo(() => {
    if (!spec) {
      return [];
    }
    // 只把**今天**的售罄标识传进去；昨天的标识不可能匹配今天的 entryId
    const today = profile.shop.soldOut.filter((id) => id.startsWith(`${dayKey}|`));
    return buildShelf({ dayKey, spec, cardsByRarity, soldOut: today });
  }, [spec, dayKey, cardsByRarity, profile.shop.soldOut]);

  const market = useMemo(() => marketSeries(dayKey), [dayKey]);

  const buy = async (entry: ShelfEntry): Promise<void> => {
    if (pending || busy || entry.soldOut) {
      return;
    }
    const operationId = store.nextOperationId();
    setPending(entry.entryId);
    setError(null);
    try {
      const outcome = await store.commitEconomic((current) =>
        planPurchase({
          profile: current,
          entry,
          operationId,
          cardsByRarity,
          // 礼包要现抽一张，种子取本次操作 id——与抽卡同一套「可复现」的做法
          rng: createRng(seedFrom(operationId)),
        }),
      );
      if (!outcome.ok) {
        setError(outcome.message);
      }
    } finally {
      setPending(null);
    }
  };

  if (!spec) {
    return (
      <DesignStage backgroundUrl={null}>
        <h1 className="shop__title">{text.title}</h1>
        <p className="shop__subtitle">这一份货架配置缺失（`shops.json`）。</p>
      </DesignStage>
    );
  }

  const packs = shelf.filter((entry) => entry.kind === 'pack');

  return (
    <DesignStage backgroundUrl={backgroundUrl(kind === 'normal' ? 'bg/shop' : 'bg/activity')}>
      <div className="shop__currency">
        <LevelBar level={profile.level} />
        <CurrencyBar currencies={profile.currencies} />
      </div>

      <h1 className="shop__title">{text.title}</h1>
      <p className="shop__subtitle">{text.subtitle}</p>

      {kind === 'activity' && (
        <div className="shop__badge" data-testid="badge-counter">
          <span className="shop__badge-label">徽章</span>
          <b className="shop__badge-value">x {profile.currencies.badge}</b>
        </div>
      )}

      {/* 旧版在右上角常亮着一颗「返回主菜单」（`persistent_glow`） */}
      <button
        type="button"
        className="shop__return"
        onClick={() => onNavigate('hub')}
        title="回到主菜单"
      >
        返回主菜单
      </button>

      {/* 左栏：三排货架 */}
      <section className="shop__left" aria-label="货架">
        {Object.entries(spec.shelves).map(([key, shelfSpec]) => {
          const entries = shelf.filter((entry) => entry.shelfKey === key);
          const metric = metrics[key] ?? { cardWidth: 200, cardHeight: 300, height: 400 };
          return (
            <div key={key} className="shop__shelf" aria-label={shelfSpec.label}>
              <span
                className="shop__shelf-label"
                style={metric.labelColor ? { color: metric.labelColor } : undefined}
              >
                {shelfSpec.label}
              </span>
              <div
                className="shop__shelf-row"
                /* 旧版的 `spec["height"]` 量的就是这一排面板（标签画在它上方之外），
                   所以固定高度给这里而不是整排 */
                style={{
                  height: `calc(${metric.height} * var(--ui))`,
                  ...(metric.panelColor ? { background: metric.panelColor } : {}),
                }}
              >
                {entries.length === 0 ? (
                  <span className="shop__empty">库存补货中…</span>
                ) : (
                  entries.map((entry) => (
                    <ShopCard
                      key={entry.entryId}
                      entry={entry}
                      width={metric.cardWidth}
                      height={metric.cardHeight}
                      rarityColor={rarityIndex.colorOf(entry.rarity)}
                      pending={pending !== null}
                      onBuy={() => void buy(entry)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </section>

      {/* 右栏：常规是卡包 + 两张行情图，活动只有金币汇率一张（外加徽章计数） */}
      <aside className="shop__right">
        {kind === 'normal' && (
          <div className="shop__packs">
            <span className="shop__panel-label">特典卡包</span>
            <div className="shop__pack-row">
              {packs.map((entry) => (
                <div key={entry.entryId} className="shop__item shop__item--pack" data-entry-id={entry.entryId}>
                  <span className="shop__item-name">{entry.label}</span>
                  <div
                    className="shop__pack-body"
                    style={{
                      ['--rarity' as string]: rarityIndex.colorOf(entry.rarity),
                      width: 'calc(150 * var(--ui))',
                      height: 'calc(210 * var(--ui))',
                    }}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="shop__price-btn"
                    data-testid="price"
                    disabled={entry.soldOut || pending !== null}
                    title={entry.note}
                    onClick={() => void buy(entry)}
                  >
                    {formatPrice(entry)}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="shop__charts">
          <span className="shop__panel-label">市场行情</span>
          {kind === 'normal' ? (
            <>
              <LineChart title="成交价走势 (SSS-D)" labels={WEEK_LABELS} series={market.price} unit="G" />
              <LineChart
                title="汇率波动 (金币/水晶/徽章)"
                labels={WEEK_LABELS}
                series={market.exchange}
                unit="%"
              />
            </>
          ) : (
            <LineChart
              title="徽章兑换汇率走势"
              labels={WEEK_LABELS}
              series={market.exchange.map((line) => ({ ...line, color: seriesColor(line.name) }))}
              unit="%"
            />
          )}
        </div>

        {error && (
          <p className="shop__error" role="status">
            {error}
          </p>
        )}
      </aside>
    </DesignStage>
  );
}

/** 一张待售的卡：卡名在上、稀有度描边、下方价格按钮（旧版 `_draw_card_offer`）。 */
function ShopCard({
  entry,
  width,
  height,
  rarityColor,
  pending,
  onBuy,
}: {
  readonly entry: ShelfEntry;
  readonly width: number;
  readonly height: number;
  readonly rarityColor: string;
  readonly pending: boolean;
  readonly onBuy: () => void;
}) {
  const url = entry.cardId ? cardFaceUrl(entry.cardId, 'thumbnail') : null;
  const name = entry.cardId ? (cardById.get(entry.cardId)?.name ?? entry.cardId) : entry.label;

  return (
    <div
      className="shop__item"
      data-entry-id={entry.entryId}
      data-card-id={entry.cardId ?? ''}
      style={{ width: `calc(${width} * var(--ui))`, ['--rarity' as string]: rarityColor }}
    >
      <span className="shop__item-name">{name}</span>
      <div className="shop__item-art" style={{ height: `calc(${height} * var(--ui))` }}>
        {url ? <img src={url} alt={name} draggable={false} /> : <span className="shop__empty">缺图</span>}
        {entry.soldOut && <span className="shop__soldout">已售罄</span>}
      </div>
      <button
        type="button"
        className="shop__price-btn"
        data-testid="price"
        disabled={entry.soldOut || pending}
        onClick={onBuy}
      >
        {formatPrice(entry)}
      </button>
    </div>
  );
}

function formatPrice(entry: ShelfEntry): string {
  const unit =
    entry.price.currency === 'gold' ? '金币' : entry.price.currency === 'crystal' ? '水晶' : '徽章';
  return `${entry.price.amount} ${unit}`;
}
