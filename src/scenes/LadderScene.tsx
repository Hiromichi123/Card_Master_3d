import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cardById, cardDatabase, rarityList } from '../data';
import { LADDER_REWARDS, planLadderRewardClaim } from '../domain/progression/ladderRewards';
import { LadderRankIcon } from '../ui/LadderRankIcon';
import { RankingButton } from '../ui/RankingButton';
import { LeaderboardModal } from '../ui/LeaderboardModal';
import { backgroundUrl, cardFaceUrl } from '../data/assets';
import { deckSlots, deckSummary } from '../domain/progression/deckView';
import { ladderDeckOf } from '../domain/progression/deckSlots';
import { deckStrength, LADDER_TIERS, LADDER_TOP, ladderProgress, ladderScorePreview } from '../domain/progression/ladder';
import type { ProfileState } from '../domain/progression/types';
import type { ProfileStore } from '../state/createProfileStore';
import type { RouteId } from '../app/routes';
import { useSettingsStore } from '../state/settingsStore';
import { LadderCrystal } from '../rendering/ladder/LadderCrystal';
import { DesignStage } from '../ui/DesignStage';
import { PlayerStatus } from '../ui/PlayerStatus';
import '../ui/ladder.css';

export interface LadderSceneProps {
  readonly profile: ProfileState;
  readonly store: ProfileStore;
  readonly playerName?: string;
  readonly onNavigate: (route: RouteId) => void;
}

export function LadderScene({ profile, store, playerName = '当前玩家', onNavigate }: LadderSceneProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const current = snapshot.profile ?? profile;
  const still = useSettingsStore(state => state.reduceMotion);
  const deck = ladderDeckOf(current);
  const strength = deckStrength(deck?.cardIds ?? [], id => cardById.get(id)?.rarity, rarityList);
  const summary = deck ? deckSummary(deck, current.inventory) : null;
  const points = current.ladder.points;
  const progress = ladderProgress(points);
  const { tier } = progress;
  const [rankingOpen, setRankingOpen] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const claim = async (floor: number) => {
    if (pendingRef.current || snapshot.busy) return;
    pendingRef.current = true;
    setPending(floor); setMessage('');
    try {
      const result = await store.commitEconomic(latest => planLadderRewardClaim({
        profile: latest, floor, definitions: cardDatabase.definitions, operationId: store.nextOperationId(),
      }));
      if (!mounted.current) return;
      setMessage(result.ok
        ? `已领取：水晶 ×${result.view.crystals}；${result.view.cards.map(card => `${cardById.get(card.cardId)?.name ?? card.cardId} ×${card.count}`).join('、')}`
        : result.reason === 'saveFailed' ? `保存失败，奖励尚未领取：${result.message}` : result.message);
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(null);
    }
  };

  return (
    <DesignStage backgroundUrl={backgroundUrl('bg/activity_ladder')} className="ladder">
      <div className="ladder__status"><PlayerStatus level={current.level} currencies={current.currencies} /></div>
      <header className="ladder__header">
        <p>RANKED ARENA</p><h1>天梯赛</h1><span>以卡为契，逐阶登临</span>
      </header>

      <aside className="ladder__deck" aria-label="天梯出战卡组">
        <div className="ladder__section-heading"><h2>天梯出战卡组</h2><span>{deck?.cardIds.length ?? 0} / 12</span></div>
        <p className="ladder__muted">独立配置 · 不影响普通出战</p>
        <div className="ladder__cards">
          {deck && deckSlots(deck).map(slot => (
            <div key={slot.index} className={`ladder__card${slot.cardId ? '' : ' ladder__card--empty'}`}
              data-card-id={slot.cardId ?? undefined}>
              {slot.cardId ? <img src={cardFaceUrl(slot.cardId, 'thumbnail') ?? undefined}
                alt={cardById.get(slot.cardId)?.name ?? slot.cardId} draggable={false} /> : <span>{slot.index + 1}</span>}
            </div>
          ))}
        </div>
        <section className="ladder__strength" aria-label="卡组强度"
          style={{ ['--strength-color' as string]: strength.color, ['--strength-gradient' as string]: strength.gradient }}>
          <span>平均稀有度 · 卡组强度</span>
          <div><strong>{strength.average === null ? strength.label : strength.average.toFixed(2)}</strong>
            {strength.average !== null && <span> / 7 · {strength.label}</span>}</div>
          <div className="ladder__strength-track"><i style={{ width: `${(strength.average ?? 0) / 7 * 100}%` }} /></div>
          <p>按出战卡牌逐张平均，空槽不计。未来用于匹配近似强度的对手。</p>
        </section>
        {summary && summary.text.length > 0 && <p className="ladder__warning">{summary.text.join('；')}</p>}
        {strength.invalidCardIds.length > 0 && <p className="ladder__warning">存在未知卡牌或稀有度，请重新配置。</p>}
        {snapshot.deckDirty && <p className="ladder__warning">配置尚未保存，此处展示最近已保存的卡组。</p>}
      </aside>

      <main className="ladder__center" style={{ ['--rank-color' as string]: tier.color }}>
        <LadderCrystal color={tier.color} still={still} world={points >= LADDER_TOP} />
        <div className="ladder__standing" aria-live="polite">
          <p className="ladder__rank">{tier.title}</p>
          <p className="ladder__points"><strong>{points}</strong><span>段位积分</span></p>
          <p className="ladder__next">{progress.next ? `距${progress.next.title}还差 ${progress.remaining} 分` : '已达世界段位'}</p>
        </div>
        <div className="ladder__actions" aria-label="天梯模式">
          {(['solo', 'duo'] as const).map(mode => {
            const score = ladderScorePreview(points, mode);
            return (
              <div key={mode} className="ladder__action" data-mode={mode}>
                <div className="ladder__score" id={`ladder-score-${mode}`}>
                  <i>胜 +{score.win}</i><em>负 −{score.loss}</em>
                  <small>规则 −{score.ruleLoss}</small>
                </div>
                <button type="button" className="ladder__match" disabled data-mode={mode} aria-describedby={`ladder-score-${mode}`}>
                  <span className="ladder__action-title">{mode === 'solo' ? '单人匹配' : '2v2'}{mode === 'duo' && <b className="ladder__new">NEW</b>}</span>
                  <span className="ladder__closed">暂未开放</span>
                </button>
              </div>
            );
          })}
          <div className="ladder__action ladder__action--configure">
            <button type="button" className="ladder__configure" onClick={() => onNavigate('deck')}>
              <span className="ladder__action-title">配置卡组</span>
            </button>
          </div>
        </div>
        <p className="ladder__notice">积分最低至0分 · 匹配和积分结算暂未开放</p>
        <p className="ladder__reward-message" role="status">{message}</p>
      </main>

      <aside className="ladder__ranks" aria-label="段位阶梯">
        <h2>段位之路</h2>
        <p className="ladder__rank-hint">首次达标奖励 · 每档限领一次</p>
        <div className="ladder__rank-scale">
          <div className="ladder__rank-track" role="progressbar" aria-label="天梯段位进度"
            aria-valuemin={0} aria-valuemax={LADDER_TOP} aria-valuenow={progress.value}
            aria-valuetext={`${points}分，${tier.title}`}>
            <i style={{ height: `${progress.value / LADDER_TOP * 100}%`, background: tier.color }} />
            <b style={{ bottom: `${progress.value / LADDER_TOP * 100}%`, background: tier.color }} />
          </div>
          {LADDER_TIERS.map(rank => {
            const reward = LADDER_REWARDS.find(entry => entry.floor === rank.floor)!;
            const claimed = current.ladder.claimedTierFloors.includes(rank.floor);
            const available = points >= rank.floor;
            return (
              <div key={rank.floor} className="ladder__rank-step" data-current={rank.floor === tier.floor} data-floor={rank.floor}
                style={{ bottom: `${rank.floor / LADDER_TOP * 100}%`, ['--step-color' as string]: rank.color }}>
                <LadderRankIcon floor={rank.floor} color={rank.color} />
                <div className="ladder__tier-name"><strong>{rank.title}</strong>
                  <span>{rank.floor === LADDER_TOP ? '2400+' : rank.floor} 分{rank.floor === tier.floor && ' · 当前'}</span></div>
                <div className="ladder__tier-reward"><span>水晶 ×{reward.crystals}</span><span>随机 {reward.rarity} 卡 ×{reward.count}</span></div>
                <button type="button" className="ladder__claim" aria-label={`${rank.title}奖励${claimed ? '已领取' : available ? '领取' : '未达标'}`}
                  disabled={claimed || !available || pending !== null || snapshot.busy} onClick={() => { void claim(rank.floor); }}>
                  {pending === rank.floor ? '保存中' : claimed ? '已领取' : available ? '领取' : '未达标'}
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      <div className="ladder__ranking"><RankingButton onClick={() => setRankingOpen(true)} /></div>
      {rankingOpen && <LeaderboardModal profile={current} playerName={playerName} onClose={() => setRankingOpen(false)} />}
      <nav className="ladder__back" aria-label="返回菜单">
        <button className="btn" type="button" onClick={() => onNavigate('battlemenu')}>返回对战模式</button>
        <button className="btn" type="button" onClick={() => onNavigate('activity')}>活动大厅</button>
      </nav>
    </DesignStage>
  );
}
