import type { SideId } from '../domain/cards/types';
import type { BattleSnapshot } from '../rendering/presentation/session';
import { BattleSettings } from './BattleSettings';

export interface BattleHudProps {
  readonly snapshot: BattleSnapshot;
  readonly onEndTurn: () => void;
  readonly onChoosePriority?: ((order: 'first' | 'last') => void) | undefined;
  readonly onSkipPerformance: () => void;
  readonly onAutoEnemyChange?: ((on: boolean) => void) | undefined;
  readonly onExit?: (() => void) | undefined;
  readonly onLeave?: (() => void) | undefined;
}
const sideName = (snapshot: BattleSnapshot, side: SideId): string => snapshot.localMultiplayer
  ? (side === 'player' ? '下方' : '上方') : (side === 'player' ? '我方' : '敌方');

export function BattleHud({ snapshot, onEndTurn, onChoosePriority, onSkipPerformance, onAutoEnemyChange, onExit, onLeave }: BattleHudProps) {
  const priority = snapshot.phase === 'awaitingPriority';
  const response = snapshot.phase === 'awaitingResponse';
  const canAct = snapshot.inputOpen;
  return <div className="hud">
    <div className="hud__top">
      <SidePanel side="enemy" snapshot={snapshot} />
      <SidePanel side="player" snapshot={snapshot} />
    </div>
    <div className="hud__turn">
      <span className="hud__turn-number">第 {snapshot.turnNumber} 轮</span>
      <span className="hud__turn-side">{sideName(snapshot, snapshot.currentSide)}主场 · {sideName(snapshot, snapshot.startingSide)}开局先手</span>
      <span>{!canAct ? '演出 / AI 行动中…' : priority ? '选择行动顺序' : response ? `${sideName(snapshot, snapshot.inputSide)}客场部署` : '出牌与部署'}</span>
    </div>
    <div className="hud__bottom">
      <ol className="hud__log">{snapshot.log.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol>
      <div className="hud__actions">
        <BattleSettings />
        {snapshot.localMultiplayer && <button type="button" className="btn" aria-pressed={snapshot.autoEnemy}
          onClick={() => onAutoEnemyChange?.(!snapshot.autoEnemy)}>上方 AI：{snapshot.autoEnemy ? '开' : '关'}</button>}
        {onExit && <button type="button" className="btn" onClick={onExit}>重新选卡</button>}
        {onLeave && <button type="button" className="btn" onClick={onLeave}>返回对战菜单</button>}
        <p className="hud__hint">{hintText(snapshot)}</p>
        <button type="button" className="btn" onClick={onSkipPerformance} disabled={canAct}>跳过演出</button>
        {priority ? <>
          <button type="button" className="btn btn--primary" disabled={!canAct} onClick={() => onChoosePriority?.('first')}>先手 · 我方先行动</button>
          <button type="button" className="btn" disabled={!canAct} onClick={() => onChoosePriority?.('last')}>后手 · 对方先部署</button>
        </> : <button type="button" className="btn btn--primary" disabled={!canAct} onClick={onEndTurn}>
          {response ? '完成部署 / 不上场' : snapshot.cardsPlayedThisTurn === 0 ? '跳过出牌 · 获得冷却牌' : '结束行动 · 战斗结算'}
        </button>}
      </div>
    </div>
  </div>;
}

function hintText(snapshot: BattleSnapshot): string {
  if (!snapshot.inputOpen) return '演出 / AI 行动中…';
  if (snapshot.phase === 'awaitingPriority') return '对方有成熟卡：决定其部署在我方攻击之前还是之后';
  if (snapshot.selectedKind === 'cooldown') return '点击己方等待区中 CD > 0 的卡：冷却 −1，不占出牌额度';
  if (snapshot.selectedKind === 'ready' && snapshot.playableBattleSlots.length === 0) return '战斗区已满，成熟卡保留在等待区';
  if (snapshot.selectedKind === 'ready') return '拖到队列中插入；放回等待区取消。也可点击高亮战斗槽';
  if (snapshot.selectedKind === 'hand') return '点击高亮等待槽出牌';
  if (snapshot.phase === 'awaitingResponse') return '客场只可部署金边成熟卡；不上场也可直接完成';
  return `普通出牌 ${snapshot.cardsPlayedThisTurn}/${snapshot.cardLimit} · 金边卡可不限张部署 · 不出普通牌可领取冷却牌`;
}

function SidePanel({ side, snapshot }: { side: SideId; snapshot: BattleSnapshot }) {
  const zones = snapshot.display.zones[side];
  const hp = snapshot.display.playerHp[side];
  const ratio = snapshot.baseHp > 0 ? Math.max(0, Math.min(1, hp / snapshot.baseHp)) : 0;
  return <section className={`hud__side hud__side--${side}`}>
    <header className="hud__side-name">{sideName(snapshot, side)}</header>
    <div className="hud__hp"><span className="hud__hp-value">{hp} / {snapshot.baseHp}</span>
      <span className="hud__hp-track"><span className="hud__hp-fill" style={{ width: `${ratio * 100}%` }} /></span></div>
    <ul className="hud__counts"><li>牌堆 {zones.deck.length}</li><li>手牌 {zones.hand.length}</li><li>弃牌 {zones.discard.length}</li></ul>
  </section>;
}
