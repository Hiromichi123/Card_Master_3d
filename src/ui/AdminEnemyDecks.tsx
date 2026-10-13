import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { cardById, cardDatabase, decks, stages } from '../data';
import { seedFrom } from '../domain/battle/rng';
import type { BattleConfig } from '../domain/battle/types';
import { activeDeckOf } from '../domain/progression/profile';
import { ladderDeckOf } from '../domain/progression/deckSlots';
import { cloneEnemyDeckConfig, generateConfiguredLadderEnemy, generateFromEnemyPreset,
  type EnemyDeckConfig, type GeneratedEnemyDeck, type LadderEnemyPreset } from '../domain/progression/enemyDeckConfig';
import { decodeEnemyConfig, defaultEnemyDeckConfig, useEnemyDeckConfigStore } from '../state/enemyDeckConfigStore';
import type { ProfileStore } from '../state/createProfileStore';
import { hideCardTip } from '../state/cardTipStore';
import { useRarityIndex } from '../state/useRarityIndex';
import { downloadJson } from '../services/save/downloadJson';
import { definitionsFor } from '../scenes/campaignFlow';
import { BattleScene } from '../scenes/BattleScene';
import { CardTile } from './CardTile';
import './adminEnemyDecks.css';

const stageList = stages.chapters.flatMap(chapter => chapter.stages.map(stage => ({ id: stage.id, name: stage.name, chapter: chapter.name })));
const bounded = (text: string, max: number) => Math.min(max, Math.max(0, Math.trunc(Number(text) || 0)));

export function AdminEnemyDecks({ store, busy, trialAllowed }: { readonly store: ProfileStore | null; readonly busy: boolean; readonly trialAllowed: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="btn btn--tiny" disabled={!store || busy} onClick={() => setOpen(true)}>敌方卡组配置</button>
    {open && store && <EnemyDeckEditor store={store} trialAllowed={trialAllowed} onClose={() => { hideCardTip(); setOpen(false); }} />}
  </>;
}

function EnemyDeckEditor({ store, trialAllowed, onClose }: { readonly store: ProfileStore; readonly trialAllowed: boolean; readonly onClose: () => void }) {
  const configState = useEnemyDeckConfigStore(), rarity = useRarityIndex();
  const [draft, setDraft] = useState<EnemyDeckConfig>(() => cloneEnemyDeckConfig(configState.config));
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(configState.config));
  const revision = useRef(configState.revision), dialog = useRef<HTMLDialogElement>(null), alive = useRef(true);
  const [mode, setMode] = useState<'campaign' | 'ladder'>('campaign');
  const [stageId, setStageId] = useState(stageList[0]?.id ?? '');
  const [presetId, setPresetId] = useState(configState.config.ladderPresets[0]?.id ?? '');
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null), [query, setQuery] = useState(''), [rarityFilter, setRarityFilter] = useState('');
  const [page, setPage] = useState(0), [message, setMessage] = useState(''), [reading, setReading] = useState(false);
  const [points, setPoints] = useState(store.getSnapshot().profile?.ladder.points ?? 0), [seed, setSeed] = useState(314159);
  const [sample, setSample] = useState<GeneratedEnemyDeck | null>(null), [trial, setTrial] = useState<BattleConfig | null>(null);
  const dirty = JSON.stringify(draft) !== savedJson;
  const preset = draft.ladderPresets.find(p => p.id === presetId) ?? draft.ladderPresets[0] ?? null;
  const originalDeck = (decks.enemy[stageId]?.cardIds ?? []).slice(0, 12);
  const cardIds = mode === 'campaign' ? draft.campaign[stageId] ?? originalDeck : preset?.cardIds ?? [];
  const title = mode === 'campaign' ? `${stageId} ${stageList.find(s => s.id === stageId)?.name ?? ''}` : preset?.name ?? '暂无天梯预设';
  const candidates = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return cardDatabase.definitions.filter(c => c.status === 'complete' && (!rarityFilter || c.rarity === rarityFilter)
      && (!text || `${c.cardId} ${c.name} ${c.rawTraits.join(' ')}`.toLocaleLowerCase().includes(text)))
      .slice().sort((a, b) => rarity.order.indexOf(a.rarity) - rarity.order.indexOf(b.rarity) || a.cardId.localeCompare(b.cardId));
  }, [query, rarityFilter, rarity.order]);
  const pages = Math.max(1, Math.ceil(candidates.length / 48)), safePage = Math.min(page, pages - 1);
  useEffect(() => { setPage(0); }, [query, rarityFilter]);
  useEffect(() => { setSelectedSlot(null); setSample(null); hideCardTip(); }, [mode, stageId, presetId]);
  useEffect(() => {
    alive.current = true; const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => { alive.current = false; hideCardTip(); dialog.current?.close(); previous?.focus({ preventScroll: true }); };
  }, []);
  const close = () => {
    if (reading) return;
    if (trial) { hideCardTip(); setTrial(null); return; }
    if (!dirty || window.confirm('敌阵配置尚未保存，关闭并放弃当前草稿？')) onClose();
  };
  const updatePreset = (patch: Partial<LadderEnemyPreset>) => {
    if (!preset) return;
    setDraft(d => ({ ...d, ladderPresets: d.ladderPresets.map(p => p.id === preset.id ? { ...p, ...patch } : p) }));
    setSample(null);
  };
  const updateCards = (next: readonly string[]) => {
    if (mode === 'campaign') setDraft(d => ({ ...d, campaign: { ...d.campaign, [stageId]: [...next] } }));
    else updatePreset({ cardIds: next });
    setSample(null);
  };
  const insert = (id: string) => {
    if (mode === 'ladder' && !preset) { setMessage('请先新增一套天梯预设。'); return; }
    if (selectedSlot !== null && selectedSlot < cardIds.length) updateCards(cardIds.map((old, i) => i === selectedSlot ? id : old));
    else if (cardIds.length < 12) updateCards([...cardIds, id]); else setMessage('已满12张，请先选中一个槽位替换，或移除卡牌。');
  };
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || from >= cardIds.length || to < 0 || to >= cardIds.length) return;
    const next = [...cardIds], [card] = next.splice(from, 1); if (!card) return;
    next.splice(to, 0, card); updateCards(next); setSelectedSlot(to);
  };
  const drop = (event: DragEvent<HTMLDivElement>, to: number) => {
    event.preventDefault(); const text = event.dataTransfer.getData('application/x-enemy-deck-slot');
    if (!/^\d+$/.test(text)) return; move(Number(text), Math.min(to, cardIds.length - 1));
  };
  const save = () => {
    const result = useEnemyDeckConfigStore.getState().save(draft, revision.current); setMessage(result.message);
    if (result.ok) { const current = useEnemyDeckConfigStore.getState(); revision.current = current.revision;
      setDraft(cloneEnemyDeckConfig(current.config)); setSavedJson(JSON.stringify(current.config)); }
  };
  const reload = () => {
    if (dirty && !window.confirm('重载已保存配置会替换当前未保存草稿，继续？')) return;
    const current = useEnemyDeckConfigStore.getState(); revision.current = current.revision;
    setDraft(cloneEnemyDeckConfig(current.config)); setSavedJson(JSON.stringify(current.config)); setSample(null); setMessage('已重载当前生效配置。');
  };
  const addPreset = () => {
    if (draft.ladderPresets.length >= 32) { setMessage('最多32套天梯预设。'); return; }
    let id = `preset-${Date.now().toString(36)}`; while (draft.ladderPresets.some(p => p.id === id)) id += 'x';
    const base = preset ?? defaultEnemyDeckConfig.ladderPresets[0];
    const next: LadderEnemyPreset = { id, name: `新预设 ${draft.ladderPresets.length + 1}`, enabled: true, minPoints: 0, maxPoints: null, weight: 1,
      cardIds: [...base?.cardIds ?? originalDeck], replaceCount: 2, raritySteps: 1 };
    setDraft(d => ({ ...d, ladderPresets: [...d.ladderPresets, next] })); setPresetId(id); setSample(null);
  };
  const generate = (automatic: boolean) => {
    try {
      const parsed = decodeEnemyConfig(draft); if (!parsed.ok) throw new Error(parsed.message);
      if (!preset && !automatic) throw new Error('请先添加天梯预设。');
      const result = automatic ? generateConfiguredLadderEnemy(parsed.config, cardDatabase.definitions, points, seed)
        : generateFromEnemyPreset(preset!, cardDatabase.definitions, seed);
      setSample(result); setMessage(`已生成 ${result.presetName}，实际替换${result.changes.length}张。再次生成可修改种子，草稿和原预设不变。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '生成失败'); }
  };
  const startTrial = () => {
    const profile = store.getSnapshot().profile; if (!profile) return;
    const playerDeck = mode === 'ladder' ? ladderDeckOf(profile)?.cardIds ?? [] : activeDeckOf(profile)?.cardIds ?? [];
    const enemyDeck = mode === 'ladder' ? sample?.cardIds ?? [] : cardIds;
    if (!playerDeck.length) { setMessage(`请先配置${mode === 'ladder' ? '天梯' : '普通出战'}卡组。`); return; }
    if (!enemyDeck.length || enemyDeck.some(id => cardById.get(id)?.status !== 'complete')) { setMessage('请选择有效敌阵；天梯需先生成浮动预览。'); return; }
    hideCardTip(); setTrial({ seed: mode === 'ladder' ? seed : seedFrom(`${stageId}:${seed}:admin-trial`), playerDeck: [...playerDeck], enemyDeck: [...enemyDeck], label: `开发试玩 · ${mode === 'ladder' ? sample!.presetName : title}` });
  };
  const importFile = async (file: File) => {
    if (file.size > 500000) { setMessage('配置文件超过500KB。'); return; }
    if (dirty && !window.confirm('导入配置会替换当前草稿，继续？')) return;
    setReading(true); hideCardTip();
    try {
      const parsed = decodeEnemyConfig(JSON.parse(await file.text()));
      if (!alive.current) return;
      if (!parsed.ok) { setMessage(parsed.message); return; }
      setDraft(parsed.config); setPresetId(parsed.config.ladderPresets[0]?.id ?? ''); setSelectedSlot(null); setSample(null); setMessage('已载入导入草稿，点击保存后才生效。');
    } catch { if (alive.current) setMessage('JSON读取失败，当前草稿未改变。'); }
    finally { if (alive.current) setReading(false); }
  };
  return <dialog ref={dialog} className={`admin-enemy-editor${trial ? ' admin-enemy-editor--trial' : ''}`} aria-label="开发敌方卡组配置"
    onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
    <header><div><small>ADMIN · ENEMY DECKS</small><h2>{trial ? '试玩对局 · 不结算积分或奖励' : '敌方卡组配置'}</h2></div>
      <button type="button" disabled={reading} onClick={close}>{trial ? '返回配置' : '关闭'}</button></header>
    {trial ? <div className="admin-enemy-editor__trial"><BattleScene key={`${trial.label}:${trial.seed}`} config={trial} definitions={definitionsFor([...trial.playerDeck, ...trial.enemyDeck])}
      autoStart allowRematch={false} onExit={() => setTrial(null)} onLeave={() => setTrial(null)} exitLabel="返回敌阵配置" leaveLabel="返回敌阵配置" /></div> : <>
      <nav className="admin-enemy-editor__toolbar"><button type="button" aria-pressed={mode === 'campaign'} onClick={() => setMode('campaign')}>战役固定卡组</button>
        <button type="button" aria-pressed={mode === 'ladder'} onClick={() => setMode('ladder')}>天梯预设与浮动</button><span>{dirty ? '草稿未保存' : '已保存配置'}</span>
        <button type="button" disabled={reading || !dirty} onClick={save}>保存并生效</button><button type="button" disabled={reading} onClick={reload}>重载已保存</button>
        <button type="button" onClick={() => downloadJson('enemy-deck-config.json', JSON.stringify(draft, null, 2))}>导出草稿JSON</button>
        <label className="admin-enemy-editor__import">导入JSON<input type="file" accept=".json,application/json" disabled={reading} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importFile(file); }} /></label>
      </nav>
      <p className="admin-enemy-editor__note">配置保存在当前浏览器，所有本地账号共享；不受收藏数量限制。保存只影响后续开战，进行中的对局保持原敌阵。试玩不修改存档或积分。</p>
      {(configState.error || message) && <p role="status" className="admin-enemy-editor__message">{message || configState.error}</p>}
      <div className="admin-enemy-editor__layout"><aside className="admin-enemy-editor__targets">
        {mode === 'campaign' ? <><h3>战役关卡</h3>{stageList.map(stage => <button key={stage.id} type="button" aria-pressed={stageId === stage.id} onClick={() => setStageId(stage.id)}>
          <b>{stage.id} · {stage.name}</b><small>{stage.chapter}{draft.campaign[stage.id] ? ' · 自定义' : ' · 项目默认'}</small></button>)}</>
          : <><h3>天梯预设 {draft.ladderPresets.length}/32</h3><button type="button" onClick={addPreset}>＋新增预设</button>{draft.ladderPresets.map(p => <button key={p.id} type="button" aria-pressed={preset?.id === p.id} onClick={() => setPresetId(p.id)}>
            <b>{p.name}</b><small>{p.minPoints}–{p.maxPoints ?? '∞'}分 · {p.enabled ? '启用' : '停用'}</small></button>)}</>}
      </aside><main>
        <div className="admin-enemy-editor__deck-head"><h3>{title}</h3><span>{cardIds.length}/12张 · {new Set(cardIds).size}种</span>
          <button type="button" onClick={() => setSelectedSlot(null)} aria-pressed={selectedSlot === null}>追加模式</button>
          <button type="button" disabled={!cardIds.length} onClick={() => { updateCards([]); setSelectedSlot(null); }}>清空卡组</button>
          {mode === 'campaign' && <button type="button" onClick={() => { setDraft(d => { const campaign = { ...d.campaign }; delete campaign[stageId]; return { ...d, campaign }; }); setSample(null); setSelectedSlot(null); }}>恢复此关默认</button>}
        </div>
        <p className="admin-enemy-editor__note">{selectedSlot === null ? '点击卡库追加；也可选中已有槽位再点卡库替换。' : `正在替换第${selectedSlot + 1}槽。`}拖动槽位卡牌或使用箭头调整顺序；重复卡可加入。</p>
        <div className="admin-enemy-editor__slots">{Array.from({ length: 12 }, (_, i) => <div key={i} data-selected={selectedSlot === i} draggable={!!cardIds[i]}
          onDragStart={event => event.dataTransfer.setData('application/x-enemy-deck-slot', String(i))} onDragOver={event => event.preventDefault()} onDrop={event => drop(event, i)}>
          <small>#{i + 1}</small>{cardIds[i] ? <CardTile cardId={cardIds[i]!} size="sm" onClick={() => setSelectedSlot(i)} /> : <button className="admin-enemy-editor__empty" type="button" onClick={() => setSelectedSlot(null)}>＋</button>}
          {cardIds[i] && <div className="admin-enemy-editor__slot-tools"><button type="button" disabled={i === 0} title="向前移" onClick={() => move(i, i - 1)}>←</button><button type="button" title="移除这张卡" onClick={() => { updateCards(cardIds.filter((_, n) => n !== i)); setSelectedSlot(null); }}>×</button><button type="button" disabled={i === cardIds.length - 1} title="向后移" onClick={() => move(i, i + 1)}>→</button></div>}
        </div>)}</div>
        {mode === 'ladder' && preset && <section className="admin-enemy-editor__rules"><h3>这套预设的生成规则</h3>
          <label>名称<input maxLength={60} value={preset.name} onChange={e => updatePreset({ name: e.target.value })} /></label>
          <label><input type="checkbox" checked={preset.enabled} onChange={e => updatePreset({ enabled: e.target.checked })} />参与随机选取</label>
          <label>最低积分<input type="number" min={0} max={1000000} value={preset.minPoints} onChange={e => updatePreset({ minPoints: bounded(e.target.value, 1000000) })} /></label>
          <label>最高积分（空为不限）<input type="number" min={preset.minPoints} max={1000000} value={preset.maxPoints ?? ''} onChange={e => updatePreset({ maxPoints: e.target.value === '' ? null : bounded(e.target.value, 1000000) })} /></label>
          <label>抽取权重<input type="number" min={1} max={100} value={preset.weight} onChange={e => updatePreset({ weight: Math.max(1, bounded(e.target.value, 100)) })} /></label>
          <label>浮动替换张数<input type="number" min={0} max={12} value={preset.replaceCount} onChange={e => updatePreset({ replaceCount: bounded(e.target.value, 12) })} /></label>
          <label>稀有度上下档数<input type="number" min={0} max={3} value={preset.raritySteps} onChange={e => updatePreset({ raritySteps: bounded(e.target.value, 3) })} /></label>
          <button type="button" onClick={() => { if (window.confirm(`删除预设“${preset.name}”？保存后生效。`)) { setDraft(d => ({ ...d, ladderPresets: d.ladderPresets.filter(p => p.id !== preset.id) })); setPresetId(''); setSample(null); } }}>删除这套</button>
          <p>普通卡替换为指定稀有度范围内的其他原卡；事件卡只在自身事件系列中替换。替换张数为上限，卡库没有替代者时保留原卡。不改变卡牌数值，启用预设先按积分区间筛选，再按权重抽取。</p>
        </section>}
        <section className="admin-enemy-editor__preview"><label>种子<input type="number" min={0} max={4294967295} value={seed} onChange={e => { setSeed(bounded(e.target.value, 4294967295)); setSample(null); }} /></label>
          <button type="button" onClick={() => { setSeed(s => (s + 1) >>> 0); setSample(null); }}>换种子</button>
          {mode === 'ladder' && <><label>模拟积分<input type="number" min={0} max={1000000} value={points} onChange={e => { setPoints(bounded(e.target.value, 1000000)); setSample(null); }} /></label>
            <button type="button" onClick={() => generate(false)}>预览选中预设</button><button type="button" onClick={() => generate(true)}>按积分随机生成</button></>}
          <button type="button" disabled={!trialAllowed || reading || (mode === 'ladder' ? !sample : !cardIds.length)} onClick={startTrial}>试玩此敌阵</button>
          {!trialAllowed && <small>请回大厅、战役选关或天梯大厅后试玩，避免与正在运行的对局冲突。</small>}
          {sample && <><p>生成快照：{sample.presetName} · 替换{sample.changes.length}张（试打使用当前快照，原预设不变）</p><div className="admin-enemy-editor__sample">{sample.cardIds.map((id, i) => <CardTile key={i} cardId={id} size="sm" selected={sample.changes.some(c => c.slot === i)} note={sample.changes.some(c => c.slot === i) ? '浮动替换' : undefined} />)}</div></>}
        </section>
      </main><aside className="admin-enemy-editor__catalogue"><h3>全卡库 · 已完成卡牌</h3><input aria-label="搜索卡牌名称ID或特性" placeholder="名称 / ID / 特性" value={query} onChange={e => setQuery(e.target.value)} />
        <select aria-label="稀有度筛选" value={rarityFilter} onChange={e => setRarityFilter(e.target.value)}><option value="">全部稀有度</option>{rarity.order.map(r => <option key={r} value={r}>{r}</option>)}</select>
        <div className="admin-enemy-editor__cards">{candidates.slice(safePage * 48, (safePage + 1) * 48).map(card => <CardTile key={card.cardId} cardId={card.cardId} size="sm" count={cardIds.filter(id => id === card.cardId).length} showCount onClick={() => insert(card.cardId)} />)}</div>
        <nav><button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>上一页</button><span>{safePage + 1}/{pages} · {candidates.length}张</span><button type="button" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}>下一页</button></nav>
      </aside></div>
    </>}
  </dialog>;
}
