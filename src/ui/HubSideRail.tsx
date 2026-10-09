import type { ReactNode } from 'react';
import linkConfig from '../data/hub-links.json';
import { pushToast } from '../state/toastStore';
import './hubSideRail.css';

type ExternalId = 'qq' | 'steam' | 'x' | 'support';
type IconId = 'mail' | 'friends' | 'notice' | ExternalId;
const links: Readonly<Record<ExternalId, string | null>> = linkConfig;
const INTERNAL = [
  { id: 'mail', label: '邮件', hint: '邮件功能暂未开放' },
  { id: 'friends', label: '好友', hint: '好友功能暂未开放' },
  { id: 'notice', label: '公告', hint: '暂无已发布公告' },
] as const;
const EXTERNAL: readonly { id: ExternalId; label: string }[] = [
  { id: 'qq', label: 'QQ 社群' }, { id: 'steam', label: 'Steam' },
  { id: 'x', label: 'X' }, { id: 'support', label: '支持开发者' },
];

function Icon({ id }: { readonly id: IconId }) {
  let drawing: ReactNode;
  switch (id) {
    case 'mail': drawing = <><rect x="3" y="5.5" width="18" height="13" rx="1.8" /><path d="m4 7 8 6 8-6M4 17l5-4m11 4-5-4" /></>; break;
    case 'friends': drawing = <><circle cx="9" cy="8" r="3" /><path d="M3.5 20v-2.5a5.5 5.5 0 0 1 11 0V20M16 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 3 4.6V20" /></>; break;
    case 'notice': drawing = <><path d="m4 10 12-5v14L4 14zM16 9l4-2v10l-4-2M6 15l1 5h4l-2-4M2 10v4" /><path d="M19 3.5 21 2M20 21l-2-1" /></>; break;
    case 'qq': drawing = <><ellipse cx="12" cy="13" rx="6" ry="7" /><path d="M7.5 7.5a4.5 4.5 0 0 1 9 0M6.5 11.5 3.5 16l2 1.5M17.5 11.5l3 4.5-2 1.5M7 19l-3 2h6m4 0h6l-3-2M7 10c3 1.5 7 1.5 10 0" /><path d="m10 7 0 .2m4-.2 0 .2" strokeWidth="2.6" /></>; break;
    case 'steam': drawing = <><circle cx="16.3" cy="7.8" r="5.2" /><circle cx="16.3" cy="7.8" r="2.5" /><circle cx="6.4" cy="17.3" r="3.4" /><path d="m8.4 14.5 4.1-3.2M9.8 17l5.1-4M1.8 14.8l4.8 2.3M20 16.5a9.6 9.6 0 0 1-15 4.6" /></>; break;
    case 'x': drawing = <path d="M4 3h4.3L20 21h-4.3ZM20 3 4 21" />; break;
    case 'support': drawing = <><path d="M12 21 3.9 13a5.1 5.1 0 0 1 7.2-7.2l.9.9.9-.9A5.1 5.1 0 0 1 20.1 13Z" /><path d="m12 9 .9 2.5 2.6.9-2.6.9L12 17l-.9-2.8-2.6-.9 2.6-.9Z" /></>; break;
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{drawing}</svg>;
}

/** Addresses are configured independently of layout; empty targets never send players to guessed pages. */
export function HubSideRail() {
  return <nav className="hub-side" aria-label="社交与社区入口">
    <div className="hub-side__group">
      {INTERNAL.map((entry) => <button key={entry.id} type="button" className="hub-side__link ui-control"
        title={entry.label} aria-label={entry.label} onClick={() => pushToast(entry.hint, 'info')}>
        <Icon id={entry.id} /><span className="hub-side__caption">{entry.label}</span>
      </button>)}
    </div>
    <span className="hub-side__divider" aria-hidden="true" />
    <div className="hub-side__group">
      {EXTERNAL.map((entry) => {
        const href = links[entry.id];
        const children = <><Icon id={entry.id} /><span className="hub-side__external" aria-hidden="true">↗</span>
          <span className="hub-side__caption">{entry.label}</span></>;
        return href ? <a key={entry.id} className="hub-side__link ui-control" href={href}
          target="_blank" rel="noopener noreferrer" title={`${entry.label}（在新窗口打开）`}
          aria-label={`${entry.label}，在新窗口打开`}>{children}</a>
          : <button key={entry.id} type="button" className="hub-side__link ui-control" data-unconfigured="true"
            title={`${entry.label}（链接暂未配置）`} aria-label={`${entry.label}，链接暂未配置`}
            onClick={() => pushToast(`${entry.label}链接暂未配置`, 'info')}>{children}</button>;
      })}
    </div>
  </nav>;
}
