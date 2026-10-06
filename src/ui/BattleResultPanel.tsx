import type { BattleOutcome } from '../domain/battle/types';
import type { SettlementView } from '../domain/progression/campaign';

/**
 * 胜负页。
 *
 * 覆盖在战斗画面上，不做场景切换——切场景会把 Canvas 卸载重挂，
 * 战桌要重新生成程序化贴图，反而更慢也更容易出问题。
 */
export interface BattleResultPanelProps {
  readonly outcome: BattleOutcome;
  readonly playerHp: number;
  readonly enemyHp: number;
  /** 战役的关卡结算（奖励明细）。演示战斗没有。 */
  readonly settlement?: SettlementView | null;
  /** 「返回」按钮上的字（战役里是「返回战役」）。 */
  readonly backLabel?: string;
  readonly onRematch: () => void;
  readonly onBackToMenu: () => void;
}

const REASON_LABEL: Record<string, string> = {
  hpDepleted: '本体生命归零',
  noCardsRemaining: '双方都无牌可出',
  turnLimit: '达到回合上限',
  stateRepeated: '局面重复，无法推进',
  simultaneous: '双方同时倒下',
};

export function BattleResultPanel({
  outcome,
  playerHp,
  enemyHp,
  settlement,
  backLabel = '返回菜单',
  onRematch,
  onBackToMenu,
}: BattleResultPanelProps) {
  const verdict =
    outcome.kind === 'draw' ? '平局' : outcome.winner === 'player' ? '胜利' : '失败';

  return (
    <div className="overlay">
      <div className="overlay__panel">
        <h1
          className={
            outcome.kind === 'draw'
              ? 'overlay__title'
              : outcome.winner === 'player'
                ? 'overlay__title overlay__title--win'
                : 'overlay__title overlay__title--lose'
          }
        >
          {verdict}
        </h1>
        <p className="overlay__reason">{REASON_LABEL[outcome.reason] ?? outcome.reason}</p>
        <p className="overlay__score">
          最终生命 我方 {playerHp} : {enemyHp} 敌方
        </p>
        {settlement ? (
          /*
            战役的关卡奖励。**这里显示的就是已经落盘的那一份**
            （`App` 在进入结果态时提交了事务，拿到视图才传进来），
            所以「完成了哪些目标、掉了哪张卡」与存档里的进度是同一件事。
          */
          <ul className="settlement" data-testid="settlement">
            <li className="settlement__title">本关奖励</li>
            {settlement.lines.map((line) => (
              <li key={line} className="settlement__line">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          /* 演示战斗与存档无关，明说没有奖励，不伪造一个存档接口 */
          <p className="overlay__note">（演示）本局奖励：无</p>
        )}

        <div className="overlay__actions">
          <button type="button" className="btn btn--primary" onClick={onRematch}>
            再来一局
          </button>
          <button type="button" className="btn" onClick={onBackToMenu}>
            {backLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
