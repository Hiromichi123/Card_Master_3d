import { useEffect, useRef, useState } from 'react';
import { getSocialOverview, searchSocialPlayer, updateFriendship, type SocialOverview, type SocialPlayer } from '../services/auth/accounts';
import { PlayerDialog } from './PlayerPanels';
import './friends.css';

export function FriendsPanel({ accountId, onClose }: { readonly accountId: string; readonly onClose: () => void }) {
  const [data, setData] = useState<SocialOverview | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<SocialPlayer | null>(null);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  const locked = useRef(false);
  const searchVersion = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      if (locked.current) return;
      void getSocialOverview(accountId).then(result => { if (mounted.current) setData(result); })
        .catch(error => { if (mounted.current) setMessage(error instanceof Error ? error.message : '读取好友失败'); });
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    window.addEventListener('card-master-social-change', refresh);
    return () => { mounted.current = false; searchVersion.current++; window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('card-master-social-change', refresh); };
  }, [accountId]);
  const search = async () => {
    if (locked.current) return;
    const version = ++searchVersion.current;
    locked.current = true; setBusy(true); setMessage(''); setFound(null); setSearched(false);
    try {
      const player = await searchSocialPlayer(accountId, query.trim());
      if (mounted.current && version === searchVersion.current) { setFound(player); setSearched(true); }
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : '搜索失败');
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const change = async (player: SocialPlayer, action: Parameters<typeof updateFriendship>[2]) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage('');
    try {
      const result = await updateFriendship(accountId, player.publicId, action);
      if (!mounted.current) return;
      setData(result);
      setMessage({ request: '申请已发送', accept: '已成为好友', reject: '已拒绝申请', cancel: '已撤回申请', remove: '已移除好友' }[action]);
      if (found?.publicId === player.publicId) {
        const updated = await searchSocialPlayer(accountId, player.publicId);
        if (mounted.current) setFound(updated);
      }
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : '操作失败'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const row = (player: SocialPlayer) => {
    const relation = data?.self.publicId === player.publicId ? 'self'
      : data?.friends.some(item => item.publicId === player.publicId) ? 'friend'
      : data?.incoming.some(item => item.publicId === player.publicId) ? 'incoming'
      : data?.outgoing.some(item => item.publicId === player.publicId) ? 'outgoing' : 'none';
    return <article className="friend-row" key={player.publicId}>
      <span className="friend-avatar" aria-hidden="true">{player.username.slice(0, 1)}</span>
      <div className="friend-copy"><strong>{player.username}</strong><small>ID {player.publicId}</small></div>
      <div className="friend-actions">{relation === 'self' ? <span>这是你自己</span> : relation === 'friend'
        ? <button className="btn" type="button" disabled={busy} onClick={() => void change(player, 'remove')}>移除好友</button>
        : relation === 'incoming' ? <><button className="btn" type="button" disabled={busy} onClick={() => void change(player, 'accept')}>接受</button><button className="btn" type="button" disabled={busy} onClick={() => void change(player, 'reject')}>拒绝</button></>
        : relation === 'outgoing' ? <><span>等待接受</span><button className="btn" type="button" disabled={busy} onClick={() => void change(player, 'cancel')}>撤回</button></>
        : <button className="btn" type="button" disabled={busy || !data} onClick={() => void change(player, 'request')}>添加好友</button>}</div>
    </article>;
  };
  return <PlayerDialog title="好友" onClose={onClose}>
    <div className="friend-self"><span>我的玩家 ID</span><strong>{data?.self.publicId ?? '读取中…'}</strong><small>固定七位 ID</small></div>
    <form className="friend-search" onSubmit={event => { event.preventDefault(); void search(); }}>
      <label htmlFor="friend-id">搜索玩家</label><input id="friend-id" value={query} disabled={busy} inputMode="numeric" maxLength={7} placeholder="输入七位玩家 ID"
        onChange={event => { setQuery(event.target.value.replace(/\D/g, '').slice(0, 7)); setFound(null); setSearched(false); }} />
      <button className="btn" disabled={busy || query.length !== 7} type="submit">{busy ? '处理中…' : '搜索'}</button>
    </form>
    {found && <section className="friends-section"><h3>搜索结果</h3>{row(found)}</section>}
    {searched && !found && <p className="player-panel__note">未找到该 ID，请确认对方已在当前浏览器注册账号。</p>}
    <p className="friend-message" role="status">{message}</p>
    {!!data?.incoming.length && <section className="friends-section"><h3>收到的申请 · {data.incoming.length}</h3>{data.incoming.map(row)}</section>}
    <section className="friends-section"><h3>我的好友 · {data?.friends.length ?? 0}</h3>{data?.friends.map(row)}{!data?.friends.length && <p className="player-panel__note">暂无好友，输入对方的七位 ID 开始添加。</p>}</section>
    {!!data?.outgoing.length && <section className="friends-section"><h3>发出的申请</h3>{data.outgoing.map(row)}</section>}
    <p className="player-panel__note">本地好友系统：仅支持同一浏览器、同一站点内注册的账号，好友关系保存在账号库中。暂不支持跨设备搜索、聊天和联机。</p>
  </PlayerDialog>;
}
