import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cardById, cardDatabase, fusionSpec } from '../data';
import { backgroundUrl } from '../data/assets';
import type { ProfileState } from '../domain/progression/types';
import type { ProfileStore } from '../state/createProfileStore';
import { useRarityIndex } from '../state/useRarityIndex';
import { buildCardPool, probabilityRows } from '../domain/progression/gacha';
import { fusionMaterialCounts, fusionRaritySlots, planFusion, type FusionResult } from '../domain/progression/fusion';
import { createRng, seedFrom } from '../domain/battle/rng';
import { ownedEntries, sortForCollection } from '../domain/progression/collection';
import { DesignStage } from '../ui/DesignStage';
import { CurrencyBar } from '../ui/CurrencyBar';
import { CardTile } from '../ui/CardTile';
import { CardShowcase } from '../ui/CardShowcase';
import { ScrollArea } from '../ui/ScrollArea';
import '../ui/fusionWorkshop.css';
import { FusionAltarStage, type FusionAltarRun } from '../rendering/fusion/FusionAltarStage';

export interface FusionSceneProps {
  readonly profile: ProfileState;
  readonly store: ProfileStore;
  readonly busy: boolean;
  readonly onReturn: () => void;
}

const emptySlots = (): (string | null)[] => Array.from({ length: fusionSpec.altarSlots }, () => null);
const pool = buildCardPool(cardDatabase.definitions);

export function FusionScene({ profile, store, busy, onReturn }: FusionSceneProps) {
  const index = useRarityIndex();
  const [slots, setSlots] = useState<readonly (string | null)[]>(emptySlots);
  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [run, setRun] = useState<FusionAltarRun | null>(null);
  const [latest, setLatest] = useState<FusionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const locked = pending || busy || presenting;
  const materials = slots.filter((id): id is string => id !== null);
  const counts = fusionMaterialCounts(slots);
  const probabilityMaterials = presenting && run ? run.materials.map((card) => card.cardId) : materials;
  const rows = probabilityRows(fusionRaritySlots(probabilityMaterials, cardById, pool, fusionSpec));
  const cards = slots.map((id) => id ? cardById.get(id) ?? null : null);
  const entries = useMemo(() => sortForCollection(ownedEntries(profile.inventory),
    (id) => cardById.get(id)?.rarity ?? null, index.rankOf).filter(({ cardId }) => {
    const card = cardById.get(cardId);
    return card?.status === 'complete' && fusionSpec.rarityOrder.includes(card.rarity);
  }), [profile.inventory, index]);
  const visible = entries.filter(({ cardId }) => {
    const card = cardById.get(cardId)!;
    return (filter === 'all' || card.rarity === filter) && (!query.trim() || `${card.name} ${cardId}`.toLowerCase().includes(query.trim().toLowerCase()));
  });
  const inDeck = new Set(profile.decks.flatMap((deck) => deck.cardIds));

  const add = (id: string): void => {
    if (locked || submitting.current) return;
    if (materials.length >= fusionSpec.altarSlots) { setError('祭坛已满，请先取回一张材料'); return; }
    if ((profile.inventory[id] ?? 0) <= (counts[id] ?? 0)) { setError('该卡牌可用数量不足'); return; }
    setError(null); setRun(null);
    setSlots((previous) => {
      const next = [...previous]; const empty = next.indexOf(null);
      if (empty >= 0) next[empty] = id;
      return next;
    });
  };
  const remove = (slot: number): void => {
    if (locked || submitting.current) return;
    setError(null);
    setSlots((previous) => previous.map((id, i) => i === slot ? null : id));
  };
  const finished = useCallback(() => { setPresenting(false); }, []);
  const fuse = async (): Promise<void> => {
    if (locked || submitting.current) return;
    submitting.current = true; setPending(true); setError(null);
    const chosen = [...materials];
    const operationId = store.nextOperationId();
    const rng = createRng(seedFrom(operationId));
    try {
      const outcome = await store.commitEconomic<FusionResult>((current) => planFusion({
        profile: current, materials: chosen, definitions: cardById, pool, spec: fusionSpec, rng, operationId,
      }));
      if (!mounted.current) return;
      if (!outcome.ok) { setError(outcome.message); return; }
      const result = cardById.get(outcome.view.cardId)!;
      setSlots(emptySlots()); setLatest(outcome.view); setPresenting(true);
      setRun({ operationId, materials: chosen.map((id) => cardById.get(id)!), result, color: index.colorOf(result.rarity) });
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !locked && !preview) onReturn();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [locked, preview, onReturn]);

  return <DesignStage backgroundUrl={backgroundUrl('bg/activity')} className="fusion-workshop">
    <section className="fusion" aria-label="融合工坊">
      <header className="fusion__header">
        <CurrencyBar currencies={profile.currencies} />
        <h1>融 合 工 坊</h1>
        <button type="button" className="btn" onClick={onReturn} disabled={locked}>返回菜单</button>
      </header>
      <section className="fusion__collection" aria-label="牌库">
        <h2>牌库 <small>点击投入祭坛</small></h2>
        <div className="fusion__filters">
          <input aria-label="搜索融合材料" placeholder="搜索卡牌" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select aria-label="材料稀有度" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">全部稀有度</option>
            {fusionSpec.rarityOrder.map((rarity) => <option key={rarity} value={rarity}>{rarity}</option>)}
          </select>
        </div>
        <ScrollArea><div className="fusion__grid">
          {visible.map(({ cardId, count }) => <CardTile key={cardId} cardId={cardId} count={Math.max(0, count - (counts[cardId] ?? 0))}
            showCount size="sm" disabled={locked || materials.length === fusionSpec.altarSlots || count <= (counts[cardId] ?? 0)}
            selected={(counts[cardId] ?? 0) > 0} note={inDeck.has(cardId) ? '已入卡组' : undefined} onClick={() => add(cardId)} />)}
          {!visible.length && <p className="fusion__empty">暂无符合条件的材料卡牌</p>}
        </div></ScrollArea>
      </section>
      <section className="fusion__altar" aria-label="五槽祭坛">
        <div className="fusion__altar-heading"><span>炼 成 祭 坛</span><small>投入五张材料，让灵光在圆环中汇聚</small></div>
        <div className="fusion__canvas"><FusionAltarStage cards={cards} run={run} completed={!presenting} onRemove={remove}
          onPreview={(card) => setPreview(card.cardId)} onFinished={finished} /></div>
        <div className="fusion__slots">
          {slots.map((id, i) => <button key={i} type="button" className="fusion__slot" disabled={!id || locked}
            onClick={() => remove(i)} data-card-id={id ?? undefined} aria-label={`取回第 ${i + 1} 槽${id ? ` ${cardById.get(id)?.name ?? id}` : '（空）'}`}>
            <span>{i + 1}</span>{id ? cardById.get(id)?.name ?? id : '空槽'}
          </button>)}
        </div>
        <div className="fusion__actions">
          <button type="button" className="btn" disabled={!materials.length || locked} onClick={() => { setSlots(emptySlots()); setError(null); }}>取回全部</button>
          {presenting && <button type="button" className="btn" data-testid="skip-fusion" onClick={finished}>跳过演出</button>}
          <button type="button" className="btn btn--primary" data-testid="fuse" disabled={materials.length !== fusionSpec.altarSlots || locked}
            onClick={() => { void fuse(); }}>{pending ? '正在保存…' : presenting ? '融合中…' : '消耗 5 张并融合'}</button>
        </div>
        <p className="fusion__hint">{presenting ? '五张材料正在汇聚，结果已保存' : `${materials.length} / ${fusionSpec.altarSlots} 张 · 免费融合 · 点击祭坛卡牌可取回`}</p>
        {materials.some((id) => inDeck.has(id)) && <p className="fusion__deck-note">包含卡组中的材料，融合后请检查出战配置。</p>}
        {error && <p className="fusion__error" role="alert">{error}</p>}
      </section>
      <aside className="fusion__info">
        <h2>融合概率</h2>
        <p>投入材料后实时计算；集齐五张即可融合。</p>
        <ul className="fusion__probabilities">{rows.map((row) => <li key={row.rarity} style={{ color: index.colorOf(row.rarity) }}>
          <span>{row.rarity}</span><strong>{row.percent.toFixed(2)}%</strong>
        </li>)}</ul>
        {!rows.length && <p className="fusion__empty">放入卡牌可查看概率</p>}
        <p className="fusion__rules">每张材料只影响自身及上下各两档稀有度，距离越远权重越低。最高产出不超过最高材料的上两档；可能获得同名或较低档卡牌。</p>
        <div className="fusion__latest"><h2>最新结果</h2>
          {latest ? <button type="button" className="fusion__result" data-card-id={latest.cardId} disabled={presenting} onClick={() => setPreview(latest.cardId)}>
            <strong style={{ color: index.colorOf(latest.rarity) }}>{latest.rarity} · {cardById.get(latest.cardId)?.name}</strong>
            <span>{presenting ? '正在显现…' : '已加入收藏 · 点击查看详情'}</span>
          </button> : <p>暂无融合记录</p>}
        </div>
      </aside>
    </section>
    {preview && <CardShowcase cardId={preview} cardIds={[preview]} onSelect={setPreview} onClose={() => setPreview(null)} />}
  </DesignStage>;
}
