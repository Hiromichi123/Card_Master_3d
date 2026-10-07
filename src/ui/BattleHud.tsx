import type { SideId } from '../domain/cards/types';
import type { BattleSnapshot } from '../rendering/presentation/session';
import { BattleSettings } from './BattleSettings';

/**
 * 战斗 HUD。
 *
 * 是 Canvas 之上的 DOM 覆层。**整层 `pointer-events: none`**，
 * 只有按钮和日志自己开 `auto`——否则这层会把整张战桌的点击全吃掉，
 * 牌点不动、点空白也取消不了选中（`.detail` 用的是同一套纪律）。
 */
export interface BattleHudProps {
  readonly snapshot: BattleSnapshot;
  readonly onEndTurn: () => void;
  readonly onSkipPerformance: () => void;
  readonly onAutoEnemyChange?: ((on: boolean) => void) | undefined;
  readonly onExit?: (() => void) | undefined;
  readonly onLeave?: (() => void) | undefined;
}

const SIDE_LABEL: Record<SideId, string> = { player: '我方', enemy: '敌方' };

export function BattleHud({ snapshot, onEndTurn, onSkipPerformance, onAutoEnemyChange, onExit, onLeave }: BattleHudProps) {
  return (
    <div className="hud">
      <div className="hud__top">
        <SidePanel side="enemy" snapshot={snapshot} />
        <SidePanel side="player" snapshot={snapshot} />
      </div>

      <div className="hud__turn">
        <span className="hud__turn-number">第 {snapshot.turnNumber} 回合</span>
        <span className="hud__turn-side">{turnLabel(snapshot)}</span>
      </div>

      <div className="hud__bottom">
        {/* 日志既是给玩家看的，也是浏览器用例里可读的「命中与数值一致」的证据 */}
        <ol className="hud__log">
          {snapshot.log.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ol>

        <div className="hud__actions">
          {/* 战斗中默认收成一行：战桌是主角，一排控件挡着反而看不清局面 */}
          <BattleSettings />
          {snapshot.localMultiplayer && <button type="button" className="btn"
            aria-pressed={snapshot.autoEnemy} onClick={() => onAutoEnemyChange?.(!snapshot.autoEnemy)}>
            上方 AI：{snapshot.autoEnemy ? '开' : '关'}
          </button>}
          {onExit && <button type="button" className="btn" onClick={onExit}>重新选卡</button>}
          {onLeave && <button type="button" className="btn" onClick={onLeave}>返回对战菜单</button>}
          <p
            className={alerting(snapshot) ? 'hud__hint hud__hint--alert' : 'hud__hint'}
          >
            {hintText(snapshot)}
          </p>
          <button
            type="button"
            className="btn"
            onClick={onSkipPerformance}
            disabled={snapshot.inputOpen}
          >
            跳过演出
          </button>
          <button
            type="button"
            className={canEndTurn(snapshot) ? 'btn btn--primary' : 'btn'}
            onClick={onEndTurn}
            disabled={!canEndTurn(snapshot)}
          >
            结束回合
          </button>
        </div>
      </div>
    </div>
  );
}

function SidePanel({ side, snapshot }: { side: SideId; snapshot: BattleSnapshot }) {
  const zones = snapshot.display.zones[side];
  const hp = snapshot.display.playerHp[side];
  const ratio = snapshot.baseHp > 0 ? Math.max(0, Math.min(1, hp / snapshot.baseHp)) : 0;

  return (
    <section className={`hud__side hud__side--${side}`}>
      <header className="hud__side-name">{snapshot.localMultiplayer ? (side === 'player' ? '下方' : '上方') : SIDE_LABEL[side]}</header>
      <div className="hud__hp">
        <span className="hud__hp-value">
          {hp} / {snapshot.baseHp}
        </span>
        <span className="hud__hp-track">
          <span className="hud__hp-fill" style={{ width: `${ratio * 100}%` }} />
        </span>
      </div>
      <ul className="hud__counts">
        <li>牌堆 {zones.deck.length}</li>
        <li>手牌 {zones.hand.length}</li>
        <li>弃牌 {zones.discard.length}</li>
      </ul>
    </section>
  );
}

function turnLabel(snapshot: BattleSnapshot): string {
  if (!snapshot.inputOpen) {
    return '演出中…';
  }
  if (snapshot.localMultiplayer) return snapshot.currentSide === 'player' ? '下方回合' : '上方回合';
  return snapshot.currentSide === 'player' ? '你的回合' : '敌方回合';
}

/**
 * 这回合还必须出一张牌吗。
 *
 * 旧版规则是「必须先出牌才能结束回合」，只有**无牌可出**时才允许直接过
 * （`BBS:566-568` 与 `BBS:674-683`，见 `docs/rules.md`）。
 * 所以「结束回合」按钮不能一开局就是可点的——那会让玩家点了才被拒。
 */
function mustPlayCard(snapshot: BattleSnapshot): boolean {
  return (
    snapshot.inputOpen &&
    snapshot.currentHasLegalPlay &&
    snapshot.cardsPlayedThisTurn < snapshot.cardLimit
  );
}

function canEndTurn(snapshot: BattleSnapshot): boolean {
  return (
    snapshot.inputOpen &&
    !mustPlayCard(snapshot)
  );
}

/**
 * 合法行动提示。
 *
 * `hasLegalPlay()` 是这条提示存在的原因：手上没牌、或准备区与战斗区都满了的时候，
 * 结束回合是**唯一**合法的操作，得让玩家看得出来，否则会以为游戏卡住了。
 */
function hintText(snapshot: BattleSnapshot): string {
  if (!snapshot.inputOpen) {
    return '演出中…';
  }
  if (snapshot.currentSide !== 'player' && !snapshot.localMultiplayer) {
    return '敌方行动中…';
  }
  if (snapshot.selectedInstanceId !== null) {
    return '点击高亮的准备区槽位放置';
  }
  if (!snapshot.currentHasLegalPlay) {
    return '无牌可出，只能结束回合';
  }
  if (snapshot.cardsPlayedThisTurn >= snapshot.cardLimit) {
    return '本回合已出牌，可结束回合';
  }
  return snapshot.localMultiplayer
    ? `${snapshot.currentSide === 'player' ? '下方' : '上方'}：点击自己的手牌，再点高亮准备区`
    : '本回合必须先出一张牌：点击手牌，再点准备区槽位';
}

/** 无牌可出时把提示加重——那是玩家唯一能做的操作，值得被看见。 */
function alerting(snapshot: BattleSnapshot): boolean {
  return (
    snapshot.inputOpen &&
    !snapshot.currentHasLegalPlay
  );
}
