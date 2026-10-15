import { useEffect, useRef, useState } from 'react';
import { mailboxOf, planMailAction } from '../domain/progression/mailbox';
import type { ProfileStore } from '../state/createProfileStore';
import { useProfileStore } from '../state/useProfileStore';
import { PlayerDialog } from './PlayerPanels';
import './mailbox.css';

export function MailboxPanel({ store, onClose }: { readonly store: ProfileStore; readonly onClose: () => void }) {
  const { profile, busy } = useProfileStore(store);
  const [selected, setSelected] = useState(''), [message, setMessage] = useState('');
  const reading = useRef(false), initialRead = useRef(false);
  const mails = profile ? mailboxOf(profile).messages : [];
  const mail = mails.find(item => item.id === selected) ?? mails[0];
  const markRead = async (id: string) => {
    const current = store.getSnapshot();
    if (!current.profile || current.busy || reading.current || mailboxOf(current.profile).messages.find(m => m.id === id)?.read) return;
    reading.current = true;
    try { const result = await store.commitEconomic(p => planMailAction(p, id, 'read')); if (!result.ok) setMessage(result.message); }
    finally { reading.current = false; }
  };
  useEffect(() => { if (mail && !busy && !initialRead.current) { initialRead.current = true; void markRead(mail.id); } }, [mail?.id, busy]);
  const claim = async () => {
    if (!mail || busy) return;
    const result = await store.commitEconomic(p => planMailAction(p, mail.id, 'claim'));
    setMessage(result.ok ? result.view : result.message);
  };
  return <PlayerDialog title="邮箱" onClose={onClose}><div className="mailbox-layout">
    <nav className="mailbox-list" aria-label="邮件列表">{mails.map(item => <button type="button" key={item.id} className="btn" aria-pressed={mail?.id === item.id}
      onClick={() => { setSelected(item.id); setMessage(''); void markRead(item.id); }}>
      <span className={`mailbox-envelope${item.read ? '' : ' mailbox-envelope--new'}`} aria-hidden="true">✉</span>
      <div><strong>{item.title}</strong><small>{item.claimed ? '奖励已领取' : item.read ? '已读 · 附件待领取' : '新邮件'}</small></div></button>)}</nav>
    <section className="mailbox-content">{mail ? <><header><span>来自 {mail.sender}</span><h3>{mail.title}</h3><time dateTime={mail.createdAt}>{new Date(mail.createdAt).toLocaleDateString('zh-CN')}</time></header>
      <p>{mail.body}</p><div className="mailbox-attachments" aria-label="邮件附件"><article><span className="mailbox-gem" aria-hidden="true">◆</span><div>水晶<strong>{mail.crystal}</strong></div></article>
        <article><span className="mailbox-coin" aria-hidden="true">●</span><div>金币<strong>{mail.gold}</strong></div></article></div>
      <footer><button type="button" className="btn btn--primary" disabled={busy || mail.claimed} onClick={() => void claim()}>{mail.claimed ? '已领取' : busy ? '正在保存…' : '领取附件'}</button></footer></> : <div className="mailbox-empty">暂无邮件</div>}
      {message && <p className="mailbox-feedback" role="status">{message}</p>}</section>
  </div></PlayerDialog>;
}
