import { cardById } from '../data';
import { slice } from '../data';
import { DEMO_PLAYER_DECK } from '../rendering/presentation/demoBattle';

/**
 * 开局的菜单。
 *
 * 是画布之上的一层覆层，**画布背后照常渲染开局局面**——这样「菜单 → 对局」
 * 的仪式感有了，又不会把既有的台面/相机浏览器用例打掉（它们点进「战斗场景」
 * 就期望看到战桌）。
 */
export interface BattleMenuProps {
  readonly autoPlayer: boolean;
  readonly onAutoPlayerChange: (on: boolean) => void;
  readonly onStart: () => void;
}

export function BattleMenu({ autoPlayer, onAutoPlayerChange, onStart }: BattleMenuProps) {
  const deck = slice.decks.find((entry) => entry.id === 'demo-player');

  return (
    <div className="overlay">
      <div className="overlay__panel">
        <h1 className="overlay__title">演示战斗</h1>
        <p className="overlay__reason">
          固定牌组对 AI，固定随机种子。同一局无论看几遍，结果都一样。
        </p>

        <section className="overlay__deck">
          <h2 className="overlay__deck-title">
            我方牌组{deck ? ` · ${deck.name}` : ''}
          </h2>
          <ul className="overlay__deck-list">
            {DEMO_PLAYER_DECK.map((cardId, index) => (
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
