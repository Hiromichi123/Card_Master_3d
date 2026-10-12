import { useEffect, useRef, useState } from 'react';
import { cardById } from '../data';
import type { AbyssState } from '../domain/progression/abyssTypes';
import { ABYSS_COMPLETION_REWARDS, ABYSS_WEEKLY_TIERS, abyssCompletionCount, abyssPendingPacks, abyssProgressLabel, abyssWeekKey } from '../domain/progression/abyssRewards';
import type { AbyssDispatch } from './AbyssRunPanel';
import { AbyssDialog } from './AbyssDialog';
import { AbyssTraitCards } from './AbyssTraitCards';
import './abyssRewards.css';

export function AbyssWeeklyRewards({ state, busy, dispatch, onClose }: {
  readonly state: AbyssState; readonly busy: boolean; readonly dispatch: AbyssDispatch; readonly onClose: () => void;
}) {
  const [time, setTime] = useState(Date.now), [message, setMessage] = useState(''), [sending, setSending] = useState(false);
  const lock = useRef(false);
  useEffect(() => { const timer = window.setInterval(() => { if (!document.hidden) setTime(Date.now()); }, 1000); return () => window.clearInterval(timer); }, []);
  const key = abyssWeekKey(time), week = state.weeks?.find(w => w.weekKey === key);
  const submit = async (action: Parameters<AbyssDispatch>[0]) => {
    if (lock.current || busy) return;
    lock.current = true; setSending(true); setMessage('');
    try { setMessage(await dispatch(action) ? action.kind === 'claimWeekly' ? '指定卡已加入主收藏。' : '本周指定卡已更新。' : '领取未完成，请检查当前进度或重新打开奖励页面。'); }
    catch { setMessage('保存失败，奖励未领取，请重试。'); }
    finally { lock.current = false; setSending(false); }
  };
  return <AbyssDialog title="深渊 · 本周结算" className="abyss-dialog--traits abyss-reward-dialog" onClose={() => { if (!sending && !busy) onClose(); }}>
    <p>本周最高抵达：<strong>{abyssProgressLabel(week?.highestReached ?? 0)}</strong> · 通关结算 {abyssCompletionCount(state, time)}/2</p>
    <p>五档累计领取，每档每周一次；与通关结算独立。本周指定卡固定，周一北京时间04:00刷新。</p>
    {!week ? <button type="button" disabled={busy || sending} onClick={() => { void submit({ kind: 'prepareWeek' }); }}>加载本周指定卡</button> : <>
      <AbyssTraitCards items={ABYSS_WEEKLY_TIERS.map((tier, index) => {
        const card = cardById.get(week.designatedCardIds[index]!)!;
        const claimed = week.claimedMilestones.includes(tier.reached), eligible = week.highestReached >= tier.reached;
        return { id: `${key}:${tier.reached}`, name: card.name, description: card.rawTraits.join(' · ') || '基础战斗卡牌', icon: 'card', card,
          selected: claimed, footer: `${tier.label} · ${tier.rarity} · ${claimed ? '已领取' : eligible ? '可领取' : '未抵达'}` };
      })} />
      <div className="abyss-weekly-actions">{ABYSS_WEEKLY_TIERS.map(tier => {
        const claimed = week.claimedMilestones.includes(tier.reached);
        return <button type="button" key={tier.reached} disabled={busy || sending || claimed || week.highestReached < tier.reached}
          onClick={() => { void submit({ kind: 'claimWeekly', weekKey: key, milestone: tier.reached }); }}>{tier.label} · {claimed ? '已领取' : '领取'}</button>;
      })}</div>
    </>}
    {message && <p role="status">{message}</p>}
  </AbyssDialog>;
}

export function AbyssRewardPacks({ state, busy, dispatch, onClose }: {
  readonly state: AbyssState; readonly busy: boolean; readonly dispatch: AbyssDispatch; readonly onClose: () => void;
}) {
  const pending = abyssPendingPacks(state), pack = pending[0];
  const [selection, setSelection] = useState<{ id: string; indices: number[] }>({ id: '', indices: [] });
  const [message, setMessage] = useState(''), [sending, setSending] = useState(false), lock = useRef(false);
  const indices = selection.id === pack?.id ? selection.indices : [];
  const toggle = (index: number) => {
    if (!pack || busy || lock.current) return;
    setSelection(previous => { const old = previous.id === pack.id ? previous.indices : [];
      return { id: pack.id, indices: old.includes(index) ? old.filter(i => i !== index) : old.length < 3 ? [...old, index] : old }; });
  };
  const claim = async () => {
    if (!pack || indices.length !== 3 || busy || lock.current) return;
    lock.current = true; setSending(true); setMessage('');
    try { if (await dispatch({ kind: 'chooseRewardPack', claimId: pack.id, indices })) { setSelection({ id: '', indices: [] }); setMessage('三张卡牌已加入主收藏。'); } else setMessage('领取未完成，请重新确认当前卡包。'); }
    catch { setMessage('保存失败，请重试；候选与选择保留。'); }
    finally { lock.current = false; setSending(false); }
  };
  return <AbyssDialog title="通关卡包 · 五选三" className="abyss-dialog--traits abyss-reward-dialog" onClose={() => { if (!busy && !sending) onClose(); }}>
    {pack ? <>
      <p>{ABYSS_COMPLETION_REWARDS[pack.tier - 1]!.label}结算 · 金币 +{pack.gold} · 水晶 +{pack.crystal}已到账 · 待选卡包 {pending.length}个</p>
      <p>候选平均{ABYSS_COMPLETION_REWARDS[pack.tier - 1]!.average}。选择三张加入主收藏，可暂时关闭；刷新后候选与领取记录保留。</p>
      <AbyssTraitCards items={pack.candidates.map((id, index) => { const card = cardById.get(id)!;
        return { id: `${pack.id}:${index}`, card, icon: 'card', name: card.name, description: card.rawTraits.join(' · ') || '基础战斗卡牌',
          selected: indices.includes(index), disabled: busy || sending || indices.length === 3 && !indices.includes(index),
          footer: indices.includes(index) ? '已选中' : '点击选择', onSelect: () => toggle(index) };
      })} />
      <button type="button" className="abyss-primary" disabled={busy || sending || indices.length !== 3} onClick={() => { void claim(); }}>确认领取 {indices.length}/3</button>
    </> : <p>所有奖励卡包已领取。</p>}
    {message && <p role="status">{message}</p>}
  </AbyssDialog>;
}
