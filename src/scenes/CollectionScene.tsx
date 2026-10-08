import { useMemo, useState } from 'react';

import { cardById } from '../data';
import { assetManifest } from '../data/assets';
import { collectionStats, filterByRarity, ownedEntries, sortForCollection } from '../domain/progression/collection';
import type { ProfileState } from '../domain/progression/types';
import { useRarityIndex } from '../state/useRarityIndex';
import { CardGrid } from '../ui/CardGrid';
import { CardTile } from '../ui/CardTile';
import { ScrollArea } from '../ui/ScrollArea';
import { CardShowcase } from '../ui/CardShowcase';
import { CrossfadeBackground } from '../ui/SceneBackground';
import { useParallax } from '../ui/useParallax';

/**
 * 卡牌图鉴。
 *
 * 密度与筛选照搬旧版 `scenes/collection.py`：一屏密集的图片格子、
 * 只按稀有度筛选、旁边一块统计。排序用**固定的稀有度顺序**，不给玩家选——
 * 旧版也是这样，而「按拥有顺序」这种排序在有 247 张卡时并没有更好用。
 *
 * 三处按 PLAN 第 5 节做了调整：
 *
 * - 缩略图走 `thumbnail` 档并 `loading="lazy"`（一屏几十张走高清档会打爆纹理预算）；
 * - 排序从 `rarities.json` 派生而不是硬编码一份顺序——硬编码会让 `#yoroi`
 *   查到 `undefined`，排序里冒出 `NaN`，而那**不会报错**，只是顺序莫名其妙。
 * - **背景与配置页同一套**（2026-10-09 按用户要求加）：同一张主菜单图、
 *   同一个 `.menu__scrim` 压暗、同一个 `useParallax` 视差。旧版本屏是纯色底，
 *   与配置页并排放着就不是一套界面了。用的是配置页那句
 *   `assetManifest.shared.menu['menu_bg']`——主菜单图在 manifest 的 `menu`
 *   分组里，不在 `bg` 分组（`backgroundUrl('bg/menu')` 查不到它）。
 */
export interface CollectionSceneProps {
  readonly profile: ProfileState;
}

export function CollectionScene({ profile }: CollectionSceneProps) {
  const rarityIndex = useRarityIndex();
  const [rarity, setRarity] = useState<string | null>(null);
  const [showcaseCardId, setShowcaseCardId] = useState<string | null>(null);
  /* 背景与视差：与配置页逐字相同（见文件头第 3 条） */
  const parallaxRef = useParallax();
  const background = assetManifest.shared.menu['menu_bg']?.url ?? null;

  const rarityOf = useMemo(
    () => (cardId: string) => cardById.get(cardId)?.rarity ?? null,
    [],
  );

  const stats = useMemo(
    () => collectionStats(profile.inventory, rarityOf),
    [profile.inventory, rarityOf],
  );

  const entries = useMemo(() => {
    const owned = ownedEntries(profile.inventory);
    const filtered = filterByRarity(owned, rarityOf, rarity);
    return sortForCollection(filtered, rarityOf, (r) => rarityIndex.rankOf(r));
  }, [profile.inventory, rarity, rarityOf, rarityIndex]);

  /*
    展示位左右翻页的浏览顺序**就是这个列表**——当前筛选与排序下的顺序，
    于是「翻页」和图鉴上看到的一样，不会翻出一张当前被筛掉的卡。
  */
  const cardIds = useMemo(() => entries.map((entry) => entry.cardId), [entries]);

  return (
    <div className="screen collection" ref={parallaxRef}>
      {/* 与配置页同一套：背景图 + 压暗层，都在内容之下（见 `.collection__bg`） */}
      <CrossfadeBackground url={background} className="menu__bg collection__bg" />
      <div className="menu__scrim" aria-hidden="true" />

      <header className="screen__head">
        <div>
          <h1 className="screen__title">卡牌图鉴</h1>
          <p className="collection__lead">
            共 {stats.unique} 种、{stats.total} 张
          </p>
        </div>
        <ul className="collection__stats">
          {rarityIndex.order.map((entry) => {
            const count = stats.byRarity[entry] ?? 0;
            if (count === 0) {
              return null;
            }
            return (
              <li key={entry} className="collection__stat">
                <span
                  className="collection__stat-dot"
                  style={{ background: rarityIndex.colorOf(entry) }}
                  aria-hidden="true"
                />
                {entry}
                <b>{count}</b>
              </li>
            );
          })}
        </ul>
      </header>

      <div className="collection__filter" role="group" aria-label="按稀有度筛选">
        <button
          type="button"
          className={rarity === null ? 'chip chip--on' : 'chip'}
          onClick={() => setRarity(null)}
        >
          全部
        </button>
        {rarityIndex.order.map((entry) => {
          const count = stats.byRarity[entry] ?? 0;
          return (
            <button
              key={entry}
              type="button"
              className={rarity === entry ? 'chip chip--on' : 'chip'}
              onClick={() => setRarity(entry)}
              disabled={count === 0}
              title={count === 0 ? `还没有${entry}的卡` : undefined}
            >
              <span
                className="chip__dot"
                style={{ background: rarityIndex.colorOf(entry) }}
                aria-hidden="true"
              />
              {entry}
              <span className="chip__count">{count}</span>
            </button>
          );
        })}
      </div>

      <ScrollArea>
        {entries.length === 0 ? (
          <p className="collection__empty">
            这个稀有度下还没有卡。去抽卡或者打关卡都可能拿到。
          </p>
        ) : (
          <CardGrid>
            {entries.map((entry) => (
              <CardTile
                key={entry.cardId}
                cardId={entry.cardId}
                count={entry.count}
                onClick={() => setShowcaseCardId(entry.cardId)}
              />
            ))}
          </CardGrid>
        )}
      </ScrollArea>

      {showcaseCardId && (
        <CardShowcase
          cardId={showcaseCardId}
          cardIds={cardIds}
          onSelect={setShowcaseCardId}
          onClose={() => setShowcaseCardId(null)}
        />
      )}
    </div>
  );
}
