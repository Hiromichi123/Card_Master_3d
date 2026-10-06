import { uiIconUrl } from '../data/assets';
import type { Currencies } from '../domain/progression/types';

/**
 * 三种货币。
 *
 * 名字照旧版：金币 / 水晶 / 徽章。徽章是活动商店用的，
 * 所以常规玩法里它常常是 0——仍然显示，免得玩家拿到徽章时不知道该去哪花。
 */

const LABELS: { key: keyof Currencies; label: string; icon: string }[] = [
  { key: 'gold', label: '金币', icon: 'gold' },
  { key: 'crystal', label: '水晶', icon: 'crystal' },
  { key: 'badge', label: '徽章', icon: 'badge' },
];

export function CurrencyBar({ currencies }: { currencies: Currencies }) {
  return (
    <div className="currency" aria-label="货币">
      {LABELS.map((entry) => {
        const icon = uiIconUrl(entry.icon);
        return (
          <span key={entry.key} className={`currency__item currency__item--${entry.key}`}>
            {icon ? (
              <img className="currency__icon" src={icon} alt="" />
            ) : (
              <span className="currency__dot" aria-hidden="true" />
            )}
            <span className="currency__value">{currencies[entry.key]}</span>
            <span className="currency__label">{entry.label}</span>
          </span>
        );
      })}
    </div>
  );
}
