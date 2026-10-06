import { cardById } from '../data';

/**
 * 开局的菜单。
 *
 * 是画布之上的一层覆层，**画布背后照常渲染开局局面**——这样「菜单 → 对局」
 * 的仪式感有了，又不会把既有的台面/相机浏览器用例打掉（它们点进「战斗场景」
 * 就期望看到战桌）。
 *
 * 标题与我方牌组由调用方给：演示战斗给「演示战斗」+ 切片牌组，
 * 战役给关卡名 + 玩家当前的出战卡组（早先这里写死了演示那一套）。
 */
export interface BattleMenuProps {
  /** 这一局的标题：演示战斗是「演示战斗」，战役是关卡名。 */
  readonly label: string;
  /** 我方牌组（战役用的是玩家当前的出战卡组）。 */
  readonly playerDeck: readonly string[];
  readonly autoPlayer: boolean;
  readonly onAutoPlayerChange: (on: boolean) => void;
  readonly onStart: () => void;
}

export function BattleMenu({
  label,
  playerDeck,
  autoPlayer,
  onAutoPlayerChange,
  onStart,
}: BattleMenuProps) {

  return (
    <div className="overlay">
      <div className="overlay__panel">
        <h1 className="overlay__title">{label}</h1>
        <p className="overlay__reason">
          固定牌组对 AI，固定随机种子。同一局无论看几遍，结果都一样。
        </p>

        <section className="overlay__deck">
          <h2 className="overlay__deck-title">我方牌组 · {playerDeck.length} 张</h2>
          <ul className="overlay__deck-list">
            {playerDeck.map((cardId, index) => (
              <li key={`${cardId}-${index}`}>{cardById.get(cardId)?.name ?? cardId}</li>
            ))}
          </ul>
        </section>

        <label className="overlay__toggle">
          <input
            type="checkbox"
            checked={autoPlayer}
            onChange={(event) => onAutoPlayerChange(event.target.checked)}
          />
          自动演示（双方都由 AI 出牌，用来快速看完一整局）
        </label>

        <div className="overlay__actions">
          <button type="button" className="btn btn--primary" onClick={onStart}>
            开始对局
          </button>
        </div>
      </div>
    </div>
  );
}
