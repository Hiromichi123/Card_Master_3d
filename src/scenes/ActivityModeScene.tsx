import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RouteId } from '../app/routes';
import { cardDatabase } from '../data';
import { backgroundUrl } from '../data/assets';
import {
  activityPeriod, activityEnemyDeck, activityProgressOf, bossPhase, BOSS_PHASES, BOSS_TOTAL_HP,
  BOSS_MILESTONES, CHALLENGE_OBJECTIVES, CHALLENGE_THEMES, challengeTheme, challengeMask, planActivityReceipt,
} from '../domain/progression/activityModes';
import type { ActivityKind, ActivityTicket, ActivityReceipt, ActivityBattleReport } from '../domain/progression/activityModes';
import { activeDeckOf } from '../domain/progression/profile';
import { deckSummary } from '../domain/progression/deckView';
import {
  readActivityCycles, newActivityCycle, beginActivityBattle, abandonActivityBattle, finishActivityBattle,
  pendingTicket, personalDamage, prepareBossReward, standings,
} from '../services/activity/activityRepository';
import type { ActivityCycle } from '../services/activity/activityRepository';
import type { ProfileStore } from '../state/createProfileStore';
import { useProfileStore } from '../state/useProfileStore';
import { useSettingsStore } from '../state/settingsStore';
import { CardTile } from '../ui/CardTile';
import { CrossfadeBackground } from '../ui/SceneBackground';
import { PlayerStatus } from '../ui/PlayerStatus';
import { BattleScene } from './BattleScene';
import { definitionsFor } from './campaignFlow';
import '../ui/activityModes.css';

interface Props {
  readonly mode: ActivityKind; readonly store: ProfileStore; readonly playerId: string; readonly playerName: string;
  readonly onNavigate: (route: RouteId) => void;
}
function remaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000)), days = Math.floor(total / 86400);
  return `${days ? `${days}天 ` : ''}${String(Math.floor(total / 3600) % 24).padStart(2,'0')}:${String(Math.floor(total / 60) % 60).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
}
function PublicDeck({ ids }: { readonly ids: readonly string[] }) {
  return <div className="activity-mode__cards">{ids.map((id, index) => <div key={`${index}:${id}`} data-card-id={id}>
    <CardTile cardId={id} size="sm" />
  </div>)}</div>;
}
export function ActivityModeScene({ mode, store, playerId, playerName, onNavigate }: Props) {
  const snapshot = useProfileStore(store), profile = snapshot.profile;
  const [cycles, setCycles] = useState<ActivityCycle[]>([]), [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(Date.now()), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [ticket, setTicket] = useState<ActivityTicket | null>(null), [rankingKey, setRankingKey] = useState('');
  const [rankPhase, setRankPhase] = useState<number | null>(null), [rulesOpen, setRulesOpen] = useState(false);
  const lock = useRef(false), mounted = useRef(true);
  const still = useSettingsStore(state => state.reduceMotion);
  const refresh = useCallback(async () => {
    const result = await readActivityCycles();
    if (mounted.current) { setCycles(result); setLoaded(true); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const read = () => { void refresh().catch(error => { if (mounted.current) setNotice(String(error)); }); };
    read(); const timer = window.setInterval(read, 8000), clock = window.setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener('focus', read);
    return () => { mounted.current = false; clearInterval(timer); clearInterval(clock); window.removeEventListener('focus', read); };
  }, [refresh]);
  const commitReceipt = useCallback(async (receipt: ActivityReceipt): Promise<string> => {
    if (receipt.actorId !== playerId) throw new Error('结算账号不匹配。');
    if (store.getSnapshot().storage !== 'indexeddb') throw new Error('当前账号处于临时存档模式，恢复持久存储后才能结算。');
    const latest = store.getSnapshot().profile;
    if (!latest) throw new Error('账号存档尚未就绪。');
    if (activityProgressOf(latest).receipts.includes(receipt.id)) return '本次结算已保存。';
    const result = await store.commitEconomic(latest => planActivityReceipt(latest, receipt));
    if (!result.ok) throw new Error(result.message);
    return result.view;
  }, [store, playerId]);
  const perform = async (work: () => Promise<void>) => {
    if (lock.current || snapshot.busy) return;
    if (snapshot.storage !== 'indexeddb') { setNotice('当前账号使用临时存档，请恢复 IndexedDB 持久存储后再挑战或领奖。'); return; }
    lock.current = true; setBusy(true); setNotice('');
    try { await work(); await refresh(); }
    catch (error) { if (mounted.current) setNotice(error instanceof Error ? error.message : String(error)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const period = activityPeriod(mode, now);
  const current = cycles.find(cycle => cycle.key === period.key) ?? newActivityCycle(mode, now);
  const phase = bossPhase(current.damage), isCoop = mode === 'coop';
  const publicDeck = useMemo(() => activityEnemyDeck(mode, period.key, isCoop ? phase.index : 0, cardDatabase.definitions), [mode, period.key, isCoop, phase.index]);
  const pending = pendingTicket(cycles, playerId, mode), progress = profile ? activityProgressOf(profile) : null;
  const recoveries = cycles.flatMap(cycle => Object.values(cycle.receipts)).filter(r => r.actorId === playerId && !progress?.receipts.includes(r.id));
  const bossCycles = cycles.filter(cycle => cycle.mode === 'coop').sort((a,b) => b.period.start - a.period.start);
  const selectedCycle = bossCycles.find(cycle => cycle.key === rankingKey) ?? (isCoop ? current : undefined);
  const selectedPhase = rankPhase ?? (selectedCycle ? bossPhase(selectedCycle.damage).index : 0);
  const ranks = selectedCycle ? standings(selectedCycle, selectedPhase) : [];
  const deck = profile ? activeDeckOf(profile) : null;
  const deckIssues = deck && profile ? deckSummary(deck, profile.inventory).text : ['请先配置出战卡组'];
  const bits = progress?.challengeBits[period.key] ?? 0;
  const damaged = personalDamage(current, playerId);
  const locked = busy || snapshot.busy;
  if (ticket) return <ActivityModeBattle key={ticket.id} ticket={ticket} playerId={playerId} commitReceipt={commitReceipt}
    onBack={() => { setTicket(null); void refresh().catch(error => setNotice(String(error))); }} />;
  if (!profile) return null;
  return <section className={`activity-mode activity-mode--${mode}${still ? ' activity-mode--still' : ''}`}>
    <CrossfadeBackground url={backgroundUrl(`bg/activity_${mode}`)} className="activity-mode__background" />
    <div className="activity-mode__veil" />
    <header className="activity-mode__header">
      <div><span className="activity-mode__eyebrow">{isCoop ? 'WORLD BOSS · LOCAL SHARED' : 'TACTICAL CHALLENGE · 72 HOURS'}</span>
        <h1>{isCoop ? '协力作战' : '高难挑战'}</h1>
        <p>{isCoop ? '本地共享 · 同一浏览器中的账号共同削减世界 Boss 生命' : '公开敌阵 · 不限次数挑战 · 三日轮换'}</p>
      </div>
      <div className="activity-mode__topright"><PlayerStatus level={profile.level} currencies={profile.currencies} />
        <p>{isCoop ? '本期结束' : '敌阵轮换'} <strong>{remaining(period.end - now)}</strong></p>
        <button onClick={() => setRulesOpen(v => !v)}>规则说明</button> <button disabled={locked} onClick={() => onNavigate('activity')}>返回活动大厅</button>
      </div>
    </header>
    <div className="activity-mode__body">
      <main className="activity-mode__main">
        <section className="activity-mode__hero">
          <div className="activity-mode__sigil" aria-hidden="true"><i /><i /><i /><b>{isCoop ? 'Ω' : 'Ⅲ'}</b></div>
          <div className="activity-mode__hero-copy"><span>{isCoop ? `世界 Boss · 第${phase.index + 1}阶段` : CHALLENGE_THEMES[challengeTheme(period.key)]}</span>
            <h2>{isCoop ? (current.damage >= BOSS_TOTAL_HP ? '征伐完成' : '虚空巨像') : '三日试炼'}</h2>
            {isCoop ? <>
              <div className="activity-mode__hp-label"><strong>{BOSS_TOTAL_HP - current.damage}</strong><span>/ {BOSS_TOTAL_HP} HP</span></div>
              <div className="activity-mode__meter" role="progressbar" aria-label="世界Boss剩余生命" aria-valuemin={0} aria-valuemax={BOSS_TOTAL_HP} aria-valuenow={BOSS_TOTAL_HP - current.damage}>
                <i style={{ width: `${100 * (1 - current.damage / BOSS_TOTAL_HP)}%` }} /></div>
              <p>阶段剩余 {phase.remaining} / {BOSS_PHASES[phase.index]!.hp} · 敌阵平均 {BOSS_PHASES[phase.index]!.rarity} 级</p>
              <p>我的本期累计贡献 <strong>{damaged}</strong> · 每场最多30回合</p>
            </> : <><p>敌方本体40 HP · 我方20 HP · 每场最多30回合</p><p>通关1000金币＋100水晶，每项额外目标增加20%奖励。</p></>}
          </div>
        </section>
        <section className="activity-mode__panel">
          <div className="activity-mode__section-title"><h2>本期公开敌阵</h2><span>{isCoop ? '阶段变化后下次挑战更新' : '所有账号使用同一期固定卡组'}</span></div>
          <PublicDeck ids={publicDeck} />
        </section>
        <section className="activity-mode__panel activity-mode__launch">
          <div><h2>当前出战 · {deck?.name ?? '尚未配置'}</h2><p>{deck?.cardIds.length ?? 0} / 12 张 · 使用普通出战卡组</p>{deckIssues.length > 0 && <p>{deckIssues.join('；')}</p>}</div>
          <button disabled={locked || Boolean(pending)} onClick={() => onNavigate('deck')}>配置卡组</button>
          <button className="activity-mode__primary" disabled={locked || snapshot.storage !== 'indexeddb' || !loaded || Boolean(pending) || Boolean(recoveries.length) || Boolean(deckIssues.length) || !deck?.cardIds.length || (isCoop && current.damage >= BOSS_TOTAL_HP)}
            onClick={() => void perform(async () => { const launch = await beginActivityBattle(playerId, playerName, mode, deck!.cardIds, cardDatabase.definitions); setTicket(launch); })}>开始挑战</button>
        </section>
        {pending && <section className="activity-mode__panel activity-mode__pending"><p>存在尚未完成的挑战。继续将从该局固定种子与卡组的开局重新开始。</p>
          <button disabled={locked || snapshot.storage !== 'indexeddb' || Boolean(recoveries.length)} onClick={() => setTicket(pending)}>继续上次挑战</button>
          <button disabled={locked} onClick={() => { if (window.confirm('放弃这次未完成挑战？不会产生伤害贡献或奖励。')) void perform(async () => { await abandonActivityBattle(pending.id, playerId); }); }}>放弃未完成挑战</button></section>}
        {recoveries.length > 0 && <section className="activity-mode__panel"><h2>待入账结算</h2><p>共享进度已保存，以下奖励尚未写入当前账号。可安全重试。</p>
          {recoveries.map(r => <button key={r.id} disabled={locked} onClick={() => void perform(async () => setNotice(await commitReceipt(r)))}>{r.label} · 恢复入账</button>)}</section>}
        {rulesOpen && <section className="activity-mode__panel activity-mode__rules"><h2>玩法规则</h2>{isCoop ? <>
          <p>此版本为本地共享：同一浏览器、同一站点的不同账号共用Boss进度与真实贡献排行；不跨设备。每周一北京时间04:00开启新一期，不限制挑战次数。</p>
          <p>Boss总剩余生命直接作为敌方本体生命。只统计实际对敌方本体造成的扣血，不计卡牌伤害、自损或溢出。输、平、认输均结算已经造成的伤害。</p>
          <p>每个阶段耗尽生命后，下一场敌阵提升稀有度。跨阶段伤害按结算时的共享进度依次分配；当前战斗的敌阵保持开局配置。多标签同时挑战的超额伤害会截断。</p>
          <p>阶段结束后冻结排名；并列伤害按账号固定ID排序。第一名600金币/60水晶，2—3名400/40，4—10名250/25，其余贡献者100/10。周末尚未完成的阶段在期次结束后也可结算。</p>
          <p>个人里程碑与阶段排名奖励各领取一次，旧期次可在下方切换补领。跨周才完成的战斗不计旧期贡献。提前离开保留固定开局，不结算未完成战斗。</p>
        </> : <>
          <p>北京时间04:00起每三天轮换一次敌阵，期间固定公开12张牌；可以不限次数调整己方卡组重新挑战，敌方不会获得暗中数值加成。</p>
          <p>每期首次获胜获得1000金币、100水晶。额外目标：本体从未扣血（回血不能恢复资格）；少于15个完整回合获胜；获胜时普通手牌超过6张（冷却牌不计）。每项目标额外200金币、20水晶，可在不同胜场分别补齐，每期最多1600金币、160水晶。</p>
          <p>战斗最多30回合；失败不发奖励，完成对局计入非深渊对战统计。同一期重复通关不重复发放奖励。已开战的旧期次可完成原期挑战。</p>
        </>}</section>}
        {snapshot.storage !== 'indexeddb' && <p className="activity-mode__notice" role="alert">当前使用临时存档，恢复持久存储后才能挑战和领取奖励。</p>}
        {notice && <p className="activity-mode__notice" role="status">{notice}</p>}
      </main>
      <aside className="activity-mode__aside">
        {isCoop ? <>
          <section className="activity-mode__panel"><h2>个人伤害里程碑</h2>{BOSS_MILESTONES.map((m, index) => {
            const id = `${current.key}:milestone:${index}:${playerId}`, claimed = progress!.receipts.includes(id);
            return <div className="activity-mode__reward-row" key={m.damage}><div><strong>{m.damage}</strong><small>{m.gold}金币 · {m.crystal}水晶</small></div>
              <button disabled={locked || !loaded || damaged < m.damage || claimed} onClick={() => void perform(async () => setNotice(await commitReceipt(await prepareBossReward(playerId, current.key, 'milestone', index))))}>{claimed ? '已领取' : damaged < m.damage ? '未达成' : '领取'}</button></div>;
          })}</section>
          <section className="activity-mode__panel"><h2>阶段伤害排名 · 本地</h2>
            <select aria-label="Boss期次" value={selectedCycle?.key ?? period.key} onChange={e => { setRankingKey(e.target.value); setRankPhase(null); }}>
              {!bossCycles.some(c => c.key === period.key) && <option value={period.key}>本期</option>}
              {bossCycles.map(c => <option key={c.key} value={c.key}>{c.key === period.key ? '本期' : new Date(c.period.start).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</option>)}
            </select>
            <select aria-label="Boss阶段" value={selectedPhase} onChange={e => setRankPhase(Number(e.target.value))}>{BOSS_PHASES.map((p,i) => <option key={p.rarity} value={i}>阶段 {i + 1} · {p.rarity}</option>)}</select>
            <ol className="activity-mode__ranking">{ranks.slice(0,20).map((row,i) => <li key={row.actorId} className={row.actorId === playerId ? 'is-self' : ''}><span>{i+1}</span><b>{row.name}</b><strong>{row.damage}</strong></li>)}</ol>
            {!ranks.length && <p>该阶段暂无贡献记录</p>}
            {ranks.findIndex(row => row.actorId === playerId) >= 20 && <p>我的名次 {ranks.findIndex(row => row.actorId === playerId) + 1} · {ranks.find(row => row.actorId === playerId)!.damage}伤害</p>}
            <button disabled={locked || !loaded || !selectedCycle || (!selectedCycle.frozen[selectedPhase] && now < selectedCycle.period.end) || !ranks.some(row => row.actorId === playerId) || progress!.receipts.includes(`${selectedCycle?.key}:rank:${selectedPhase}:${playerId}`)}
              onClick={() => void perform(async () => setNotice(await commitReceipt(await prepareBossReward(playerId, selectedCycle!.key, 'rank', selectedPhase))))}>
              {progress!.receipts.includes(`${selectedCycle?.key}:rank:${selectedPhase}:${playerId}`) ? '阶段排名奖励已领取' : '领取阶段排名奖励'}</button>
            <h3>历史里程碑补领</h3>{bossCycles.filter(c => c.key !== period.key && personalDamage(c,playerId) > 0).map(c => <div key={c.key}><small>{new Date(c.period.start).toLocaleDateString('zh-CN', { timeZone:'Asia/Shanghai' })}</small>
              {BOSS_MILESTONES.map((m,i) => personalDamage(c,playerId) >= m.damage && !progress!.receipts.includes(`${c.key}:milestone:${i}:${playerId}`)
                ? <button key={m.damage} disabled={locked} onClick={() => void perform(async () => setNotice(await commitReceipt(await prepareBossReward(playerId,c.key,'milestone',i))))}>{m.damage}伤害奖励</button> : null)}</div>)}</section>
        </> : <section className="activity-mode__panel"><h2>本期挑战目标</h2>{CHALLENGE_OBJECTIVES.map((name,i) => <div className={`activity-mode__objective${bits & (1<<i) ? ' is-complete' : ''}`} key={name}>
          <span>{bits & (1<<i) ? '◆' : '◇'}</span><div><h3>{name}</h3><p>{i === 0 ? '1000金币 · 100水晶' : '额外200金币 · 20水晶'}</p></div></div>)}
          <p>已领取目标保留至本期结束。其它目标可以继续挑战补齐。</p>
          <h3>最高奖励</h3><p className="activity-mode__gold">1600金币 ＋ 160水晶</p></section>}
      </aside>
    </div>
  </section>;
}

function ActivityModeBattle({ ticket, playerId, commitReceipt, onBack }: {
  readonly ticket: ActivityTicket; readonly playerId: string;
  readonly commitReceipt: (receipt: ActivityReceipt) => Promise<string>; readonly onBack: () => void;
}) {
  const definitions = useMemo(() => definitionsFor([...ticket.config.playerDeck, ...ticket.config.enemyDeck]), [ticket]);
  const [report, setReport] = useState<ActivityBattleReport | null>(null), [saved, setSaved] = useState(false);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const inFlight = useRef(false), mounted = useRef(true), receiptRef = useRef<ActivityReceipt | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const save = async (next: ActivityBattleReport) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('正在保存本次结算…');
    try {
      const receipt = receiptRef.current ?? await finishActivityBattle(ticket.id, playerId, next);
      receiptRef.current = receipt;
      const result = await commitReceipt(receipt);
      if (mounted.current) { setMessage(result); setSaved(true); }
    } catch (error) { if (mounted.current) setMessage(`结算暂未入账，请重试：${error instanceof Error ? error.message : String(error)}`); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const won = report?.outcome.kind === 'win' && report.outcome.winner === 'player';
  return <BattleScene config={ticket.config} definitions={definitions} autoStart allowRematch={false} exitDisabled={busy} leaveLabel="返回模式大厅"
    onReport={next => { setReport(next); void save(next); }}
    onLeave={() => { if (report || window.confirm('离开会保留本次固定开局，稍后可从开局继续；未完成对局暂不结算。')) onBack(); }}
    resultPanel={<div className="activity-mode-result"><div className="activity-mode__panel">
      <span className="activity-mode__eyebrow">{ticket.mode === 'coop' ? 'WORLD BOSS' : 'TACTICAL CHALLENGE'}</span>
      <h1>{ticket.mode === 'coop' ? '征伐记录' : won ? '挑战成功' : report?.outcome.kind === 'draw' ? '本局平局' : '挑战结束'}</h1>
      {report && <><p>回合 {report.turns} · 我方剩余生命 {report.playerHp}</p>
        {ticket.mode === 'coop' ? <p>本场本体伤害 <strong>{report.enemyBaseDamage}</strong> · 计入贡献 <strong>{receiptRef.current?.damage ?? '结算中'}</strong></p>
          : CHALLENGE_OBJECTIVES.map((name,i) => <p key={name} className={challengeMask(report) & (1<<i) ? 'activity-mode__gold' : ''}>{challengeMask(report) & (1<<i) ? '◆' : '◇'} {name}</p>)}</>}
      <p role="status">{message}</p>
      {!saved && <button disabled={busy || !report} onClick={() => report && void save(report)}>重试保存</button>}
      <button disabled={busy} onClick={onBack}>{saved ? '返回模式大厅' : receiptRef.current ? '返回并稍后恢复结算' : '返回并从开局重试'}</button>
    </div></div>} />;
}
