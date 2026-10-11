import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { cardDatabase } from '../data';
import { CHECK_IN_LIMIT, canCheckIn } from '../domain/progression/rewardState';
import {
  planRewardClaim, rewardAvailable, rewardClaimed, rewardDescription, rewardNodes,
  type RewardKind, type RewardMode, type RewardNode,
} from '../domain/progression/rewards';
import type { ProfileState } from '../domain/progression/types';
import type { ProfileStore } from '../state/createProfileStore';
import { pushToast } from '../state/toastStore';
import { useSettingsStore } from '../state/settingsStore';
import { CardTile } from './CardTile';
import './hubRewards.css';

/** Native vector enamel badges; the ray layer rotates independently behind them. */
function RewardLogo({ kind }: { readonly kind: RewardMode | RewardKind }) {
  const story = kind === 'story';
  const calendar = kind === 'checkIn';
  const id = `reward-logo-${kind}-${useId()}`;
  return <svg viewBox="0 0 80 80" fill="none" aria-hidden="true">
    <defs><linearGradient id={id} x1="12" y1="10" x2="65" y2="72" gradientUnits="userSpaceOnUse">
      <stop stopColor={story ? '#ffdb81' : calendar ? '#a9f2ee' : kind === 'crystal' ? '#bfecff' : '#fff3b0'} />
      <stop offset=".5" stopColor={story ? '#ed7150' : calendar ? '#52abc8' : kind === 'crystal' ? '#668af1' : '#d6a447'} />
      <stop offset="1" stopColor={story ? '#ad354b' : calendar ? '#466cae' : kind === 'crystal' ? '#9a54c6' : '#9a5e22'} />
    </linearGradient></defs>
    {story ? <>
      <path d="M23 66V14" stroke="#ffe2a0" strokeWidth="5" strokeLinecap="round" />
      <path d="M26 15c13-8 24 11 39 3v32c-15 8-26-11-39-3Z" fill={`url(#${id})`} stroke="#ffe4ac" strokeWidth="2" />
      <path d="m40 25 4 7 8 1-6 6 1 8-7-4-7 4 1-8-6-6 8-1Z" fill="#fff1c3" />
      <path d="M13 68h26" stroke="#ffdfa0" strokeWidth="3" strokeLinecap="round" />
    </> : calendar ? <>
      <rect x="13" y="19" width="54" height="48" rx="7" fill={`url(#${id})`} stroke="#f9e0a2" strokeWidth="2.5" />
      <path d="M14 33h52M26 13v14m28-14v14" stroke="#fff2c4" strokeWidth="4" strokeLinecap="round" />
      <path d="m29 48 8 8 15-16" stroke="#fff8d5" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="61" cy="62" r="10" fill="#f4cf6b" stroke="#fff2bd" strokeWidth="2" />
      <path d="m61 56 1.5 4 4 .5-3 3 1 4-3.5-2-3.5 2 1-4-3-3 4-.5Z" fill="#bc7940" />
    </> : kind === 'crystal' ? <>
      <path d="m40 10 24 18-8 34-16 10-16-10-8-34Z" fill={`url(#${id})`} stroke="#e3e8ff" strokeWidth="2" />
      <path d="m40 10-9 22 9 40 9-40-9-22ZM16 28l15 4h18l15-4M24 62l7-30m25 30-7-30" stroke="#deecff" strokeWidth="1.5" opacity=".8" />
    </> : <>
      <ellipse cx="40" cy="47" rx="26" ry="25" fill="#986024" stroke="#f7d884" strokeWidth="2" />
      <circle cx="40" cy="39" r="26" fill={`url(#${id})`} stroke="#ffe5a2" strokeWidth="2" />
      <circle cx="40" cy="39" r="20" stroke="#fff0b9" strokeWidth="1.5" />
      <path d="m40 23 4 10 11 1-8 7 2 11-9-5-9 5 2-11-8-7 11-1Z" fill="#fff0b3" />
    </>}
  </svg>;
}

export function HubRewards({ profile, store, busy }: {
  readonly profile: ProfileState; readonly store: ProfileStore; readonly busy: boolean;
}) {
  const [mode, setMode] = useState<RewardMode | null>(null);
  const [today, setToday] = useState(() => store.todayKey());
  const still = useSettingsStore(state => state.reduceMotion);
  const storyCount = new Set(profile.campaign.clearedStages.filter(id => /^[1-4]-[1-4]$/.test(id))).size;
  const storyReady = profile.campaign.clearedStages.some(id => /^[1-4]-[1-4]$/.test(id)
    && !profile.rewards.claimedStoryIds.includes(id));
  const days = profile.rewards.checkIn.length;
  const signReady = canCheckIn(profile.rewards, days + 1, today);
  const close = useCallback(() => setMode(null), []);
  useEffect(() => {
    const refresh = () => setToday(store.todayKey());
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [store]);
  const open = (next: RewardMode) => { setToday(store.todayKey()); setMode(next); };
  return <>
    <nav className={`hub-rewards${still ? ' hub-rewards--still' : ''}`} aria-label="玩家奖励">
      {(['story', 'checkIn'] as const).map(kind => {
        const ready = kind === 'story' ? storyReady : signReady;
        return <button type="button" className={`hub-rewards__entry hub-rewards__entry--${kind}`}
          key={kind} onClick={() => open(kind)} aria-haspopup="dialog">
          <span className="hub-rewards__logo"><span className="hub-rewards__rays" />
            <RewardLogo kind={kind} />{ready && <i className="hub-rewards__notice" />}</span>
          <strong>{kind === 'story' ? '剧情奖励' : '签到奖励'}</strong>
          <small>{kind === 'story' ? `${storyCount}/16 通关` : `${days}/${CHECK_IN_LIMIT} 日`}</small>
        </button>;
      })}
    </nav>
    {mode && <RewardRail key={mode} mode={mode} profile={profile} store={store} busy={busy}
      today={today} still={still} onClose={close} />}
  </>;
}

function RewardRail({ mode, profile, store, busy, today, still, onClose }: {
  readonly mode: RewardMode; readonly profile: ProfileState; readonly store: ProfileStore;
  readonly busy: boolean; readonly today: string; readonly still: boolean; readonly onClose: () => void;
}) {
  const nodes = useMemo(() => rewardNodes(mode, cardDatabase.definitions), [mode]);
  const track = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ id: number; x: number; scroll: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const rows = nodes.map(node => ({ node, claimed: rewardClaimed(profile, mode, node),
    available: rewardAvailable(profile, mode, node, today),
    complete: mode === 'story' ? profile.campaign.clearedStages.includes(node.id)
      : rewardClaimed(profile, mode, node) }));
  const claimedCount = rows.filter(row => row.claimed).length;
  const firstAvailable = rows.findIndex(row => row.available);
  const firstUnclaimed = rows.findIndex(row => !row.claimed);
  const initialIndex = useRef(firstAvailable >= 0 ? firstAvailable : firstUnclaimed >= 0 ? firstUnclaimed : nodes.length - 1);
  const move = (direction: number) => track.current?.scrollBy({ left: direction * (track.current.clientWidth * .65),
    behavior: still ? 'instant' : 'smooth' });

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = panel.current;
    element?.focus({ preventScroll: true });
    const scroll = track.current;
    const first = scroll?.querySelector<HTMLElement>(`[data-reward-index="${initialIndex.current}"]`);
    if (scroll && first) scroll.scrollLeft = first.offsetLeft - (scroll.clientWidth - first.offsetWidth) / 2;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
      if (event.key === 'Tab' && element) {
        const items = [...element.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')];
        const firstItem = items[0]; const lastItem = items.at(-1);
        if (event.shiftKey && (document.activeElement === firstItem || document.activeElement === element)) {
          event.preventDefault(); lastItem?.focus();
        } else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem?.focus(); }
      }
    };
    const wheel = (event: WheelEvent) => {
      if (!scroll || event.ctrlKey) return;
      event.preventDefault();
      scroll.scrollLeft += (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY)
        * (event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? scroll.clientWidth : 1);
    };
    document.addEventListener('keydown', keyboard, true);
    scroll?.addEventListener('wheel', wheel, { passive: false });
    return () => {
      mounted.current = false;
      document.removeEventListener('keydown', keyboard, true);
      scroll?.removeEventListener('wheel', wheel);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [onClose]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    suppressClick.current = false;
    dragging.current = { id: event.pointerId, x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false };
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = dragging.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    const offset = event.clientX - gesture.x;
    if (gesture.moved || Math.abs(offset) > 6) {
      if (!gesture.moved) event.currentTarget.setPointerCapture(event.pointerId);
      gesture.moved = true; suppressClick.current = true;
      event.currentTarget.dataset.dragging = 'true';
      event.currentTarget.scrollLeft = gesture.scroll - offset;
      event.preventDefault();
    }
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current?.id !== event.pointerId) return;
    dragging.current = null;
    delete event.currentTarget.dataset.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const claim = async (node: RewardNode) => {
    if (busy || pendingRef.current) return;
    pendingRef.current = true; setPending(node.id); setMessage('');
    try {
      const result = await store.commitEconomic(current => planRewardClaim({
        profile: current, mode, nodeId: node.id, definitions: cardDatabase.definitions,
        dayKey: store.todayKey(), operationId: store.nextOperationId(),
      }));
      if (!mounted.current) return;
      if (result.ok) {
        const text = `已领取：${result.view.description}`;
        setMessage(text); pushToast(text);
      } else setMessage(result.reason === 'saveFailed' ? `保存失败，奖励尚未领取：${result.message}` : result.message);
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(null);
    }
  };

  return createPortal(<div className={`reward-overlay${still ? ' reward-overlay--still' : ''}`}
    onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="reward-rail" role="dialog" aria-modal="true" aria-labelledby="reward-rail-title"
      aria-describedby="reward-rail-description" ref={panel} tabIndex={-1}>
      <header className="reward-rail__header">
        <div className="reward-rail__heading"><RewardLogo kind={mode} /><div>
          <span className="reward-rail__eyebrow">{mode === 'story' ? '冒险的回响' : '旅人的约定'}</span>
          <h2 id="reward-rail-title">{mode === 'story' ? '剧情奖励' : '签到奖励'}</h2>
        </div></div>
        <div className="reward-rail__progress"><b>{claimedCount}</b> / {nodes.length} 已领取</div>
        <button type="button" className="reward-rail__close" aria-label="关闭奖励栏" onClick={onClose}>×</button>
      </header>
      <p className="reward-rail__description" id="reward-rail-description">{mode === 'story'
        ? '通关对应关卡后领取 · 金币、水晶、卡牌依次递增 · 第四章尚未开放'
        : `累计签到 30 日 · 每天领取一次，漏签不清零 · ${today.slice(0, 4)}.${today.slice(4, 6)}.${today.slice(6)}`}</p>
      <div className="reward-rail__viewport">
        <button type="button" className="reward-rail__arrow reward-rail__arrow--left" aria-label="预览前面的奖励" onClick={() => move(-1)}>‹</button>
        <div className="reward-rail__track" ref={track} tabIndex={0} aria-label="横向奖励列表，可拖动或使用左右方向键"
          onPointerDown={startDrag} onPointerMove={drag} onPointerUp={endDrag} onPointerCancel={endDrag}
          onLostPointerCapture={event => { dragging.current = null; delete event.currentTarget.dataset.dragging; }}
          onPointerLeave={event => { if (dragging.current && !dragging.current.moved) endDrag(event); }}
          onClickCapture={event => { if (suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); } suppressClick.current = false; }}
          onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);
          } }}>
          <div className="reward-rail__nodes">
            {rows.map(({ node, claimed, available, complete }, index) => <div key={node.id}
              data-reward-index={index} className={`reward-node${complete ? ' reward-node--complete' : ''}${available ? ' reward-node--ready' : ''}${claimed ? ' reward-node--claimed' : ''}`}
              style={{ '--reward-hue': node.kind === 'crystal' ? '#7a9bdd' : node.kind === 'card' ? '#ad8565' : '#e3b35d' } as CSSProperties}>
              {index > 0 && <span className={`reward-node__connector${complete && rows[index - 1]?.complete ? ' reward-node__connector--lit' : ''}`} aria-hidden="true"><i /></span>}
              <div className="reward-node__reward"><strong>{node.kind === 'card' ? `${node.card?.rarity ?? ''} 卡牌 ×1`
                : `${node.kind === 'gold' ? '金币' : '水晶'} ×${node.amount}`}</strong>
                <small title={rewardDescription(node)}>{node.card ? node.card.name : mode === 'story' ? `第 ${node.chapter} 章通关礼` : '每日签到礼'}</small></div>
              <div className="reward-node__square" data-card-id={node.card?.cardId}>
                <span className="reward-node__engraving" aria-hidden="true" />
                {node.card ? <CardTile cardId={node.card.cardId} size="sm" /> : <RewardLogo kind={node.kind} />}
                {claimed && <span className="reward-node__check" aria-label="已领取">✓</span>}
              </div>
              <span className="reward-node__label">{node.label}</span>
              <button type="button" className="reward-node__claim" disabled={!available || busy || pending !== null}
                aria-label={`${node.label} ${rewardDescription(node)} ${claimed ? '已领取' : '领取奖励'}`}
                onClick={() => { void claim(node); }}>{pending === node.id ? '保存中…' : claimed ? '已领取'
                  : available ? mode === 'checkIn' ? '签到领取' : '领取' : mode === 'story'
                    ? node.chapter === 4 ? '未开放' : '未通关' : node.day === profile.rewards.checkIn.length + 1
                      ? '明日继续' : '待签到'}</button>
            </div>)}
          </div>
        </div>
        <button type="button" className="reward-rail__arrow reward-rail__arrow--right" aria-label="预览后面的奖励" onClick={() => move(1)}>›</button>
      </div>
      <footer className="reward-rail__footer"><span>拖动 / 滚轮 · 左右预览</span>
        <span className="reward-rail__message" role="status" aria-live="polite">{message || (mode === 'checkIn' && profile.rewards.checkIn.length === CHECK_IN_LIMIT ? '30 日签到旅程已完成' : '奖励领取后自动保存')}</span></footer>
    </div>
  </div>, document.body);
}
