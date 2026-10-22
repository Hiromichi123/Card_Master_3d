import { AbyssCampCrystals } from './AbyssCampCrystals';
import { useSettingsStore } from '../state/settingsStore';
import { useState } from 'react';
import { withAbyssRarity, abyssRarityAtLevel } from '../domain/progression/abyssRarity';
import type { AbyssAction, AbyssGrowthOffer, AbyssRun } from '../domain/progression/abyssTypes';
import { ABYSS_DIFFICULTY_NAMES, ABYSS_REWARD_DRAWS, abyssPurchasePrice, abyssBaseHp, abyssEnemyEffects, abyssRecruitLevel, abyssGrowthTargets } from '../domain/progression/abyssRules';
import { ABYSS_GRADE_INFO, abyssTraitGrade, abyssEffectGrade, abyssEffectLevel, abyssGrowthGrade, abyssGrowthAmount } from '../domain/progression/abyssGrades';
import { describeTraitFunction } from '../domain/skills/traitDescriptions';
import { AbyssCard } from './AbyssCard';
import { AbyssTraitCards, type AbyssTraitItem } from './AbyssTraitCards';

type Action = AbyssAction extends infer A ? A extends AbyssAction ? Omit<A, 'expectedToken' | 'operationId'> : never : never;
export type AbyssDispatch = (action: Action) => Promise<boolean>;

export function AbyssRunPanel({ run: savedRun, busy, dispatch, onBattle, onHome, onRules, onRanking, preparation = false }: {
  readonly run: AbyssRun; readonly busy: boolean; readonly dispatch: AbyssDispatch;
  readonly onBattle: () => void; readonly onHome: () => void; readonly onRules?: (() => void) | undefined; readonly onRanking?: (() => void) | undefined; readonly preparation?: boolean;
}) {
  const run = { ...savedRun, cards: savedRun.cards.map(withAbyssRarity) };
  const [deckOpen, setDeckOpen] = useState(false);
  const still = useSettingsStore(state => state.reduceMotion);
  const stage = run.stage, battle = 'battle' in stage ? stage.battle : null;
  const camp = stage.kind === 'camp';
  const ready = camp && !stage.offer && stage.freeRemaining === 0;
  const recruitPrice = abyssPurchasePrice(run, 'recruit'), traitPrice = abyssPurchasePrice(run, 'trait');
  const saveExit = async () => { if (await dispatch({ kind: 'save' })) onHome(); };
  return <section className="abyss-run abyss-run--floating" aria-label="深渊进度" data-stage={stage.kind} onKeyDown={event => {
    if (event.key === 'Escape' && deckOpen) { event.preventDefault(); event.stopPropagation(); setDeckOpen(false); }
  }}>
    <header className="abyss-run__header">
      <div><small>独立挑战 · 本轮培养</small><h1>深渊 {run.floor}-{run.encounter}</h1></div>
      <div className="abyss-run__resources"><span aria-label={`剩余${run.lives}颗心`}>{'♥'.repeat(run.lives)}{'♡'.repeat(3 - run.lives)}</span>
        <b>{run.coins} 深渊币</b><b className="abyss-crystals">◆ {run.crystals ?? 0} 深渊结晶</b>{battle && <strong data-difficulty={battle.difficulty}>{ABYSS_DIFFICULTY_NAMES[battle.difficulty]}</strong>}</div>
      {onRules && <button type="button" onClick={onRules}>规则讲解</button>}
      {onRanking && <button type="button" onClick={onRanking}>深渊排行</button>}
      {ready && run.floor >= 4 && <button type="button" disabled={busy} onClick={() => { void dispatch({ kind: 'finish' }); }}>结算无尽</button>}
      {camp ? <button type="button" className="abyss-primary" disabled={busy || !ready}
        onClick={() => { void dispatch({ kind: 'next' }); }}>{run.floor >= 4 ? '无尽 · 进入下一局' : run.floor >= 3 && run.encounter === 10 ? '结算 / 进入无尽' : '进入下一轮'}</button>
        : <button type="button" disabled={busy} className="abyss-save-exit" onClick={() => { void saveExit(); }}>保存退出</button>}
    </header>

    <div className="abyss-run__content">
      {stage.kind === 'starterDraft' && <>
        <h2>选择本轮起始卡组</h2>
        <div className="abyss-starters">{stage.choices.map((choice, index) => <section key={choice.id}>
          <h3>{choice.name}</h3><div className="abyss-card-grid">{choice.cards.map(card => <AbyssCard key={card.instanceId} card={card.definition} label="起始牌" />)}</div>
          <button type="button" disabled={busy} onClick={() => { void dispatch({ kind: 'chooseStarter', index }); }}>选择{choice.name}</button>
        </section>)}</div>
      </>}
      {stage.kind === 'boonChoice' && <>
        <h2>选择一组正负契约</h2><p className="abyss-note">上下两张为一组，点击任一卡同时接受；只在本战生效。</p>
        <AbyssTraitCards contract items={stage.battle.boonChoices.flatMap((pair, index) => [
          { id: `${pair.id}:positive`, name: pair.positive.name, description: pair.positive.description,
            tone: 'positive' as const, icon: pair.positive.modifier.traits[0]?.family ?? pair.positive.id.split('-')[0]!, grade: abyssEffectGrade(pair.positive), level: abyssEffectLevel(pair.positive), footer: `契约 ${index + 1} · 正面`, disabled: busy,
            onSelect: () => { void (async () => { if (await dispatch({ kind: 'chooseBoon', index })) onBattle(); })(); } },
          { id: `${pair.id}:negative`, name: pair.negative.name, description: pair.negative.description,
            tone: 'negative' as const, icon: pair.negative.id.split('-')[0]!, grade: abyssEffectGrade(pair.negative), level: abyssEffectLevel(pair.negative), footer: `契约 ${index + 1} · 绑定负面`, disabled: busy,
            onSelect: () => { void (async () => { if (await dispatch({ kind: 'chooseBoon', index })) onBattle(); })(); } },
        ])} />
        <Enemy run={run} />
      </>}
      {(stage.kind === 'battleReady' || stage.kind === 'inBattle') && <>
        <h2>{stage.kind === 'inBattle' ? '继续本战' : '准备进入战斗'}</h2>
        <Enemy run={run} />
        {stage.battle.selectedBoon !== null && <AbyssTraitCards items={[
          stage.battle.boonChoices[stage.battle.selectedBoon]!.positive,
          stage.battle.boonChoices[stage.battle.selectedBoon]!.negative,
        ].map(effect => ({ id: effect.id, name: effect.name, description: effect.description,
          tone: effect.polarity, icon: effect.modifier.traits[0]?.family ?? effect.id.split('-')[0]!, grade: abyssEffectGrade(effect), level: abyssEffectLevel(effect), footer: '已接受 · 本战有效' }))} />}
        <p className="abyss-note">中途离开后，从同一敌人、同一契约的开场继续挑战。</p>
        <button type="button" className="abyss-primary" disabled={busy} onClick={onBattle}>{stage.kind === 'inBattle' ? '继续挑战' : '开始战斗'}</button>
      </>}
      {stage.kind === 'camp' && !deckOpen && <>
        <h2>{stage.result === 'win' ? '胜利 · 战果已结算' : stage.result === 'draw' ? '平局 · 战果已结算' : '失利 · 战果已结算'}</h2>
        <p className="abyss-note">{stage.freeRemaining > 0 ? `本局加成 · 剩余 ${stage.freeRemaining} 次选择（本级奖励${ABYSS_REWARD_DRAWS[stage.battle.difficulty]}次）` : '奖励已处理，可抽取新卡 / 新特性，或进入下一轮。'}</p>
        {stage.offer && <Growth key={stage.offer.id} offer={stage.offer} run={run} busy={busy} dispatch={dispatch} />}
        {stage.freeRemaining > 0 && <button type="button" disabled={busy} onClick={() => {
          if (window.confirm('仅放弃本次免费加成？剩余次数保留。')) void dispatch({ kind: 'skipFree' });
        }}>放弃本次奖励</button>}
        {ready && <div className="abyss-camp-ready"><span aria-hidden="true">✦</span><p>准备好后，从上方进入下一轮</p></div>}
      </>}
      {stage.kind === 'bossDecision' && <>
        <h2>{run.floor === 3 ? '第三层突破 · 无尽之门' : run.floor > 3 ? '无尽Boss已突破' : '噩梦已突破'}</h2><p>{run.floor >= 3 ? '结算本轮成绩，或保留全部培养与资源继续无尽。' : '继续下一层挑战；通关3-10后开放结算与无尽。'}</p>
        <div className="abyss-run__actions">{run.floor >= 3 && <button type="button" disabled={busy} onClick={() => { void dispatch({ kind: 'finish' }); }}>结算本轮</button>}
          <button type="button" className="abyss-primary" disabled={busy} onClick={() => { void dispatch({ kind: 'next' }); }}>{run.floor >= 3 ? '继续无尽 · ' : '进入 ' }{run.floor + 1}-1</button></div>
      </>}
      {deckOpen && <Deck run={run} onClose={() => setDeckOpen(false)} />}
      {!preparation && !camp && !deckOpen && run.cards.length > 0 && <details className="abyss-run__deck">
        <summary>当前卡组 · {run.cards.length}/12</summary><div className="abyss-card-grid">{run.cards.map(card => <AbyssCard key={card.instanceId} card={card.definition} />)}</div>
      </details>}
    </div>

    {camp && !deckOpen && <p className="abyss-note">付费抽卡三选一 · 本关卡池平均约 {abyssRarityAtLevel(abyssRecruitLevel(run))}</p>}
    {camp && <AbyssCampCrystals still={still} entries={[
      { title: '保存退出', detail: '保存当前状态 · 返回大厅', disabled: busy, action: () => { void saveExit(); } },
      { title: deckOpen ? '收起卡组' : '浏览卡组', detail: `${run.cards.length}/12张 · 只读浏览`, disabled: busy, pressed: deckOpen, action: () => setDeckOpen(value => !value) },
      { title: '抽取新卡', detail: `${recruitPrice}深渊币 · 三选一`, disabled: busy || !ready || run.coins < recruitPrice,
        action: () => { setDeckOpen(false); void dispatch({ kind: 'buy', purchase: 'recruit' }); } },
      { title: '抽取特性', detail: `${traitPrice}深渊币 · 选择加成`, disabled: busy || !ready || run.coins < traitPrice,
        action: () => { setDeckOpen(false); void dispatch({ kind: 'buy', purchase: 'trait' }); } },
    ]} />}
  </section>;
}

function Enemy({ run }: { readonly run: AbyssRun }) {
  const [open, setOpen] = useState(false);
  if (!('battle' in run.stage)) return null;
  const battle = run.stage.battle;
  return <details className="abyss-enemy" onToggle={event => setOpen(event.currentTarget.open)}><summary>{ABYSS_DIFFICULTY_NAMES[battle.difficulty]} · 敌方特性：{abyssEnemyEffects(battle).length ? `${battle.enemyEffect.name} · 强度 ${battle.enemyEffect.strength}` : '无全局特性'}</summary>
    {open && <>{abyssEnemyEffects(battle).length > 0 && <AbyssTraitCards items={[{ id: `enemy:${battle.enemyEffect.id}`, name: battle.enemyEffect.name,
      description: battle.enemyEffect.description, tone: 'positive', icon: battle.enemyEffect.modifier.traits[0]?.family ?? battle.enemyEffect.id, grade: abyssEffectGrade(battle.enemyEffect), level: abyssEffectLevel(battle.enemyEffect), footer: '敌方全体 · 本战有效' }]} />}
    <p>敌方 {battle.enemyCards.length} 张牌（增益前属性） · 本战本体生命：我方 {abyssBaseHp(battle).player} / 敌方 {abyssBaseHp(battle).enemy}</p>
    <div className="abyss-card-grid">{battle.enemyCards.map(card => <AbyssCard key={card.instanceId} card={card.definition} label="敌方基础" />)}</div></>}
  </details>;
}

function Growth({ offer, run, busy, dispatch }: {
  readonly offer: AbyssGrowthOffer; readonly run: AbyssRun; readonly busy: boolean; readonly dispatch: AbyssDispatch;
}) {
  const [index, setIndex] = useState<number | null>(null), [target, setTarget] = useState<string | null>(null);
  const option = index === null ? null : offer.options[index];
  const targets = option ? abyssGrowthTargets(run.cards, option, run.crystals ?? 0) : [];
  const replacing = option?.kind === 'trait' && !!run.cards.find(card => card.instanceId === target)?.addedTraits.length;
  const needsTarget = option && option.kind !== 'crystal' && (option.kind !== 'recruit' || run.cards.length >= 12);
  const items: AbyssTraitItem[] = offer.options.map((item, i) => ({
    id: `${offer.id}:${i}`, name: item.kind === 'recruit' ? item.card.definition.name : item.label,
    ...(item.kind === 'recruit' ? { card: item.card.definition } : {}),
    description: item.kind === 'trait' ? describeTraitFunction(item.trait)
      : item.kind === 'recruit' ? item.card.definition.rawTraits.join(' · ') || '无特性'
      : item.kind === 'crystal' ? '领取1枚深渊结晶；覆盖已有培养特性时消耗，保留至本轮结束'
      : item.kind === 'remove' ? '永久移出一张本轮卡牌' : '可重复培养同一张卡，保留至本轮结束',
    icon: item.kind === 'trait' ? item.trait.family ?? 'trait' : item.kind,
    tone: 'growth', grade: abyssGrowthGrade(item), level: item.kind === 'trait' ? item.trait.param ?? 1 : abyssGrowthAmount(item) || 1, footer: item.kind === 'trait' ? '空槽可赋予 · 覆盖需1结晶' : '选择后确认', selected: index === i,
    disabled: busy || item.kind !== 'recruit' && item.kind !== 'crystal' && abyssGrowthTargets(run.cards, item, run.crystals ?? 0).length === 0,
    onSelect: () => { setIndex(i); setTarget(null); },
  }));
  return <section className="abyss-growth" aria-label="培养选择" onKeyDown={event => {
    if (event.key === 'Escape' && index !== null) { event.preventDefault(); event.stopPropagation(); setIndex(null); setTarget(null); }
  }}>
    <h3>{offer.source === 'free' ? `免费加成 · 剩余 ${run.stage.kind === 'camp' ? run.stage.freeRemaining : 0} 次`
      : `${offer.paidPrice === undefined ? '已付费' : `已支付${offer.paidPrice}币`} · ${offer.source === 'recruit' ? '实体卡牌三选一' : '加成卡牌三选一'}`}</h3>
    <p className="abyss-note">{offer.source === 'recruit' ? '悬停查看三张候选简介，选择其中一张加入本轮卡组' : `深渊结晶 ${run.crystals ?? 0} · 覆盖已有培养特性消耗1枚`}</p>
    <AbyssTraitCards items={items} />
    {option && <div className="abyss-growth__target">
      {needsTarget && <><h4>{option.kind === 'recruit' ? '卡组已满：选择将被替换的卡牌' : '选择目标卡牌'}</h4>
        <div className="abyss-card-grid">{targets.map(card => <AbyssCard key={card.instanceId} card={card.definition}
          selected={target === card.instanceId} disabled={busy} onSelect={() => setTarget(card.instanceId)} />)}</div></>}
      {replacing && <p className="abyss-note abyss-crystals">本次将替换所选卡牌的培养特性并消耗1枚结晶。</p>}
      <div className="abyss-run__actions"><button type="button" className="abyss-primary" disabled={busy || !!needsTarget && !target || replacing && (run.crystals ?? 0) < 1}
        onClick={() => {
          if (index === null) return;
          if ((option.kind === 'remove' || option.kind === 'recruit' && run.cards.length >= 12) && !window.confirm('确认移除选中的本轮卡牌？')) return;
          if (replacing && !window.confirm('是否花费1枚深渊水晶（结晶）擦除并覆盖已有培养特性？')) return;
          void dispatch({ kind: 'chooseGrowth', offerId: offer.id, index, ...(target ? { targetId: target } : {}), ...(replacing ? { confirmReplace: true } : {}) });
        }}>{replacing ? '消耗1结晶并覆盖' : '确认'}：{option.label}</button>
        {option.kind === 'recruit' && <button type="button" disabled={busy} onClick={() => {
          if (index !== null && window.confirm('放弃这张新卡？本次机会仍会消耗，已支付费用不返还。')) void dispatch({ kind: 'chooseGrowth', offerId: offer.id, index, discardNew: true });
        }}>放弃此新卡</button>}
      </div>
    </div>}
    {offer.source !== 'free' && <button type="button" disabled={busy} onClick={() => {
      if (window.confirm('放弃已付费候选？不退款。')) void dispatch({ kind: 'cancelOffer' });
    }}>放弃本次候选</button>}
  </section>;
}

function Deck({ run, onClose }: { readonly run: AbyssRun; readonly onClose: () => void }) {
  return <section className="abyss-deck-browser" aria-label="当前卡组浏览">
    <header><h2>当前卡组 · {run.cards.length}/12</h2><button type="button" onClick={onClose}>收起卡组</button></header>
    <p className="abyss-note">此处仅浏览。属性、培养特性、卡牌移除与结晶均通过加成抽取获得；覆盖培养特性需1枚结晶。</p>
    <div className="abyss-deck-browser__grid">{run.cards.map(card => <section key={card.instanceId}>
      <AbyssCard card={card.definition} />
      {card.addedTraits.length === 0 ? <small>培养特性槽：空</small> : card.addedTraits.map(trait => <div className="abyss-deck-browser__trait" key={trait.family}>
        <span style={{ color: ABYSS_GRADE_INFO[abyssTraitGrade(trait)].color }}>培养：{trait.raw} · {ABYSS_GRADE_INFO[abyssTraitGrade(trait)].name.split(' · ')[0]}</span>
      </div>)}
    </section>)}</div>
  </section>;
}
