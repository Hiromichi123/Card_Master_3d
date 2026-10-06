import { useEffect, useState } from 'react';

import { cardById } from '../data';
import { cardFaceUrl } from '../data/assets';
import { useRarityIndex } from '../state/useRarityIndex';

/**
 * 图鉴/组卡/商店共用的小卡格。
 *
 * 整张卡面用 **thumbnail 档**加载（384 长边），不是战斗用的高清档——
 * PLAN 第 5 节要求图鉴分页/按可见区域加载缩略图，一屏几十张走高清档会直接
 * 把纹理预算打爆。
 *
 * **兜底分两层，两层都要有**：
 * 1. `cardFaceUrl` 返回 `null`（manifest 里没有这张卡）；
 * 2. URL 有、但文件 404——`<img onError>`。
 * 只做第一层的话，一个生成的 URL 与实际文件不一致，图鉴里就是一片裂图，
 * 而类型检查、构建、单测全都不会报。
 *
 * 兜底底板用**该卡自己的稀有度配色**（来自 `rarities.json`），
 * 于是缺图的那张卡至少还看得出稀有度与名字。
 */

export type TileSize = 'sm' | 'md' | 'lg';

export interface CardTileProps {
  readonly cardId: string;
  readonly count?: number | undefined;
  readonly size?: TileSize | undefined;
  readonly selected?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** 右下角的补充说明（组卡里显示「已上阵」）。 */
  readonly note?: string | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly onHover?: ((hovered: boolean) => void) | undefined;
}

export function CardTile({
  cardId,
  count,
  size = 'md',
  selected,
  disabled,
  note,
  onClick,
  onHover,
}: CardTileProps) {
  const card = cardById.get(cardId);
  const rarityIndex = useRarityIndex();
  const url = cardFaceUrl(cardId, 'thumbnail');

  // 换卡时要重新判断一次——否则上一张的失败状态会跟过来
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [url]);

  const rarity = card?.rarity ?? '';
  const showFallback = !url || broken;

  const classes = [
    'tile',
    `tile--${size}`,
    showFallback ? 'tile--fallback' : '',
    selected ? 'tile--selected' : '',
    disabled ? 'tile--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const body = (
    <>
      {showFallback ? (
        <span
          className="tile__plate"
          style={{ background: rarityIndex.colorOf(rarity) }}
          aria-hidden="true"
        >
          <span className="tile__rarity">{rarity || '?'}</span>
          {card && <span className="tile__name">{card.name}</span>}
        </span>
      ) : (
        <img
          className="tile__art"
          src={url}
          alt={card?.name ?? cardId}
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
        />
      )}

      {count !== undefined && count > 1 && <span className="tile__badge">×{count}</span>}
      {note && <span className="tile__note">{note}</span>}
    </>
  );

  if (!onClick) {
    return (
      <div
        className={classes}
        onMouseEnter={() => onHover?.(true)}
        onMouseLeave={() => onHover?.(false)}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      title={card ? `${card.name}（${rarity}）` : cardId}
    >
      {body}
    </button>
  );
}
