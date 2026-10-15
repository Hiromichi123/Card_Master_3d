import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { cardById, cardDatabase } from '../data';
import { systemClock } from '../domain/progression/clock';
import {
  ADD_REJECTION_NOTE,
  ADD_REJECTION_TEXT,
  DECK_LIMIT,
  clearDeck,
  removeCardAt,
} from '../domain/progression/deck';
import { addToDeck, deckEditorRows, deckSlots, deckSummary } from '../domain/progression/deckView';
import type { RouteId } from '../app/routes';
import { collectionCompletion, filterByRarity, ownedEntries, sortForCollection } from '../domain/progression/collection';
import type { Deck, ProfileState } from '../domain/progression/types';
import type { ProfileStore } from '../state/createProfileStore';
import { pushToast } from '../state/toastStore';
import { useRarityIndex } from '../state/useRarityIndex';
import { CardTile } from '../ui/CardTile';
import { ScrollArea } from '../ui/ScrollArea';
import { useParallax } from '../ui/useParallax';
import { CrossfadeBackground } from '../ui/SceneBackground';
import { assetManifest } from '../data/assets';
import '../ui/deckEditor.css';

/**
 * 配置（组卡）。
 *
 * 左侧放大的 12 槽、右侧紧凑收藏；保留原版 `scenes/deck_builder_scene.py` 的布局。
 * **两处按本项目的现状改了做法**（照搬不了的地方，写在这里）：
 *
 * 1. **点击加入 / 点击移出**，不是拖拽。旧版是拖拽，但 DOM 里把卡从滚动容器拖进槽位
 *    要做命中判定、自动滚动、触屏适配，收益只是手感；点击在触屏与键盘上一样能用，
 *    浏览器用例也能直接断「点一下加了几张」。
 * 2. **改动自动保存**。三套普通配置与天梯配置分别保存，切页签不更改普通出战选择。
 *    草稿放在 store 的会话状态，切页签或全局导航卸载都不会丢掉失败待写项。
 *
 * 页面读取草稿即时反馈；页内导航与设为出战使用 `flushDecks` 的真实结果，
 * 保存失败留在当前页，并保留草稿供重试，不把旧存档当成已保存的新配置。
 */
export interface DeckEditorSceneProps {
  readonly profile: ProfileState;
  readonly store: ProfileStore;
  readonly initialDeckId?: string | undefined;
  readonly battleReturnRoute?: RouteId | undefined;
  readonly onNavigate?: ((route: RouteId) => void) | undefined;
}

export function DeckEditorScene({ profile: initialProfile, store, initialDeckId, onNavigate, battleReturnRoute = 'battlemenu' }: DeckEditorSceneProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const profile = snapshot.profile ?? initialProfile;
  const rarityIndex = useRarityIndex();
  /*
    背景：旧版的组卡界面**没有**自己的背景图（`deck_builder_scene.py` 里没有背景），
    这里借主菜单那张——它是这一组界面里最中性的一张，也和其它菜单连成一套。
    顺带把视差也带上（同一套 `useParallax` + `.menu__bg`）。
  */
  const parallaxRef = useParallax();
  const background = assetManifest.shared.menu['menu_bg']?.url ?? null;

  const [selectedId, setSelectedId] = useState(() => {
    const preferred = initialDeckId ?? profile.activeDeckId;
    return preferred && profile.decks.some(deck => deck.id === preferred)
      ? preferred : profile.normalDeckIds[0];
  });
  const draft = store.getDeckDraft(selectedId);
  const [rarity, setRarity] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionLock = useRef(false);
  const mounted = useRef(true);
  const disabled = working || snapshot.busy;
  const isLadder = selectedId === profile.ladder.deckId;
  const tabs = [
    ...profile.normalDeckIds.map((id, index) => ({ id, label: `卡组${index + 1}` })),
    { id: profile.ladder.deckId, label: '天梯赛卡组' },
  ];
  const selectedLabel = tabs.find(tab => tab.id === selectedId)?.label ?? draft?.name ?? '卡组';
  const extraDecks = profile.decks.filter(deck => !tabs.some(tab => tab.id === deck.id));
  const saveError = actionError ?? snapshot.deckSaveError;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void store.flushDecks();
    };
  }, [store]);

  const saveThen = async (action: 'retry' | 'activate' | RouteId): Promise<void> => {
    if (actionLock.current || snapshot.busy || (action === 'activate' && isLadder)) return;
    actionLock.current = true;
    setWorking(true);
    setActionError(null);
    try {
      const saved = await store.flushDecks();
      if (!mounted.current) return;
      if (!saved.ok) { setActionError(saved.message); return; }
      if (action === 'activate') {
        store.setActiveDeck(selectedId);
        const activated = await store.flushDecks();
        if (!mounted.current) return;
        if (!activated.ok) setActionError(activated.message);
      } else if (action !== 'retry') {
        onNavigate?.(action);
      }
    } finally {
      actionLock.current = false;
      if (mounted.current) setWorking(false);
    }
  };

  const rarityOf = useMemo(
    () => (cardId: string) => cardById.get(cardId)?.rarity ?? null,
    [],
  );

  const owned = useMemo(() => ownedEntries(profile.inventory), [profile.inventory]);
  const completion = useMemo(() => collectionCompletion(profile.inventory, cardDatabase.definitions), [profile.inventory]);

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

  /** 草稿按ID交给store，切页签不会覆盖另一套尚未落盘的修改。 */
  const commit = (next: Deck): void => {
    if (disabled || actionLock.current) return;
    setActionError(null);
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

  if (!draft) {
    return (
      <div className="screen deckedit">
        <h1 className="screen__title">配置</h1>
        <p role="alert">当前卡组不存在，请切换到卡组1。</p>
        <button type="button" className="btn" onClick={() => setSelectedId(profile.normalDeckIds[0])}>编辑卡组1</button>
      </div>
    );
  }

  return (
    <div className="screen deckedit" ref={parallaxRef}>
      <CrossfadeBackground url={background} className="menu__bg deckedit__bg" />
      <div className="menu__scrim" aria-hidden="true" />

      <div className="deckedit__toolbar">
        <div className="deckedit__tabs" role="tablist" aria-label="选择卡组">
          {tabs.map(tab => (
            <button key={tab.id} type="button" role="tab" className="deckedit__tab"
              id={`deck-tab-${tab.id}`} aria-controls="deck-editor-panel" aria-selected={selectedId === tab.id}
              data-deck-id={tab.id} disabled={disabled} onClick={() => setSelectedId(tab.id)}>
              {tab.label}
              {profile.activeDeckId === tab.id && <small>普通出战</small>}
            </button>
          ))}
        </div>
        {extraDecks.length > 0 && (
          <label className="deckedit__other">其他已有卡组
            <select aria-label="其他已有卡组" disabled={disabled}
              value={extraDecks.some(deck => deck.id === selectedId) ? selectedId : ''}
              onChange={event => { if (event.target.value) setSelectedId(event.target.value); }}>
              <option value="">选择卡组</option>
              {extraDecks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}{profile.activeDeckId === deck.id ? '（普通出战）' : ''}</option>)}
            </select>
          </label>
        )}
        {onNavigate && <nav className="deckedit__nav" aria-label="配置页导航">
          <button type="button" className="btn" data-action="battle-menu" disabled={disabled}
            onClick={() => void saveThen(battleReturnRoute)}>{battleReturnRoute === 'coop' ? '返回协力作战' : battleReturnRoute === 'extreme' ? '返回高难挑战' : '前往对战模式'}</button>
          <button type="button" className="btn" data-action="ladder" disabled={disabled}
            onClick={() => void saveThen('ladder')}>返回天梯赛</button>
        </nav>}
      </div>
      <div className="deckedit__save" role="status" aria-live="polite">
        <span>{working ? '正在保存…' : saveError ? `未保存：${saveError}` : snapshot.deckDirty
          ? '修改待保存，切换卡组不会丢失草稿' : snapshot.storage === 'memory' ? '已保存到本次会话' : '所有配置已保存'}</span>
        {(saveError || snapshot.deckDirty) && <button type="button" className="btn" data-action="retry-save" disabled={disabled}
          onClick={() => void saveThen('retry')}>{saveError ? '重试保存' : '立即保存'}</button>}
      </div>

      <div className="deckedit__body" id="deck-editor-panel" role="tabpanel" aria-label={selectedLabel}>
        <section className="deckedit__slots" aria-label="出战卡组" data-deck-id={selectedId}>
          <div className="deckedit__formation-title">
            <h2 className="deckedit__heading">{selectedLabel}</h2>
            <span>{summary?.size ?? 0} / {DECK_LIMIT}</span>
          </div>
          <div className="deckedit__grid">
            {slots.map((slot) =>
              slot.cardId ? (
                <CardTile
                  key={`${slot.index}-${slot.cardId}`}
                  cardId={slot.cardId}
                  size="md"
                  disabled={disabled}
                  onClick={() => handleRemove(slot.index)}
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
      <header className="screen__head deckedit__header">
        <div>
          <h1 className="screen__title">配置</h1>
          <p className="deckedit__lead">
            {draft.name} ·{summary?.size ?? 0} / {DECK_LIMIT} 张 · {isLadder ? '天梯专用，不影响普通出战' : profile.activeDeckId === selectedId ? '当前普通出战' : '编辑不改变普通出战'}
          </p>
        </div>
        <div className="deckedit__actions">
          {!isLadder && <button type="button" className="btn" data-action="activate"
            disabled={disabled || profile.activeDeckId === selectedId}
            onClick={() => void saveThen('activate')}>{profile.activeDeckId === selectedId ? '普通出战中' : '设为普通出战'}</button>}
          <button
            type="button"
            className="btn"
            onClick={handleClear}
            disabled={disabled || draft.cardIds.length === 0}
          >
            清空卡组
          </button>
        </div>
      </header>

      <p className="deckedit__completion" aria-label="卡牌拥有率"
        title="完整卡库的不同卡种（含活动卡）；重复卡与筛选条件不影响拥有率">
        拥有率 <strong>{(completion.ratio * 100).toFixed(2)}%</strong> · 已拥有 {completion.owned}/{completion.total} 种
      </p>

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
                      /*
                        悬停包在外面：卡组满时每张收藏卡都是 `disabled`，
                        而**禁用的按钮不派发鼠标事件**。包装元素带上 `data-card-id`，
                        全局的悬停委托（`CardTipHost`）就能认出来。
                      */
                      data-card-id={entry.cardId}
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
                      disabled={disabled || blocked}
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
    </div>
  );
}
