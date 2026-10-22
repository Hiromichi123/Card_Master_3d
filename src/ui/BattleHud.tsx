import { useEffect, useState } from 'react';
import { adminAiEnabled } from '../state/adminAiStore';
import './battlePauseMenu.css';
import { AiDebugPanel } from './AiDebugPanel';
import type { SideId } from '../domain/cards/types';
import type { BattleSnapshot } from '../rendering/presentation/session';
import { BattleSettings } from './BattleSettings';

export interface BattleHudProps {
  readonly snapshot: BattleSnapshot;
  readonly hideSidePanels?: boolean;
  readonly onRetry?: (() => void | Promise<void>) | undefined;
  readonly onPauseChange?: ((paused: boolean) => void) | undefined;
  readonly onQuit?: (() => void | Promise<void>) | undefined;
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

export function BattleHud({ snapshot, onEndTurn, onConcede, onAutoEnemyChange,
   exitDisabled = false, hideSidePanels = false, onRetry, onPauseChange, onQuit }: BattleHudProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [working, setWorking] = useState(false), [error, setError] = useState('');
  useEffect(() => { onPauseChange?.(menuOpen); return () => onPauseChange?.(false); }, [menuOpen, onPauseChange]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || working) return;
      if (!menuOpen && document.querySelector('dialog[open], [role="dialog"]')) return;
      event.preventDefault(); event.stopImmediatePropagation(); setMenuOpen(open => !open);
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [menuOpen, working]);
  const perform = async (action: (() => void | Promise<void>) | undefined) => {
    if (!action || working || exitDisabled) return;
    setWorking(true); setError(''); onPauseChange?.(false);
    try { await action(); setMenuOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试'); onPauseChange?.(true); }
    finally { setWorking(false); }
  };
  const response = snapshot.phase === 'awaitingResponse';
  const canAct = snapshot.inputOpen;
  return <div className="hud">
    {/* Keep both flex children: the original HUD uses space-between to anchor actions at the bottom. */}
    <div className="hud__top">
      {!hideSidePanels && <>
        <SidePanel side="enemy" snapshot={snapshot} />
        <SidePanel side="player" snapshot={snapshot} />
      </>}
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
        <button type="button" className="btn" aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>Esc 呼出菜单</button>
      </div>
    </div>
    {menuOpen && <div className="battle-pause-menu" role="dialog" aria-modal="true" aria-label="对局菜单">
      <section className="battle-pause-menu__panel">
        <h2>对局菜单</h2>
        <BattleSettings embedded columns={2} />
        {adminAiEnabled() && <AiDebugPanel snapshot={snapshot} />}
        {snapshot.localMultiplayer && <label><input type="checkbox" checked={snapshot.autoEnemy}
          onChange={event => onAutoEnemyChange?.(event.target.checked)} />上方由 AI 操作</label>}
        <p className="hud__hint">{hintText(snapshot)}</p>
        {error && <p role="alert">{error}</p>}
        <div className="battle-pause-menu__actions">
          <button type="button" className="btn btn--primary" disabled={working} autoFocus onClick={() => setMenuOpen(false)}>继续对战</button>
          <button type="button" className="btn" disabled={working || exitDisabled || !onRetry} onClick={() => void perform(onRetry)}>再试一次</button>
          <button type="button" className="btn battle-pause-menu__quit" disabled={working || exitDisabled}
            title="退出本局并按失败结算" onClick={() => void perform(onQuit ?? (() => onConcede?.('player')))}>退出</button>
        </div>
      </section>
    </div>}
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
  return <section className={`hud__side hud__side--${side}`}>
    <header className="hud__side-name">{sideName(snapshot, side)}</header>
    <ul className="hud__counts"><li>牌堆 {zones.deck.length}</li><li>手牌 {zones.hand.length}</li><li>弃牌 {zones.discard.length}</li></ul>
  </section>;
}
