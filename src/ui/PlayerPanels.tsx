import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cardDatabase, stages } from '../data';
import { activityOf, activityCount, battleCountOf, noviceTasks, planNoviceClaim, taskClaimed, type NoviceKind } from '../domain/progression/playerActivity';
import { ladderTier } from '../domain/progression/ladder';
import type { ProfileState } from '../domain/progression/types';
import type { ProfileStore } from '../state/createProfileStore';
import { useProfileStore } from '../state/useProfileStore';
import { CardTile } from './CardTile';
import './playerPanels.css';

type IconKind = 'tree' | 'tier' | 'crown' | 'map' | 'collection' | 'abyss' | 'settle' | 'tasks';
function StatLogo({ kind, color }: { readonly kind: IconKind; readonly color: string }) {
  const gradient = `stat-${useId().replace(/:/g, '')}`;
  const paths: Record<IconKind, string> = {
    tree: 'M40 8 21 29h10L15 47h18v22h14V47h18L49 29h10ZM20 71h40',
    tier: 'M15 18h50v25L40 71 15 43ZM40 27l5 10 12 2-9 8 2 12-10-6-10 6 2-12-9-8 12-2Z',
    crown: 'M13 25 28 37 40 13l12 24 15-12-8 35H21ZM23 69h34',
    map: 'M10 21 30 12l20 9 20-9v46l-20 9-20-9-20 9ZM30 12v46M50 21v46',
    collection: 'M16 19h20l4 5 4-5h20v43H44l-4 5-4-5H16ZM40 24v43M24 29h8M24 38h8M48 29h8M48 38h8',
    abyss: 'M40 9 67 24l-6 32-21 17-21-17-6-32ZM40 23 54 40 40 58 26 40Z',
    settle: 'M19 12h42v56H19ZM28 26l5 5 12-12M28 44h24M28 55h24',
    tasks: 'M21 18h38v51H21ZM31 18v-6h18v6M28 33l6 6 13-14M28 51h24M28 59h17',
  };
  return <svg viewBox="0 0 80 80" aria-hidden="true"><defs><linearGradient id={gradient} x2="1" y2="1"><stop stopColor="#fff4d2"/><stop offset=".45" stopColor={color}/><stop offset="1" stopColor="#534058"/></linearGradient></defs>
    <path d={paths[kind]} fill={`url(#${gradient})`} fillOpacity=".35" stroke={`url(#${gradient})`} strokeWidth="3" strokeLinejoin="round"/></svg>;
}
export function PlayerDialog({ title, onClose, children }: { readonly title: string; readonly onClose: () => void; readonly children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = ref.current; element?.showModal(); return () => { element?.close(); previous?.focus({ preventScroll: true }); }; }, []);
  return <dialog ref={ref} className="player-panel" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><small>PLAYER RECORDS</small><h2>{title}</h2></div><button className="btn" type="button" onClick={onClose}>关闭</button></header>{children}
  </dialog>;
}
export function StatisticsPanel({ profile, playerId, onClose }: { readonly profile: ProfileState; readonly playerId?: string; readonly onClose: () => void }) {
  const activity = activityOf(profile), definitions = cardDatabase.definitions.filter(c => c.status === 'complete');
  const collected = definitions.filter(c => (profile.inventory[c.cardId] ?? 0) > 0).length;
  const ids = new Set(stages.chapters.flatMap(c => c.stages.map(s => s.id)));
  const cleared = new Set(profile.campaign.clearedStages.filter(id => ids.has(id))).size;
  const highest = Math.max(profile.abyss.best?.cleared ?? 0, profile.abyss.run?.highestCleared ?? 0,
    ...profile.abyss.history.map(h => h.highestCleared ?? 0));
  const floor = profile.mazeRun?.floorKey.match(/\d+/)?.[0];
  const settled = activity.abyssSettledRunIds.length;
  const tiles: readonly { kind: IconKind; name: string; value: string; detail: string; color: string }[] = [
    { kind: 'tree', name: '世界树当前层数', value: floor ? `第 ${floor} 层` : '未开启', detail: profile.mazeRun ? `已探索 ${profile.mazeRun.exploredNodeIds.length} 个节点` : '进入世界树开始探索', color: '#85cfa0' },
    { kind: 'tier', name: '当赛季天梯段位', value: ladderTier(profile.ladder.points).title, detail: `${profile.ladder.points} 积分 · 当前记录`, color: ladderTier(profile.ladder.points).color },
    { kind: 'crown', name: '最高天梯段位', value: ladderTier(Math.max(activity.highestLadderPoints, profile.ladder.points)).title, detail: `${Math.max(activity.highestLadderPoints, profile.ladder.points)} 最高积分`, color: '#e8c77e' },
    { kind: 'map', name: '战役关卡进度', value: `${cleared} / ${ids.size}`, detail: `${stages.chapters.length} 章 · 已通关关卡`, color: '#70bed9' },
    { kind: 'collection', name: '卡牌收藏率', value: `${definitions.length ? (collected / definitions.length * 100).toFixed(1) : '0'}%`, detail: `${collected} / ${definitions.length} 种 · 重复卡不重复计算`, color: '#d1a2e7' },
    { kind: 'abyss', name: '深渊最高通关', value: highest ? `${Math.ceil(highest / 10)}-${(highest - 1) % 10 + 1}` : '暂无', detail: '累计最高已通关位置', color: '#bd90e7' },
    { kind: 'settle', name: '深渊累计结算次数', value: `${settled} 次`, detail: '同一轮只计一次，含进入无尽结算', color: '#e399ac' },
  ];
  return <PlayerDialog title="数据统计" onClose={onClose}><div className="player-identity"><span>玩家 ID</span><strong>{playerId || '读取中…'}</strong></div><div className="player-stats">{tiles.map(tile => <article key={tile.kind} style={{ '--stat-color': tile.color } as CSSProperties}>
    <StatLogo kind={tile.kind} color={tile.color}/><div><small>{tile.name}</small><strong>{tile.value}</strong><p>{tile.detail}</p></div></article>)}</div>
    <section className="player-totals">{[['玩家对战场数（非深渊）', battleCountOf(profile)], ['总计抽卡次数', activity.draws], ['总计工坊融合次数', activity.fusions]].map(([name, value]) => <div key={name}><span>{name}</span><strong>{value}</strong></div>)}</section>
    <p className="player-panel__note">战役、世界树和本地选卡对战计入对战场数；演示、开发试玩和深渊不计入。十连计 10 次抽卡。旧档没有记录的抽卡、融合或历史最高积分无法追溯，从更新后累计；可恢复的历史记录已保留。</p>
  </PlayerDialog>;
}
export function NoviceRewards({ store }: { readonly store: ProfileStore }) {
  const { profile, busy } = useProfileStore(store), [open, setOpen] = useState(false);
  const [message, setMessage] = useState(''), [rewardCard, setRewardCard] = useState<string | null>(null);
  if (!profile) return null;
  const kinds: readonly NoviceKind[] = ['battle', 'draw', 'fusion'];
  const ready = kinds.some(kind => noviceTasks(profile, kind).some(task => !taskClaimed(profile, task) && activityCount(profile, kind) >= task.target));
  const claim = async (kind: NoviceKind, repeat: boolean, index: number) => {
    const result = await store.commitEconomic(current => planNoviceClaim(current, kind, repeat, index, cardDatabase.definitions));
    setMessage(result.ok ? result.view.text : result.message); setRewardCard(result.ok ? result.view.cardId ?? null : null);
  };
  return <><button className="hub-novice-entry" type="button" data-ready={ready} onClick={() => setOpen(true)} aria-haspopup="dialog">
    <StatLogo kind="tasks" color="#e6c77d"/><span>新手任务</span>{ready && <i aria-label="有奖励可领取"/>}</button>
    {open && <PlayerDialog title="新手任务" onClose={() => setOpen(false)}><p className="player-panel__note">累计进度长期保留，每档独立领取；最后一档可无限重复。战斗不含深渊、演示及开发试玩。</p>
      <div className="novice-groups">{kinds.map(kind => { const count = activityCount(profile, kind), name = { battle: '完成战斗', draw: '抽取卡牌', fusion: '工坊融合' }[kind];
        return <section key={kind}><h3>{name}<span>累计 {count} 次</span></h3><div className="novice-tasks">{noviceTasks(profile, kind).map(task => {
          const claimed = taskClaimed(profile, task), available = !claimed && count >= task.target;
          return <article key={`${task.repeat}:${task.index}`} data-ready={available} data-claimed={claimed}><small>{task.repeat ? `循环任务 · 已领 ${task.index} 次` : `阶段 ${task.index + 1}`}</small>
            <h4>{name} {task.target} 次</h4><strong>{task.label}</strong><progress max={task.target} value={Math.min(count, task.target)} aria-label={`${name}进度`}/>
            <span>{Math.min(count, task.target)} / {task.target}</span><button className="btn" type="button" disabled={busy || !available} onClick={() => void claim(kind, task.repeat, task.index)}>{claimed ? '已领取' : available ? '领取奖励' : '未完成'}</button></article>;
        })}</div></section>;
      })}</div><div className="novice-result" role="status"><span>{message}</span>{rewardCard && <CardTile cardId={rewardCard} size="sm"/>}</div>
    </PlayerDialog>}
  </>;
}
