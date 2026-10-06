import { useEffect, useMemo, useRef, useState } from 'react';

import { cardById } from '../data';
import { systemClock } from '../domain/progression/clock';
import {
  ADD_REJECTION_NOTE,
  ADD_REJECTION_TEXT,
  DECK_LIMIT,
  clearDeck,
  emptyDeck,
  removeCardAt,
} from '../domain/progression/deck';
import { addToDeck, deckEditorRows, deckSlots, deckSummary } from '../domain/progression/deckView';
import { activeDeckOf } from '../domain/progression/profile';
import { filterByRarity, ownedEntries, sortForCollection } from '../domain/progression/collection';
import type { Deck, ProfileState } from '../domain/progression/types';
import type { ProfileStore } from '../state/createProfileStore';
import { pushToast } from '../state/toastStore';
import { useRarityIndex } from '../state/useRarityIndex';
import { CardHoverTip } from '../ui/CardHoverTip';
import { CardTile } from '../ui/CardTile';
import { ScrollArea } from '../ui/ScrollArea';
import { useParallax } from '../ui/useParallax';
import { assetManifest } from '../data/assets';

/**
 * 配置（组卡）。
 *
 * 左 12 槽、右收藏，照旧版 `scenes/deck_builder_scene.py` 的布局。
 * **两处按本项目的现状改了做法**（照搬不了的地方，写在这里）：
 *
 * 1. **点击加入 / 点击移出**，不是拖拽。旧版是拖拽，但 DOM 里把卡从滚动容器拖进槽位
 *    要做命中判定、自动滚动、触屏适配，收益只是手感；点击在触屏与键盘上一样能用，
 *    浏览器用例也能直接断「点一下加了几张」。
 * 2. **不设显式「保存卡组」按钮**。改动走 `store.saveDeck` 的防抖队列（既有设计），
 *    离开页面时 `flush()` 落盘。旧版要手点保存，中途退出就丢。
 *
 * **草稿是乐观的**：`draft` 只在挂载时从当前出战卡组播种一次，之后以草稿为准渲染。
 * 若直接拿 `profile.decks` 当渲染源，点一下要等一次 IndexedDB 往返才看见变化——
 * 点击加卡的手感就废了。代价是「落盘失败时草稿不回滚」，这与 `saveDeck` 的既有语义一致
 * （它只 toast，不假装成功，也不回滚）。
 */
export interface DeckEditorSceneProps {
  readonly profile: ProfileState;
  readonly store: ProfileStore;
}

export function DeckEditorScene({ profile, store }: DeckEditorSceneProps) {
  const rarityIndex = useRarityIndex();
  /*
    背景：旧版的组卡界面**没有**自己的背景图（`deck_builder_scene.py` 里没有背景），
    这里借主菜单那张——它是这一组界面里最中性的一张，也和其它菜单连成一套。
    顺带把视差也带上（同一套 `useParallax` + `.menu__bg`）。
  */
  const parallaxRef = useParallax();
  const background = assetManifest.shared.menu['menu_bg']?.url ?? null;
  /** 悬停详情框：贴在被悬停的那张卡边上。 */
  const [tip, setTip] = useState<{ cardId: string; rect: DOMRect } | null>(null);

  /*
    播种只做一次。**不能跟着 `profile` 变**：抽卡回来会带上新的库存与卡组，
    若那时重新播种，玩家正在编辑的草稿会被冲掉。
  */
  const seededRef = useRef(false);
  const [draft, setDraft] = useState<Deck | null>(() => activeDeckOf(profile));
  const [rarity, setRarity] = useState<string | null>(null);

  useEffect(() => {
    if (seededRef.current) {
      return;
    }
    seededRef.current = true;
    setDraft((current) => current ?? activeDeckOf(profile));
  }, [profile]);

  // 路由是挂载/卸载式的，cleanup 就是离场钩子：把排队中的卡组写入放出去
  useEffect(() => {
    return () => {
      void store.flush();
    };
  }, [store]);

  const rarityOf = useMemo(
    () => (cardId: string) => cardById.get(cardId)?.rarity ?? null,
    [],
  );

  const owned = useMemo(() => ownedEntries(profile.inventory), [profile.inventory]);

  const entries = useMemo(
    () =>
      sortForCollection(
        filterByRarity(owned, rarityOf, rarity),
        rarityOf,
        (r) => rarityIndex.rankOf(r),
      ),
    [owned, rarity, rarityOf, rarityIndex],
  );

  /*
    筛选条上的禁用态要按**未筛选**的收藏算。
    直接拿 `entries` 判断的话，一旦选了某个稀有度，其余档位全变成「没有」而灰掉——
    图上就再也点不回「全部」以外的档位了。
  */
  const countByRarity = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of owned) {
      const itemRarity = rarityOf(item.cardId);
      if (itemRarity) {
        counts.set(itemRarity, (counts.get(itemRarity) ?? 0) + 1);
      }
    }
    return counts;
  }, [owned, rarityOf]);

  /** 每张卡「还能放几张 / 现在能不能放」——判据来自 `canAddCard`，界面不自算。 */
  const rows = useMemo(() => {
    const map = new Map<string, ReturnType<typeof deckEditorRows>[number]>();
    if (!draft) {
      return map;
    }
    for (const row of deckEditorRows(profile.inventory, draft, (id) => cardById.has(id))) {
      map.set(row.cardId, row);
    }
    return map;
  }, [profile.inventory, draft]);

  const summary = useMemo(
    () => (draft ? deckSummary(draft, profile.inventory) : null),
    [draft, profile.inventory],
  );

  const slots = useMemo(() => (draft ? deckSlots(draft) : []), [draft]);

  /** 卡组满了：此时**每张**卡都不能加，逐卡角标就不必重复同一个理由。 */
  const isFull = draft !== null && draft.cardIds.length >= DECK_LIMIT;

  /** 落盘 + 换草稿。两件事永远一起做，避免「界面变了但没存」。 */
  const commit = (next: Deck): void => {
    setDraft(next);
    store.saveDeck(next);
  };

  const handleAdd = (cardId: string): void => {
    if (!draft) {
      return;
    }
    const outcome = addToDeck(draft, profile.inventory, cardId, systemClock(), (id) =>
      cardById.has(id),
    );
    if (outcome.rejection) {
      pushToast(outcome.message ?? ADD_REJECTION_TEXT[outcome.rejection], 'info');
      return;
    }
    commit(outcome.deck);
  };

  const handleRemove = (index: number): void => {
    if (!draft) {
      return;
    }
    commit(removeCardAt(draft, index, systemClock()));
  };

  const handleClear = (): void => {
    if (!draft || draft.cardIds.length === 0) {
      return;
    }
    commit(clearDeck(draft, systemClock()));
  };

  /*
    没有出战卡组时不让人编辑：改了也没有归属，保存下去会多出一份没人引用的卡组。
    分两种：存档里还有卡组（`decks[0]`）就让人启用它；一份都没有才新建。
  */
  if (!draft) {
    const existing = profile.decks[0] ?? null;
    return (
      <div className="screen deckedit">
        <header className="screen__head">
          <div>
            <h1 className="screen__title">配置</h1>
            <p className="deckedit__lead">
              {existing ? '当前没有选中出战卡组。' : '存档里还没有任何卡组。'}
            </p>
          </div>
        </header>
        <div className="deckedit__empty-actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              if (existing) {
                store.setActiveDeck(existing.id);
                setDraft(existing);
                return;
              }
              const now = systemClock();
              const created = emptyDeck(`deck-${now.getTime()}`, '出战卡组', now);
              store.saveDeck(created);
              store.setActiveDeck(created.id);
              setDraft(created);
            }}
          >
            {existing ? `启用「${existing.name}」` : '新建出战卡组'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen deckedit" ref={parallaxRef}>
      <div
        className="menu__bg deckedit__bg"
        style={background ? { backgroundImage: `url(${background})` } : undefined}
        aria-hidden="true"
      />
      <div className="menu__scrim" aria-hidden="true" />

      <header className="screen__head">
        <div>
          <h1 className="screen__title">配置</h1>
          <p className="deckedit__lead">
            {draft.name} ·{summary?.size ?? 0} / {DECK_LIMIT} 张 · 改动自动保存
          </p>
        </div>
        <div className="deckedit__actions">
          <button
            type="button"
            className="btn"
            onClick={handleClear}
            disabled={draft.cardIds.length === 0}
          >
            清空卡组
          </button>
        </div>
      </header>

      {/* 这个问题是**会真的发生**的：上阵的卡被融合/导入消耗掉之后就不在库存里了 */}
      {summary && summary.text.length > 0 && (
        <ul className="deckedit__issues">
          {summary.text.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}

      {/*
        「卡组已满」**只说一次**，不做成每张卡上的角标：
        满的时候两百多张卡全都是同一个理由，铺满屏幕的角标只会让人看不见卡面。
        逐卡角标留给「这一张为什么不能放」——那是每张卡不一样的（已上阵 / 不认识的卡）。
      */}
      {isFull && (
        <p className="deckedit__hint" data-testid="deck-full">
          {ADD_REJECTION_TEXT.full}——先移出一张，再加新的
        </p>
      )}

      <div className="deckedit__body">
        <section className="deckedit__slots" aria-label="出战卡组">
          <h2 className="deckedit__heading">出战卡组 · 点击卡牌移出</h2>
          <div className="deckedit__grid">
            {slots.map((slot) =>
              slot.cardId ? (
                <CardTile
                  key={`${slot.index}-${slot.cardId}`}
                  cardId={slot.cardId}
                  size="sm"
                  onClick={() => handleRemove(slot.index)}
                  onHover={(hovered, element) =>
                    setTip(
                      hovered && element && slot.cardId
                        ? { cardId: slot.cardId, rect: element.getBoundingClientRect() }
                        : null,
                    )
                  }
                />
              ) : (
                <div key={`empty-${slot.index}`} className="deckedit__slot" aria-hidden="true">
                  {slot.index + 1}
                </div>
              ),
            )}
          </div>
        </section>

        <section className="deckedit__collection" aria-label="收藏">
          <div className="deckedit__filter" role="group" aria-label="按稀有度筛选">
            <button
              type="button"
              className={rarity === null ? 'chip chip--on' : 'chip'}
              onClick={() => setRarity(null)}
            >
              全部
            </button>
            {rarityIndex.order.map((entry) => (
              <button
                key={entry}
                type="button"
                className={rarity === entry ? 'chip chip--on' : 'chip'}
                onClick={() => setRarity(entry)}
                disabled={(countByRarity.get(entry) ?? 0) === 0}
                title={
                  (countByRarity.get(entry) ?? 0) === 0 ? `还没有${entry}的卡` : undefined
                }
              >
                <span
                  className="chip__dot"
                  style={{ background: rarityIndex.colorOf(entry) }}
                  aria-hidden="true"
                />
                {entry}
                {/* 数量与图鉴保持一致，两边的筛选条读起来才是一个东西 */}
                <span className="chip__count">{countByRarity.get(entry) ?? 0}</span>
              </button>
            ))}
          </div>

          <ScrollArea>
            {entries.length === 0 ? (
              <p className="deckedit__lead">这个稀有度下还没有卡。</p>
            ) : (
              <div className="card-grid">
                {entries.map((entry) => {
                  const row = rows.get(entry.cardId);
                  /*
                    能放 → 显示**可用张数**并在点了以后减一；
                    不能放 → 显示拥有数并常显理由（角标文案）。
                    常显而不是只挂在 title 上：玩家一眼要能看出「为什么点不动」。
                    「卡组已满」除外：那个理由对每张卡都一样，见上面的单独提示。
                  */
                  const blocked = row ? !row.add.ok : true;
                  const reason = row && !row.add.ok ? row.add.reason : null;
                  const note =
                    reason && reason !== 'full' ? ADD_REJECTION_NOTE[reason] : undefined;
                  return (
                    <span
                      key={entry.cardId}
                      className="deckedit__wrap"
                      /* 悬停包在外面：卡被禁用时按钮不派发鼠标事件，见 CSS 的注释 */
                      onMouseEnter={(event) =>
                        setTip({
                          cardId: entry.cardId,
                          rect: event.currentTarget.getBoundingClientRect(),
                        })
                      }
                      onMouseLeave={() => setTip(null)}
                    >
                    <CardTile
                      cardId={entry.cardId}
                      count={blocked ? entry.count : (row?.available ?? entry.count)}
                      /*
                        角标常显：这里的角标是**可用张数**，
                        从 2 加到 1、再变成「已上阵」的整个过程都是玩家要看的反馈。
                      */
                      showCount
                      size="sm"
                      disabled={blocked}
                      note={note}
                      onClick={() => handleAdd(entry.cardId)}
                    />
                    </span>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </section>
      </div>

      {tip && <CardHoverTip cardId={tip.cardId} rect={tip.rect} />}
    </div>
  );
}
