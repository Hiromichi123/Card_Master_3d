import { useEffect, useMemo, useRef, useState } from 'react';
import { cardById } from '../data';
import { cardFaceUrlForDefinition } from '../data/assets';
import type { AbyssState } from '../domain/progression/abyssTypes';
import { ABYSS_WEEKLY_TIERS, abyssProgressLabel, abyssWeekKey, prepareAbyssWeek } from '../domain/progression/abyssRewards';
import { hideCardTip, moveCardTip, showCardTip } from '../state/cardTipStore';

export function AbyssWeeklyProgress({ state, busy, onPrepare, onRewards }: {
  readonly state?: AbyssState | undefined; readonly busy: boolean;
  readonly onPrepare?: (() => Promise<boolean>) | undefined; readonly onRewards?: (() => void) | undefined;
}) {
  const [time, setTime] = useState(Date.now), attempted = useRef('');
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const resume = () => { clearInterval(timer); if (document.hidden) return; setTime(Date.now()); timer = setInterval(() => setTime(Date.now()), 1000); };
    resume(); document.addEventListener('visibilitychange', resume);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', resume); };
  }, []);
  const key = abyssWeekKey(time), saved = state?.weeks?.find(w => w.weekKey === key);
  const preview = useMemo(() => {
    if (!state || saved) return saved;
    try { return prepareAbyssWeek(state, Date.parse(key)).weeks?.find(w => w.weekKey === key); } catch { return undefined; }
  }, [state, saved, key]);
  useEffect(() => {
    if (!state || saved || busy || !onPrepare || attempted.current === key) return;
    attempted.current = key;
    void onPrepare().catch(() => {});
  }, [state, saved, busy, onPrepare, key]);
  useEffect(() => () => { ABYSS_WEEKLY_TIERS.forEach(t => hideCardTip(`abyss-week-progress:${t.reached}`)); }, []);
  const reached = Math.max(0, preview?.highestReached ?? 0), capped = Math.min(90, reached);
  return <section className="abyss-week-progress" aria-label="本周深渊进度与指定奖励">
    <header><span>本周抵达 <strong>{abyssProgressLabel(reached)}</strong></span>
      <button type="button" disabled={busy || !onRewards} onClick={onRewards}>周奖励 · {preview?.claimedMilestones.length ?? 0}/5</button></header>
    <div className="abyss-week-progress__track"><div className="abyss-week-progress__rail" role="progressbar" aria-orientation="vertical" aria-label="本周最高抵达" aria-valuemin={0} aria-valuemax={90}
      aria-valuenow={capped} aria-valuetext={`${abyssProgressLabel(reached)}，最终奖励节点9-10`}>
      {ABYSS_WEEKLY_TIERS.map((tier, index) => {
        const start = index === 0 ? 0 : ABYSS_WEEKLY_TIERS[index - 1]!.reached;
        const charge = Math.max(0, Math.min(1, (capped - start) / (tier.reached - start)));
        return <span key={tier.reached} className="abyss-week-progress__segment" aria-hidden="true"
          style={{ bottom: `${index / ABYSS_WEEKLY_TIERS.length * 100}%`, height: `${100 / ABYSS_WEEKLY_TIERS.length}%` }}>
          <i style={{ height: `${charge * 100}%`, visibility: charge > 0 ? 'visible' : 'hidden' }} /></span>;
      })}
    </div>
    <div className="abyss-week-progress__rewards">{ABYSS_WEEKLY_TIERS.map((tier, index) => {
      const card = cardById.get(preview?.designatedCardIds[index] ?? '');
      const thumbnail = card && cardFaceUrlForDefinition(card, 'thumbnail'), large = card && cardFaceUrlForDefinition(card, 'battle');
      const achieved = reached >= tier.reached, claimed = preview?.claimedMilestones.includes(tier.reached) === true;
      const owner = `abyss-week-progress:${tier.reached}`;
      const tip = (element: HTMLElement) => { if (card) showCardTip(card.cardId, element.getBoundingClientRect(), { card, theme: 'abyss', ownerKey: owner, ownerElement: element }); };
      return <button type="button" className="abyss-week-progress__node" key={tier.reached} data-achieved={achieved} data-claimed={claimed}
        disabled={busy || !onRewards} style={{ bottom: `${(index + 1) / ABYSS_WEEKLY_TIERS.length * 100}%` }}
        aria-label={`${tier.label}，${tier.rarity}奖励${card ? ` ${card.name}` : ''}，${claimed ? '已领取' : achieved ? '已达成可领取' : '尚未达成'}`}
        onClick={onRewards} onPointerEnter={event => tip(event.currentTarget)} onPointerMove={event => moveCardTip(event.clientX, event.clientY)}
        onPointerLeave={() => hideCardTip(owner)} onFocus={event => tip(event.currentTarget)} onBlur={() => hideCardTip(owner)}>
        <span className="abyss-week-progress__point" aria-hidden="true" /><b>{tier.label}</b>
        <span className="abyss-week-progress__card">{thumbnail ? <img src={thumbnail} alt={card!.name} loading="lazy" draggable={false} /> : null}</span>
        {card && large && <span className="abyss-week-progress__preview" aria-hidden="true"><img src={large} alt="" draggable={false} /></span>}
      </button>;
    })}</div></div>
  </section>;
}
