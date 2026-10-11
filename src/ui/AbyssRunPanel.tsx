import { useState } from 'react';
import type { AbyssAction, AbyssGrowthOffer, AbyssRun } from '../domain/progression/abyssTypes';
import { ABYSS_DIFFICULTY_NAMES, ABYSS_RECRUIT_PRICE, ABYSS_TRAINING_PRICE, abyssGrowthTargets } from '../domain/progression/abyssRules';
import { AbyssCard } from './AbyssCard';

type Action = AbyssAction extends infer A ? A extends AbyssAction ? Omit<A, 'expectedToken' | 'operationId'> : never : never;
export type AbyssDispatch = (action: Action) => Promise<boolean>;

export function AbyssRunPanel({ run, busy, dispatch, onBattle, onHome, preparation = false }: {
  readonly run: AbyssRun;
  readonly busy: boolean;
  readonly dispatch: AbyssDispatch;
  readonly onBattle: () => void;
  readonly onHome: () => void;
  readonly preparation?: boolean;
}) {
  const stage = run.stage;
  const battle = 'battle' in stage ? stage.battle : null;
  return <section className="abyss-run" aria-label="深渊进度" data-stage={stage.kind}>
    <header className="abyss-run__header"><div><small>独立挑战 · 本轮培养</small><h1>深渊 {run.floor}-{run.encounter}</h1></div>
      <div className="abyss-run__resources"><span aria-label={`剩余${run.lives}颗心`}>{'♥'.repeat(run.lives)}{'♡'.repeat(3 - run.lives)}</span><b>{run.coins} 深渊币</b>
        {battle && <strong data-difficulty={battle.difficulty}>{ABYSS_DIFFICULTY_NAMES[battle.difficulty]}</strong>}</div>
      <button type="button" disabled={busy} onClick={onHome}>返回深渊大厅</button>
    </header>
    {stage.kind === 'starterDraft' && <>
      <h2>选择本轮的起始卡组</h2><p>三套独立六张牌：1张D、3张C、2张C+，平均稀有度C。不消耗主收藏，候选已保存。</p>
      <div className="abyss-starters">{stage.choices.map((choice, index) => <section key={choice.id}>
        <h3>{choice.name}</h3><div className="abyss-card-grid">{choice.cards.map(card => <AbyssCard key={card.instanceId} card={card.definition} label="起始牌" />)}</div>
        <button type="button" disabled={busy} onClick={() => { void dispatch({ kind: 'chooseStarter', index }); }}>选择{choice.name}</button>
      </section>)}</div>
    </>}
    {stage.kind === 'boonChoice' && <>
      <h2>接受一组正负契约</h2><p>三选一，正负效果同时获得，只在本战有效。退出或刷新不会更换候选。</p>
      <Enemy run={run} />
      <div className="abyss-boons">{stage.battle.boonChoices.map((pair, index) => <button type="button" key={pair.id} disabled={busy}
        className="abyss-boon" onClick={() => { void dispatch({ kind: 'chooseBoon', index }); }}>
        <span className="abyss-boon__positive"><small>正面 · 强度 {pair.positive.strength}</small><strong>{pair.positive.name}</strong><span>{pair.positive.description}</span></span>
        <span className="abyss-boon__negative"><small>绑定负面</small><strong>{pair.negative.name}</strong><span>{pair.negative.description}</span></span>
        <b>同时接受</b>
      </button>)}</div>
    </>}
    {(stage.kind === 'battleReady' || stage.kind === 'inBattle') && <>
      <h2>{stage.kind === 'inBattle' ? '继续本战' : '准备进入战斗'}</h2><Enemy run={run} />
      {stage.battle.selectedBoon !== null && <div className="abyss-contract"><p>正面：{stage.battle.boonChoices[stage.battle.selectedBoon]?.positive.description}</p><p>绑定负面：{stage.battle.boonChoices[stage.battle.selectedBoon]?.negative.description}</p></div>}
      <p>中途离开后将从同一seed、敌人和特性的开场重打，不保存逐操作战局。</p>
      <button type="button" className="abyss-primary" disabled={busy} onClick={onBattle}>{stage.kind === 'inBattle' ? '继续挑战' : '开始战斗'}</button>
    </>}
    {stage.kind === 'camp' && <>
      <h2>{stage.result === 'win' ? '胜利营地' : '整备营地'}</h2>
      <p>{stage.result === 'win' ? `本战胜利，剩余 ${stage.freeRemaining} 次免费三选一。` : '本战已扣除一颗心并获得10深渊币；没有免费培养，整备后仍可推进。'}</p>
      {stage.offer && <Growth key={stage.offer.id} offer={stage.offer} run={run} busy={busy} dispatch={dispatch} />}
      {!stage.offer && <div className="abyss-run__actions">
        <button type="button" disabled={busy || run.coins < ABYSS_TRAINING_PRICE} onClick={() => { void dispatch({ kind: 'buy', purchase: 'training' }); }}>培养三选一 · {ABYSS_TRAINING_PRICE}币</button>
        <button type="button" disabled={busy || run.coins < ABYSS_RECRUIT_PRICE} onClick={() => { void dispatch({ kind: 'buy', purchase: 'recruit' }); }}>招募新卡 · {ABYSS_RECRUIT_PRICE}币</button>
        <button type="button" className="abyss-primary" disabled={busy} onClick={() => { void dispatch({ kind: 'next' }); }}>{stage.battle.difficulty === 'nightmare' ? '选择下一步' : '推进下一战'}</button>
      </div>}
      {stage.freeRemaining > 0 && <button type="button" disabled={busy} onClick={() => {
        if (window.confirm(`放弃剩余${stage.freeRemaining}次免费培养？不会兑换币，也不会顺延到下一战。`)) void dispatch({ kind: 'skipFree' });
      }}>放弃剩余免费培养</button>}
      <p className="abyss-note">已付费候选必须处理后才能推进；关闭面板只暂存，不退款也不重抽。</p>
    </>}
    {stage.kind === 'bossDecision' && <>
      <h2>噩梦已突破</h2><p>现在结算保存本轮成绩与卡组，或保留生命、深渊币与培养进入 {run.floor + 1}-1。</p>
      <div className="abyss-run__actions"><button type="button" disabled={busy} onClick={() => { void dispatch({ kind: 'finish' }); }}>结算本轮</button>
        <button type="button" className="abyss-primary" disabled={busy} onClick={() => { void dispatch({ kind: 'next' }); }}>进入 {run.floor + 1}-1</button></div>
    </>}
    {!preparation && run.cards.length > 0 && <details className="abyss-run__deck" open><summary>本轮卡组 · {run.cards.length}/12 · 培养属性</summary>
      <div className="abyss-card-grid">{run.cards.map(card => <AbyssCard key={card.instanceId} card={card.definition} />)}</div>
    </details>}
  </section>;
}

function Enemy({ run }: { readonly run: AbyssRun }) {
  if (!('battle' in run.stage)) return null;
  const battle = run.stage.battle;
  return <aside className="abyss-enemy" data-difficulty={battle.difficulty}>
    <strong>{ABYSS_DIFFICULTY_NAMES[battle.difficulty]} · 敌方特性：{battle.enemyEffect.name} · 强度 {battle.enemyEffect.strength}</strong>
    <p>{battle.enemyEffect.description}</p><details><summary>查看敌方 {battle.enemyCards.length} 张牌（以下为增益前属性）</summary>
      <div className="abyss-card-grid">{battle.enemyCards.map(card => <AbyssCard key={card.instanceId} card={card.definition} label="敌方基础" />)}</div>
    </details>
  </aside>;
}

function Growth({ offer, run, busy, dispatch }: {
  readonly offer: AbyssGrowthOffer; readonly run: AbyssRun; readonly busy: boolean; readonly dispatch: AbyssDispatch;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const option = index === null ? null : offer.options[index];
  const targets = option ? abyssGrowthTargets(run.cards, option) : [];
  const needsTarget = option && (option.kind !== 'recruit' || run.cards.length >= 12);
  return <section className="abyss-growth" aria-label="培养选择" onKeyDown={event => {
    if (event.key === 'Escape' && index !== null) { event.preventDefault(); event.stopPropagation(); setIndex(null); setTarget(null); }
  }}>
    <h3>{offer.source === 'free' ? '免费培养 · 三选一' : offer.source === 'training' ? '已支付25币 · 培养三选一' : '已支付30币 · 新卡已抽取'}</h3>
    <div className="abyss-growth__options">{offer.options.map((item, itemIndex) => <button type="button" key={itemIndex} disabled={busy}
      aria-pressed={index === itemIndex} onClick={() => { setIndex(itemIndex); setTarget(null); }}><strong>{item.label}</strong>
      {item.kind === 'recruit' && <span>{item.card.definition.rarity} · {item.card.definition.name}</span>}
      <small>{item.kind === 'recruit' ? '加入本轮牌库' : item.kind === 'remove' ? '永久移出本轮卡组' : '选择一张本轮卡牌作为目标'}</small>
    </button>)}</div>
    {option && <div className="abyss-growth__target">
      {option.kind === 'recruit' && <AbyssCard card={option.card.definition} label="待招募" />}
      {needsTarget && <><h4>{option.kind === 'recruit' ? '卡组已满：选择将被替换的卡牌' : '选择目标卡牌'}</h4>
        <div className="abyss-card-grid">{targets.map(card => <AbyssCard key={card.instanceId} card={card.definition} selected={target === card.instanceId}
          disabled={busy} onSelect={() => setTarget(card.instanceId)} />)}</div></>}
      <div className="abyss-run__actions"><button type="button" className="abyss-primary" disabled={busy || !!needsTarget && !target}
        onClick={() => {
          if (index === null) return;
          if ((option.kind === 'remove' || option.kind === 'recruit' && run.cards.length >= 12) && !window.confirm('确认移除选中的本轮卡牌？此操作不能撤销。')) return;
          void dispatch({ kind: 'chooseGrowth', offerId: offer.id, index, ...(target ? { targetId: target } : {}) });
        }}>确认：{option.label}</button>
        {option.kind === 'recruit' && <button type="button" disabled={busy} onClick={() => {
          if (index !== null && window.confirm('放弃这张新卡？本次机会仍会消耗，已支付的深渊币不会返还。')) void dispatch({ kind: 'chooseGrowth', offerId: offer.id, index, discardNew: true });
        }}>放弃此新卡</button>}
      </div>
    </div>}
  </section>;
}
