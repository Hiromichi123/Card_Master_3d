import { createPortal } from 'react-dom';

import { cardById } from '../data';
import { statPalette } from '../rendering/cards/statColors';
import { useRarityIndex } from '../state/useRarityIndex';

/**
 * 悬停详情框。
 *
 * 照旧版 `ui/tooltip.py`：鼠标停在卡上弹一块卡片详情（名称、数值、特性、说明），
 * 移开就收起来。**跟着卡片走**——位置由调用方给的那块矩形算出来，
 * 贴在卡右边；右边放不下就翻到左边（旧版也是先右后左）。
 *
 * 数值配色与展示位、战斗徽标同一份（`statColors.ts` 的红 / 绿 / 蓝），
 * 名称用该卡稀有度的代表色。
 *
 * 用坐标 + `position: fixed` 而不是「跟着鼠标」：跟着鼠标时，鼠标一动框就动，
 * 反而看不清；贴在卡边上稳定得多。
 *
 * **挂到 `document.body` 上（portal）。** 页面上只要有任何一个祖先带了
 * `transform` / `filter` / `will-change`，`position: fixed` 就会改成相对那个祖先定位——
 * 实测框整整偏了 888px（贴在屏幕外）。portal 一刀切掉这一类问题。
 */
/** 被悬停元素的位置快照（`getBoundingClientRect()` 里要用的那几项）。 */
export interface TipRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface CardHoverTipProps {
  readonly cardId: string;
  readonly rect: TipRect;
}

/**
 * 提示框的估算尺寸——必须与 CSS 里 `.cardtip` 的 `width` / `max-height` 对得上，
 * 否则「夹在视口内」这一步会算漏（第一版按 340 夹、CSS 却是 360，贴在下方的卡上就溢出了）。
 */
const TIP_WIDTH = 280;
const TIP_MAX_HEIGHT = 360;

export function CardHoverTip({ cardId, rect }: CardHoverTipProps) {
  const rarityIndex = useRarityIndex();
  const card = cardById.get(cardId);
  if (!card) {
    return null;
  }

  // 先放右边；右边不够宽就翻到左边；上下夹住，别跑出视口
  const onRight = rect.right + TIP_WIDTH + 16 <= window.innerWidth;
  const left = onRight ? rect.right + 12 : Math.max(12, rect.left - TIP_WIDTH - 12);
  const top = Math.min(
    Math.max(rect.top - 24, 12),
    Math.max(12, window.innerHeight - TIP_MAX_HEIGHT - 12),
  );

  return createPortal(
    <div className="cardtip" style={{ left, top, width: TIP_WIDTH }} role="tooltip">
      <h4 className="cardtip__name" style={{ color: rarityIndex.colorOf(card.rarity) }}>
        {card.name}
      </h4>
      <p className="cardtip__meta">
        {card.cardId} · {card.rarity}
      </p>
      <ul className="cardtip__stats">
        <li>
          <b style={{ color: statPalette('atk').fg }}>{card.atk}</b>攻击
        </li>
        <li>
          <b style={{ color: statPalette('hp').fg }}>{card.hp}</b>生命
        </li>
        <li>
          <b style={{ color: statPalette('cd').fg }}>{card.cd}</b>冷却
        </li>
      </ul>
      <p className="cardtip__traits">{card.rawTraits.join('、') || '没有特性'}</p>
      <p className="cardtip__desc">{card.description}</p>
    </div>,
    document.body,
  );
}
