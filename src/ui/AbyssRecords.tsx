import { useState } from 'react';
import type { AbyssState } from '../domain/progression/abyssTypes';
import { ABYSS_EFFECTS, ABYSS_GROWTH_TRAITS } from '../domain/progression/abyssRules';
import { describeTraitFunction } from '../domain/skills/traitDescriptions';
import { AbyssCard } from './AbyssCard';
import { AbyssDialog } from './AbyssDialog';

export function AbyssHistoryDialog({ state, onClose }: { readonly state: AbyssState; readonly onClose: () => void }) {
  return <AbyssDialog title="游玩历史" onClose={onClose}>
    <p>保留最近10次结束的挑战；卡组为当次培养快照，不含单场契约、召唤体或复制体。</p>
    {state.history.length === 0 && <p className="abyss-empty">尚无游玩记录。</p>}
    <div className="abyss-history">{state.history.map(item => <details key={item.runId}>
      <summary><strong>{item.floor}-{item.encounter}</strong><span>{{ settled: '主动结算', defeated: '挑战终止', abandoned: '放弃挑战' }[item.reason]}</span>
        <time dateTime={item.endedAt}>{new Date(item.endedAt).toLocaleString('zh-CN', { hour12: false })}</time></summary>
      <p>{item.wins}胜 / {item.losses}负或平 · 累计获得 {item.earnedCoins} 深渊币 · 结束余额 {item.coins} · 最终卡组 {item.cards.length}张</p>
      <div className="abyss-card-grid">{item.cards.map(card => <AbyssCard key={card.instanceId} card={card.definition} label="历史快照" />)}</div>
    </details>)}</div>
  </AbyssDialog>;
}

export function AbyssTraitsDialog({ state, onClose }: { readonly state: AbyssState; readonly onClose: () => void }) {
  const [tab, setTab] = useState<'positive' | 'negative' | 'growth'>('positive');
  return <AbyssDialog title="已知特性" onClose={onClose}>
    <p>规则目录始终可查看；已遭遇/获得的条目点亮。本战契约不写入本轮培养，培养也不带出本轮深渊。</p>
    <nav className="abyss-tabs" aria-label="特性分类">{(['positive', 'negative', 'growth'] as const).map(value => <button type="button" key={value}
      aria-pressed={tab === value} onClick={() => setTab(value)}>{{ positive: '局内正面', negative: '绑定负面', growth: '培养特性' }[value]}</button>)}</nav>
    <div className="abyss-traits">{tab === 'growth' ? ABYSS_GROWTH_TRAITS.map(trait => <article key={trait.raw}>
      <small>本轮持续 · 单卡培养</small><h3>{trait.raw}</h3><p>{describeTraitFunction(trait)}</p><footer>{state.knownEffectIds.includes(`trait:${trait.family}`) ? '已发现' : '未获得'} · 每卡最多新增4项，同族不重复追加</footer>
    </article>) : ABYSS_EFFECTS.filter(effect => effect.polarity === tab).map(effect => <article key={effect.id} data-known={state.knownEffectIds.includes(effect.id)}>
      <small>本战有效 · 所属阵营全体</small><h3>{effect.name}</h3><p>{effect.description}</p><footer>基础强度 {effect.strength} · {state.knownEffectIds.includes(effect.id) ? '已发现' : '未遇见'}</footer>
    </article>)}</div>
  </AbyssDialog>;
}
