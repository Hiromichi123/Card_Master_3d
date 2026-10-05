import type { BattleOutcome } from '../domain/battle/types';

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
        {/* 存档与奖励是 P5 的范围，这里明确说没有，不伪造一个存档接口 */}
        <p className="overlay__note">（演示）本局奖励：无</p>

        <div className="overlay__actions">
          <button type="button" className="btn btn--primary" onClick={onRematch}>
            再来一局
          </button>
          <button type="button" className="btn" onClick={onBackToMenu}>
            返回菜单
          </button>
        </div>
      </div>
    </div>
  );
}
