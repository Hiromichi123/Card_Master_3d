import { useState } from 'react';
import { withAbyssRarity } from '../domain/progression/abyssRarity';
import type { AbyssState } from '../domain/progression/abyssTypes';
import { ABYSS_EFFECTS, ABYSS_GROWTH_TRAITS } from '../domain/progression/abyssRules';
import { describeTraitFunction } from '../domain/skills/traitDescriptions';
import { AbyssCard } from './AbyssCard';
import { AbyssDialog } from './AbyssDialog';
import { AbyssTraitCards } from './AbyssTraitCards';
import { ABYSS_GRADES, ABYSS_GRADE_INFO, abyssEffectGrade, abyssEffectLevel, abyssTraitGrade, abyssTraitDiscoveryId } from '../domain/progression/abyssGrades';

export function AbyssHistoryDialog({ state, onClose }: { readonly state: AbyssState; readonly onClose: () => void }) {
  return <AbyssDialog title="游玩历史" onClose={onClose}>
    <p>保留最近10次结束的挑战；卡组为当次培养快照，不含单场契约、召唤体或复制体。</p>
    {state.history.length === 0 && <p className="abyss-empty">尚无游玩记录。</p>}
    <div className="abyss-history">{state.history.map(item => <details key={item.runId}>
      <summary><strong>{item.floor}-{item.encounter}</strong><span>{{ settled: '主动结算', defeated: '挑战终止', abandoned: '放弃挑战' }[item.reason]}</span>
        <time dateTime={item.endedAt}>{new Date(item.endedAt).toLocaleString('zh-CN', { hour12: false })}</time></summary>
      <p>{item.wins}胜 / {item.losses}负或平 · 累计获得 {item.earnedCoins} 深渊币 · 结束余额 {item.coins} · 结晶 {item.crystals ?? 0} · 最终卡组 {item.cards.length}张</p>
      <div className="abyss-card-grid">{item.cards.map(withAbyssRarity).map(card => <AbyssCard key={card.instanceId} card={card.definition} label="历史快照" />)}</div>
    </details>)}</div>
  </AbyssDialog>;
}

export function AbyssTraitsDialog({ state, onClose }: { readonly state: AbyssState; readonly onClose: () => void }) {
  const [tab, setTab] = useState<'positive' | 'negative' | 'growth'>('positive');
  return <AbyssDialog title="已知特性" className="abyss-dialog--traits" onClose={onClose}>
    <p>规则目录始终可查看；已遭遇/获得的条目点亮。本战契约不写入本轮培养，培养也不带出本轮深渊。</p>
    <nav className="abyss-tabs" aria-label="特性分类">{(['positive', 'negative', 'growth'] as const).map(value => <button type="button" key={value}
      aria-pressed={tab === value} onClick={() => setTab(value)}>{{ positive: '局内正面', negative: '绑定负面', growth: '培养特性' }[value]}</button>)}</nav>
    <div className="abyss-grade-legend" aria-label="增益等级">{ABYSS_GRADES.map(grade => <span key={grade} style={{ color: ABYSS_GRADE_INFO[grade].color }}>
      <i aria-hidden="true">◆</i>{ABYSS_GRADE_INFO[grade].name}
    </span>)}</div>
    <AbyssTraitCards items={tab === 'growth' ? ABYSS_GROWTH_TRAITS.map(trait => ({
      id: trait.raw, name: trait.raw, description: describeTraitFunction(trait), icon: trait.family ?? 'trait',
      tone: 'growth' as const, grade: abyssTraitGrade(trait), level: trait.param ?? 1,
      known: state.knownEffectIds.includes(abyssTraitDiscoveryId(trait)) || state.knownEffectIds.includes(`trait:${trait.family}`),
      footer: '单卡一个培养槽 · 覆盖消耗1结晶',
    })) : ABYSS_EFFECTS.filter(effect => effect.polarity === tab).map(effect => ({
      id: effect.id, name: effect.name, description: effect.description, icon: effect.modifier.traits[0]?.family ?? effect.id.split('-')[0]!,
      tone: effect.polarity, grade: abyssEffectGrade(effect), level: abyssEffectLevel(effect), known: state.knownEffectIds.includes(effect.id),
      footer: `本战阵营全体 · 数值等级 ${abyssEffectLevel(effect)}`,
    }))} />
  </AbyssDialog>;
}
