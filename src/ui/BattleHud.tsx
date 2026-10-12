import { AiDebugPanel } from './AiDebugPanel';
import type { SideId } from '../domain/cards/types';
import type { BattleSnapshot } from '../rendering/presentation/session';
import { BattleSettings } from './BattleSettings';

export interface BattleHudProps {
  readonly snapshot: BattleSnapshot;
  readonly onEndTurn: () => void;
  readonly onConcede?: ((side: SideId) => void) | undefined;
  readonly onSkipPerformance: () => void;
  readonly onAutoEnemyChange?: ((on: boolean) => void) | undefined;
  readonly onExit?: (() => void) | undefined;
  readonly onLeave?: (() => void) | undefined;
  readonly leaveLabel?: string | undefined;
  readonly exitDisabled?: boolean | undefined;
}
const sideName = (snapshot: BattleSnapshot, side: SideId): string => snapshot.localMultiplayer
  ? (side === 'player' ? '下方' : '上方') : (side === 'player' ? '我方' : '敌方');

export function BattleHud({ snapshot, onEndTurn, onConcede, onSkipPerformance, onAutoEnemyChange, onExit, onLeave,
  leaveLabel = '返回对战菜单', exitDisabled = false }: BattleHudProps) {
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
      <span>{snapshot.autoEvolutionActive ? `残局自动演进 · ${snapshot.autoEvolutionTurns}/${snapshot.autoEvolutionLimit} 回合` : !canAct ? '演出 / AI 行动中…' : response ? `${sideName(snapshot, snapshot.inputSide)}客场部署` : '出牌与部署'}</span>
    </div>
    <div className="hud__bottom">
      {/*
        日志**不上屏**：每一条事件都同时是画面上的演出（伤害数字、粒子、血条），
        再抄一份文字反而在牌桌边上压出一块读不过来的长条。
        它还留在 DOM 里、并且保持「可渲染」——浏览器用例
        （`tests/browser/battleSlice.spec.ts`）读它当「画面与数值变化一致」的证据，
        裁剪方式见 global.css 的 `.hud__log`。
      */}
      <ol className="hud__log">{snapshot.log.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol>
      <div className="hud__actions">
        <BattleSettings />
        <AiDebugPanel snapshot={snapshot} />
        {onConcede && <button type="button" className="btn" disabled={exitDisabled || !!snapshot.outcome}
          title="立即认输并按失败结算" onClick={() => onConcede('player')}>
          {snapshot.localMultiplayer ? '下方认输' : '认输'}
        </button>}
        {onConcede && snapshot.localMultiplayer && !snapshot.autoEnemy && <button type="button" className="btn"
          disabled={exitDisabled || !!snapshot.outcome} title="上方玩家立即认输" onClick={() => onConcede('enemy')}>上方认输</button>}
        {snapshot.localMultiplayer && <button type="button" className="btn" aria-pressed={snapshot.autoEnemy}
          onClick={() => onAutoEnemyChange?.(!snapshot.autoEnemy)}>上方 AI：{snapshot.autoEnemy ? '开' : '关'}</button>}
        {onExit && <button type="button" className="btn" disabled={exitDisabled} onClick={onExit}>重新选卡</button>}
        {onLeave && <button type="button" className="btn" disabled={exitDisabled} onClick={onLeave}>{leaveLabel}</button>}
        <p className="hud__hint">{hintText(snapshot)}</p>
        <button type="button" className="btn" onClick={onSkipPerformance} disabled={canAct}>跳过演出</button>
      </div>
    </div>
    {/*
      回合推进按钮：底层中央，不和上面那列辅助操作混在一起。
      「第 N 轮」在顶层中央、推进键在底层中央——这两件每次都要用的东西
      成一根轴线，其余的信息与开关退到两侧。
    */}
    {!snapshot.autoTurnEndPending && <div className="hud__advance">
      {snapshot.autoEvolutionActive ? <button type="button" className="btn btn--primary" disabled>
        自动演进 {snapshot.autoEvolutionTurns}/{snapshot.autoEvolutionLimit}
      </button> : <button type="button" className="btn btn--primary" disabled={!canAct} onClick={onEndTurn}>
        {response ? '完成部署 / 不上场' : snapshot.cardsPlayedThisTurn === 0 ? '跳过出牌 · 获得冷却牌' : '结束行动 · 战斗结算'}
      </button>}
    </div>}
  </div>;
}

function hintText(snapshot: BattleSnapshot): string {
  if (snapshot.autoEvolutionActive) return `自动交替行动；${snapshot.autoEvolutionLimit} 次后按本体生命判定，出现普通手牌或等待卡则恢复操作`;
  if (!snapshot.inputOpen) return '演出 / AI 行动中…';
  if (snapshot.autoTurnEndPending) return '暂无可用操作，1秒后自动完成部署与行动';
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
  const baseHp = snapshot.baseHpBySide?.[side] ?? snapshot.baseHp;
  const ratio = baseHp > 0 ? Math.max(0, Math.min(1, hp / baseHp)) : 0;
  return <section className={`hud__side hud__side--${side}`}>
    <header className="hud__side-name">{sideName(snapshot, side)}</header>
    <div className="hud__hp"><span className="hud__hp-value">{hp} / {baseHp}</span>
      <span className="hud__hp-track"><span className="hud__hp-fill" style={{ width: `${ratio * 100}%` }} /></span></div>
    <ul className="hud__counts"><li>牌堆 {zones.deck.length}</li><li>手牌 {zones.hand.length}</li><li>弃牌 {zones.discard.length}</li></ul>
  </section>;
}
