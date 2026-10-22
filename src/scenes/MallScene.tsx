import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { RouteId } from '../app/routes';
import { cardById, cardDatabase, shopSpecs } from '../data';
import { backgroundUrl, CARD_BACK_URL, cardArtUrl, cardFaceUrl } from '../data/assets';
import { createRng, seedFrom } from '../domain/battle/rng';
import { buildShelf, planPurchase, type ShelfEntry } from '../domain/progression/shop';
import type { ProfileState } from '../domain/progression/types';
import type { ProfileStore } from '../state/createProfileStore';
import { useRarityIndex } from '../state/useRarityIndex';
import { useSettingsStore } from '../state/settingsStore';
import { ArtButtonSurface, artButtonStyle } from '../ui/ArtButtonSurface';
import { DesignStage } from '../ui/DesignStage';
import { HubLogoLayer, type HubLogoItem } from '../ui/HubLogoLayer';
import { CurrencyBar } from '../ui/CurrencyBar';
import '../ui/hubMenu.css';
import '../ui/mall.css';

type ShopKind = keyof typeof shopSpecs;
interface MallTab extends HubLogoItem {
  readonly label: string;
  readonly subtitle: string;
  readonly art: string;
  readonly source?: ShopKind;
  readonly shelves?: readonly string[];
}
const TABS: readonly MallTab[] = [
  { id: 'home', label: '商城首页', subtitle: '新内容与精选推荐', kind: 'market', color: '#dfc38a', art: 'SS_001' },
  { id: 'myth', label: '神话典藏', subtitle: '每日神话货架 · SSS / SS+ / SS', kind: 'collection', color: '#e3bc73', art: 'SSS_001', source: 'normal', shelves: ['top'] },
  { id: 'legacy', label: '传承精选', subtitle: '每日传承货架 · S+ / S / A+ / A', kind: 'deck', color: '#c4b4df', art: 'S_002', source: 'normal', shelves: ['middle'] },
  { id: 'explore', label: '探索补给', subtitle: '每日探索货架 · B+ 至 D', kind: 'gacha', color: '#a9cdb5', art: 'A+_002', source: 'normal', shelves: ['bottom'] },
  { id: 'packs', label: '特典卡包', subtitle: '购买即获得一张指定稀有度的随机卡牌', kind: 'gacha', color: '#edc37c', art: 'SSS_008', source: 'normal', shelves: ['pack'] },
  { id: 'event', label: '活动精选', subtitle: '限定活动卡牌 · 徽章兑换', kind: 'activity', color: '#c7acd7', art: 'SS+_005', source: 'activity', shelves: ['top'] },
  { id: 'exchange', label: '徽章兑换', subtitle: '活动稀有与常规货架 · 徽章兑换', kind: 'market', color: '#9dc8ca', art: 'A+_006', source: 'activity', shelves: ['middle', 'bottom'] },
];

// Exactly the same pool and shelf keys as the original two shops: stock is shared.
const CARDS_BY_RARITY = new Map<string, string[]>();
for (const card of cardDatabase.definitions) {
  if (card.status !== 'complete') continue;
  const pool = CARDS_BY_RARITY.get(card.rarity) ?? [];
  pool.push(card.cardId);
  CARDS_BY_RARITY.set(card.rarity, pool);
}
for (const pool of CARDS_BY_RARITY.values()) pool.sort();

export function MallScene({ profile, store, busy, initialTab = 'home', onNavigate }: {
  readonly profile: ProfileState;
  readonly store: ProfileStore;
  readonly busy: boolean;
  readonly initialTab?: string;
  readonly onNavigate: (route: RouteId) => void;
}) {
  const [tabId, setTabId] = useState(initialTab);
  useEffect(() => { setTabId(initialTab); }, [initialTab]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [dayKey, setDayKey] = useState(() => store.todayKey());
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const purchaseLock = useRef(false);
  const mounted = useRef(true);
  const anchors = useRef(new Map<string, HTMLSpanElement>());
  const rail = useRef<HTMLDivElement>(null);
  const still = useSettingsStore(state => state.reduceMotion);
  const rarityIndex = useRarityIndex();
  const tab = TABS.find(item => item.id === tabId) ?? TABS[0]!;
  const source = tab.source ?? 'normal';
  const spec = shopSpecs[source];
  const shelf = useMemo(() => spec ? buildShelf({
    dayKey, spec, cardsByRarity: CARDS_BY_RARITY,
    soldOut: profile.shop.soldOut.filter(id => id.startsWith(`${dayKey}|`)),
  }) : [], [dayKey, spec, profile.shop.soldOut]);
  const products = shelf.filter(entry => tab.shelves?.includes(entry.shelfKey));

  useEffect(() => {
    mounted.current = true;
    const refresh = () => setDayKey(store.todayKey());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => { mounted.current = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [store]);
  useEffect(() => { rail.current?.scrollTo({ left: 0 }); }, [tabId, dayKey]);

  const buy = async (entry: ShelfEntry) => {
    if (busy || purchaseLock.current || entry.soldOut) return;
    purchaseLock.current = true;
    setPending(entry.entryId);
    setNotice('');
    const operationId = store.nextOperationId();
    try {
      const result = await store.commitEconomic(current => {
        const today = store.todayKey();
        if (today !== dayKey) return { rejected: '货架已刷新，请查看今日商品后重新购买' };
        if (!spec) return { rejected: '该货架暂未开放' };
        const fresh = buildShelf({ dayKey: today, spec, cardsByRarity: CARDS_BY_RARITY,
          soldOut: current.shop.soldOut }).find(item => item.entryId === entry.entryId);
        if (!fresh) return { rejected: '该商品已下架' };
        return planPurchase({ profile: current, entry: fresh, operationId,
          cardsByRarity: CARDS_BY_RARITY, rng: createRng(seedFrom(operationId)) });
      });
      if (mounted.current) {
        setDayKey(store.todayKey());
        setNotice(result.ok ? `已获得 ${cardById.get(result.view.cardId)?.name ?? result.view.cardId}，已加入牌库` : result.message);
      }
    } finally {
      purchaseLock.current = false;
      if (mounted.current) setPending(null);
    }
  };
  const scroll = (direction: number) => rail.current?.scrollBy({
    left: direction * rail.current.clientWidth * .75, behavior: still ? 'instant' : 'smooth',
  });

  return <DesignStage className="mall-menu" parallax={false} backgroundUrl={backgroundUrl(source === 'activity' ? 'bg/activity' : 'bg/shop')}>
    <header className="mall-header">
      <div><span className="mall-eyebrow">CARD MASTER · MERCHANT GALLERY</span><h1>商城</h1></div>
      <div className="mall-wallet"><CurrencyBar currencies={profile.currencies} /></div>
      <button type="button" className="art-button mall-return" onClick={() => onNavigate('hub')}><ArtButtonSurface /><span>返回大厅</span></button>
    </header>
    <main className="mall-main" id="mall-products" role="tabpanel" aria-labelledby={`mall-tab-${tab.id}`}>
      <div className="mall-heading"><div><h2>{tab.label}</h2><p>{tab.subtitle}</p></div>
        {tab.id !== 'home' && <small>每日更新 · {products.length} 件商品 / 20 个展示位</small>}</div>
      {tab.id === 'home' ? <div className="mall-posters" aria-label="商城海报入口预留区" tabIndex={0}>
        {['精选推荐', '每日补给', '活动特选', '典藏卡包'].map((label, index) => <div className="mall-poster-placeholder" key={label}>
          <span className="mall-poster-number">0{index + 1}</span><div><h3>{label}</h3><p>海报展示位 · 敬请期待</p></div><span className="mall-poster-note">入口尚未开放</span>
        </div>)}
      </div> : <div className="mall-catalog">
        <button type="button" className="mall-scroll mall-scroll--left" aria-label="向左浏览商品" onClick={() => scroll(-1)}>‹</button>
        <div ref={rail} className="mall-product-rail" tabIndex={0} aria-label={`${tab.label}商品，可左右滚动`}
          onWheel={event => {
            const target = event.currentTarget;
            if (target.scrollWidth <= target.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
            target.scrollLeft += event.deltaY;
          }}>
          {products.map(entry => {
            const name = entry.cardId ? cardById.get(entry.cardId)?.name ?? entry.cardId : entry.label;
            const image = entry.cardId ? cardFaceUrl(entry.cardId, 'battle') : CARD_BACK_URL;
            const unit = entry.price.currency === 'gold' ? '金币' : entry.price.currency === 'crystal' ? '水晶' : '徽章';
            const affordable = profile.currencies[entry.price.currency] >= entry.price.amount;
            return <article key={entry.entryId} className={`mall-product${entry.soldOut ? ' mall-product--sold' : ''}`}
              data-entry-id={entry.entryId} style={{ '--rarity': rarityIndex.colorOf(entry.rarity) } as CSSProperties}>
              <div className={`mall-product-art${entry.kind === 'pack' ? ' mall-product-art--pack' : ''}`} data-card-id={entry.cardId ?? undefined}>
                {image ? <img src={image} alt={name} loading="lazy" decoding="async" draggable={false} /> : <span>{name}</span>}
                <span className="mall-rarity">{entry.rarity}</span>
                {entry.soldOut && <strong className="mall-sold">今日售罄</strong>}
              </div>
              <div className="mall-product-info"><h3 title={name}>{name}</h3><small>{entry.note || spec?.shelves[entry.shelfKey]?.label}</small>
                <button type="button" className="art-button art-button--gold mall-buy"
                  disabled={entry.soldOut || busy || pending !== null || !affordable}
                  title={!affordable && !entry.soldOut ? `${unit}不足` : `购买${name}`}
                  onClick={() => void buy(entry)}><ArtButtonSurface /><span>{entry.soldOut ? '已售罄' : pending === entry.entryId ? '购买中…' : `${entry.price.amount.toLocaleString()} ${unit}`}</span></button>
              </div>
            </article>;
          })}
          {Array.from({ length: Math.max(0, 20 - products.length) }, (_, index) => <article className="mall-product mall-product--empty" key={`empty:${index}`} aria-label="暂无上架商品">
            <div className="mall-empty-card" aria-hidden="true"><span>◇</span></div>
            <div className="mall-product-info"><h3>待上架</h3><small>展示位 {String(products.length + index + 1).padStart(2, '0')}</small><span className="mall-empty-label">暂无商品</span></div>
          </article>)}
        </div>
        <button type="button" className="mall-scroll mall-scroll--right" aria-label="向右浏览商品" onClick={() => scroll(1)}>›</button>
        <p className="mall-scroll-hint">滚轮 / 拖动底部滚动条 / 左右箭头浏览</p>
      </div>}
    </main>
    <p className="mall-notice" role="status" aria-live="polite">{notice}</p>
    <nav className="mall-dock" role="tablist" aria-label="商城分类">
      {TABS.map((item, index) => <button key={item.id} id={`mall-tab-${item.id}`} type="button" role="tab"
        aria-selected={item.id === tabId} aria-controls="mall-products" tabIndex={item.id === tabId ? 0 : -1}
        className={`hub-button hub-dock__item art-button${item.id === tabId ? ' art-button--gold hub-button--active' : ''}`}
        style={{ ...artButtonStyle(cardArtUrl(item.art) ?? cardFaceUrl(item.art, 'battle')),
          '--hub-color': item.color, '--hub-from': '#202630ee', '--hub-to': '#48453cee' } as CSSProperties}
        onPointerEnter={() => setHoverId(item.id)} onPointerLeave={() => setHoverId(null)}
        onFocus={() => setHoverId(item.id)} onBlur={() => setHoverId(null)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault(); setTabId(TABS[next]!.id);
          document.getElementById(`mall-tab-${TABS[next]!.id}`)?.focus();
        }} onClick={() => setTabId(item.id)}>
        <ArtButtonSurface /><span className="hub-logo-anchor" aria-hidden="true" ref={node => {
          if (node) anchors.current.set(item.id, node); else anchors.current.delete(item.id);
        }} /><span className="hub-button__copy"><strong>{item.label}</strong></span>
      </button>)}
    </nav>
    <HubLogoLayer items={TABS} anchors={anchors} activeId={hoverId ?? tabId} still={still} />
  </DesignStage>;
}
