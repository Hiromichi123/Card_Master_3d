import { useMemo, useState } from 'react';

import { cardDatabase, shopSpecs } from '../data';
import { createRng, seedFrom } from '../domain/battle/rng';
import { buildShelf, planPurchase } from '../domain/progression/shop';
import type { ShopSpec } from '../domain/progression/shop';
import type { ShelfEntry } from '../domain/progression/shop';
import type { ProfileState } from '../domain/progression/types';
import type { ProfileStore } from '../state/createProfileStore';
import { useRarityIndex } from '../state/useRarityIndex';
import { CurrencyBar } from '../ui/CurrencyBar';
import { ScrollArea } from '../ui/ScrollArea';
import { CardTile } from '../ui/CardTile';

/**
 * 商店。
 *
 * 常规货架与活动货架**同一块屏**，只有规格不同（`shops.json` 的 `normalShop`
 * 与 `activityShop`），所以做成一个 `kind` 参数而不是两份代码。
 *
 * ## 每日刷新是怎么成立的
 *
 * 货架按**当天**的日键生成（`store.todayKey()`），而售罄标识 `entryId`
 * 里**自带那个日键**（`shop.ts` 的 `entryIdOf` 专门为此设计）。
 * 于是跨日之后：新货架用的是新日键，存档里昨天那批标识自然一个都匹配不上——
 * 货架「自己就刷新了」，不需要任何迁移或清理。
 *
 * 代价如实写在这里：**旧标识会一直留在存档里**（每天至多十几条，
 * 一年约几十 KB）。要清掉得给 `EconomyTransaction` 加一个「商店日键」字段，
 * 属于存档 schema 变更，留到后面统一做。
 *
 * ## 购买
 *
 * 与抽卡同一条链路：`planPurchase` 把「扣钱 + 发货 + 标记售罄」打成**一笔事务**，
 * 经 `commitEconomic` 落盘成功才更新界面。
 * `shops.json` 的 `knownIssues` 里第一条就是旧版「只扣钱不发货」，
 * 这里与发货是同一个事务的两面（`shop.ts` 的注释也点名了）。
 */
export interface ShopSceneProps {
  readonly profile: ProfileState;
  readonly store: ProfileStore;
  readonly busy: boolean;
  /** 常规货架还是活动货架。 */
  readonly kind: 'normal' | 'activity';
}

export function ShopScene({ profile, store, busy, kind }: ShopSceneProps) {
  const rarityIndex = useRarityIndex();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const spec = shopSpecs[kind];
  const dayKey = store.todayKey();

  /** 稀有度 → 可上架的 cardId。与 `buildShelf` 的约定一致：只收完整的卡。 */
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

  /*
    货架由「今天的日键 + 存档里的售罄标识」现算。
    只把**今天**的标识传进去：昨天的标识不可能匹配今天的 entryId，
    传进去只是让 `buildShelf` 多扫一遍（行为不变，这点很关键，注释写清楚）。
  */
  const shelf = useMemo(() => {
    if (!spec) {
      return [];
    }
    return buildShelfFor(dayKey, spec, cardsByRarity, profile.shop.soldOut);
  }, [spec, dayKey, cardsByRarity, profile.shop.soldOut]);

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
      <div className="screen shop">
        <header className="screen__head">
          <div>
            <h1 className="screen__title">{kind === 'normal' ? '商店' : '活动商店'}</h1>
            <p className="shop__lead">这一份货架配置缺失（`shops.json`）。</p>
          </div>
        </header>
      </div>
    );
  }

  // 按货架顺序分组：top / middle / bottom 各一排，礼包单独一组
  const shelfKeys = Object.keys(spec.shelves);
  const packs = shelf.filter((entry) => entry.kind === 'pack');

  return (
    <div className="screen shop">
      <header className="screen__head">
        <div>
          <h1 className="screen__title">{kind === 'normal' ? '商店' : '活动商店'}</h1>
          <p className="shop__lead">
            {dayKey} 货架 · 每日刷新 · 卖完即止
          </p>
        </div>
        <CurrencyBar currencies={profile.currencies} />
      </header>

      {error && (
        <p className="shop__error" role="status">
          {error}
        </p>
      )}

      <ScrollArea>
        {shelfKeys.map((key) => {
          const entries = shelf.filter((entry) => entry.shelfKey === key);
          const label = spec.shelves[key]?.label ?? key;
          if (entries.length === 0) {
            return null;
          }
          return (
            <section key={key} className="shop__shelf" aria-label={label}>
              <h2 className="shop__heading">{label}</h2>
              <ul className="shop__row">
                {entries.map((entry) => (
                  <li key={entry.entryId} className="shop__item" data-entry-id={entry.entryId}>
                    {/* 这一排全是卡（礼包的 shelfKey 是 'pack'，不进这里） */}
                    {entry.cardId && (
                      <CardTile
                        cardId={entry.cardId}
                        size="sm"
                        disabled={entry.soldOut || pending !== null}
                        note={entry.soldOut ? '已售罄' : undefined}
                        onClick={() => void buy(entry)}
                      />
                    )}
                    <span className="shop__price" data-testid="price">
                      {entry.price.amount}
                      {entry.price.currency === 'gold'
                        ? ' 金币'
                        : entry.price.currency === 'crystal'
                          ? ' 水晶'
                          : ' 徽章'}
                    </span>
                    {entry.soldOut && <span className="shop__soldout">已售罄</span>}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        {/* 礼包：`buildShelf` 把它们挂在 `shelfKey: 'pack'` 下，单独排一排 */}
        {packs.length > 0 && (
          <section className="shop__shelf" aria-label="礼包">
            <h2 className="shop__heading">礼包</h2>
            <ul className="shop__row">
              {packs.map((entry) => (
                <li key={entry.entryId} className="shop__item" data-entry-id={entry.entryId}>
                  <button
                    type="button"
                    className="shop__pack"
                    style={{ borderColor: rarityIndex.colorOf(entry.rarity) }}
                    disabled={entry.soldOut || pending !== null}
                    onClick={() => void buy(entry)}
                  >
                    <span className="shop__pack-name">{entry.label}</span>
                    <span
                      className="shop__pack-rarity"
                      style={{ color: rarityIndex.colorOf(entry.rarity) }}
                    >
                      {entry.rarity}
                    </span>
                    <span className="shop__pack-note">{entry.note}</span>
                  </button>
                  <span className="shop__price" data-testid="price">
                    {entry.price.amount}
                    {entry.price.currency === 'gold' ? ' 金币' : ' 水晶'}
                  </span>
                  {entry.soldOut && <span className="shop__soldout">已售罄</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </ScrollArea>
    </div>
  );
}

/** 把货架算出来。抽出来只为了让上面的 `useMemo` 读起来是一句话。 */
function buildShelfFor(
  dayKey: string,
  spec: ShopSpec,
  cardsByRarity: ReadonlyMap<string, readonly string[]>,
  soldOut: readonly string[],
): readonly ShelfEntry[] {
  const today = soldOut.filter((id) => id.startsWith(`${dayKey}|`));
  return buildShelf({ dayKey, spec, cardsByRarity, soldOut: today });
}
