import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardDatabase } from '../data';
import { leaderboardEntries, leaderboardPage, type LeaderboardKind } from '../domain/progression/leaderboard';
import { ladderTier } from '../domain/progression/ladder';
import type { ProfileState } from '../domain/progression/types';
import './leaderboard.css';

export interface LeaderboardModalProps {
  readonly profile: ProfileState;
  readonly playerName?: string;
  readonly onClose: () => void;
}

const TABS = [{ id: 'ladder', label: '天梯榜' }, { id: 'collection', label: '收藏榜' }] as const;

export function LeaderboardModal({ profile, playerName = '当前玩家', onClose }: LeaderboardModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const id = useId();
  const [kind, setKind] = useState<LeaderboardKind>('ladder');
  const [requestedPage, setRequestedPage] = useState(1);
  const entries = useMemo(() => leaderboardEntries(profile, cardDatabase.definitions, playerName), [profile, playerName]);
  const result = useMemo(() => leaderboardPage(entries, kind, requestedPage), [entries, kind, requestedPage]);
  useEffect(() => { if (requestedPage !== result.page) setRequestedPage(result.page); }, [requestedPage, result.page]);

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    element?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const select = (next: LeaderboardKind) => { setKind(next); setRequestedPage(1); };
  return createPortal(<dialog ref={dialog} className="leaderboard" aria-modal="true"
    aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onPointerDown={event => { backdropPress.current = event.target === event.currentTarget; }}
    onClick={event => { if (backdropPress.current && event.target === event.currentTarget) onClose(); backdropPress.current = false; }}>
    <section className="leaderboard__panel">
      <header className="leaderboard__header">
        <div><span className="leaderboard__eyebrow">RANKINGS</span><h2 id={`${id}-title`}>排行榜</h2></div>
        <button type="button" className="leaderboard__close" aria-label="关闭排行榜" onClick={onClose}>×</button>
      </header>
      <p id={`${id}-description`} className="leaderboard__description">本地演示榜 · 20个虚拟账号 + 当前玩家 · 非联网排行</p>
      <div className="leaderboard__tabs" role="tablist" aria-label="排行榜类型">
        {TABS.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`${id}-${tab.id}`}
          aria-controls={`${id}-panel`} aria-selected={kind === tab.id} tabIndex={kind === tab.id ? 0 : -1}
          onClick={() => select(tab.id)} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
            const next = TABS[nextIndex]!;
            select(next.id);
            document.getElementById(`${id}-${next.id}`)?.focus();
          }}>{tab.label}</button>)}
      </div>
      <div className="leaderboard__summary" aria-live="polite">
        <span>我的排名 <strong>{result.selfRank === null ? '—' : `第 ${result.selfRank} 名`}</strong></span>
        <span>共 {result.total} 位 · 每页最多100条</span>
      </div>
      <div className="leaderboard__content" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${kind}`} tabIndex={0}>
        <table className="leaderboard__table">
          <caption className="leaderboard__caption">{kind === 'ladder' ? '天梯积分降序，积分相同按固定账号编号排列' : '收藏拥有率降序，按完整卡库不同卡种计算，重复卡不增加比例'}</caption>
          <thead><tr><th scope="col">排名</th><th scope="col">账号</th>
            <th scope="col">{kind === 'ladder' ? '段位' : '已拥有 / 卡库'}</th>
            <th scope="col">{kind === 'ladder' ? '积分' : '拥有率'}</th></tr></thead>
          <tbody>{result.rows.map(entry => <tr key={entry.id} data-self={entry.isSelf} data-entry-id={entry.id}>
            <td><span className="leaderboard__rank" data-podium={entry.rank <= 3}>{entry.rank <= 3 ? '✦ ' : ''}{entry.rank}</span></td>
            <th scope="row"><span className="leaderboard__name">{entry.name}</span><small>{entry.isSelf ? '我' : '虚拟'}</small></th>
            <td>{kind === 'ladder' ? ladderTier(entry.points).title : `${entry.owned} / ${entry.total}`}</td>
            <td className="leaderboard__value">{kind === 'ladder' ? entry.points : `${(entry.ratio * 100).toFixed(2)}%`}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <footer className="leaderboard__footer">
        <p>{kind === 'collection' ? '仅统计完整卡库的不同卡种，含活动卡；重复卡不增加拥有率。' : '匹配暂未开放；虚拟账号仅用于本地排行榜展示。'}</p>
        <nav aria-label="排行榜分页">
          <button type="button" disabled={result.page <= 1} onClick={() => setRequestedPage(result.page - 1)}>上一页</button>
          <span>{result.page} / {result.pages}</span>
          <button type="button" disabled={result.page >= result.pages} onClick={() => setRequestedPage(result.page + 1)}>下一页</button>
        </nav>
      </footer>
    </section>
  </dialog>, document.body);
}
