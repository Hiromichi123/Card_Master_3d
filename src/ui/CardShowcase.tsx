import { useEffect, useRef } from 'react';

import { cardById } from '../data';
import { cardFaceUrl } from '../data/assets';
import { foilForRarity } from '../rendering/cards/foilModel';
import { useRarityIndex } from '../state/useRarityIndex';
import { useFoilPointer } from './useFoilPointer';

/**
 * 卡牌展示位。
 *
 * 点开一张卡之后，背景压暗、卡牌放大到屏幕正中，按**实体卡**来呈现：
 * 有厚度与边缘高光、跟着指针倒、箔片的反光和眩光跟着指针走。
 *
 * **箔片只在这一处出现。** 网格里的缩略图是纯图片——一屏几十张同时闪
 * 既吵又费合成，而且缩略图尺寸下条纹根本读不出来（`V-HOLO-4`：
 * 箔片只在战斗卡面与展示位使用）。
 *
 * 检视的映射与 3D 卡的着色器共用 `foilModel`：这边指针在卡面上走，
 * 那边相机绕着卡转，两边拿到的是同一个 `FoilView`。
 */
export interface CardShowcaseProps {
  readonly cardId: string;
  readonly onClose: () => void;
}

export function CardShowcase({ cardId, onClose }: CardShowcaseProps) {
  const card = cardById.get(cardId);
  const rarityIndex = useRarityIndex();
  const cardRef = useRef<HTMLDivElement | null>(null);

  const rarity = card?.rarity ?? 'D';
  const rarityColor = rarityIndex.colorOf(rarity);
  const foil = foilForRarity(rarity, rarityColor);
  const hasFoil = foil.kind !== 'none';

  useFoilPointer(cardRef, hasFoil);

  // Esc 关闭。展示位盖住了整页，没有键盘出口会很难受
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!card) {
    return null;
  }

  // 大图用 detail 档：这一处是玩家唯一会盯着看的画面，
  // 用缩略图会糊（纹理预算上只看一张，代价可以接受）
  const url = cardFaceUrl(cardId, 'detail') ?? cardFaceUrl(cardId, 'battle');

  /*
    色带配色**内联**而不是写成 CSS 类：每个稀有度的代表色都不同，
    为 13 个稀有度各写一个类是没必要的重复。
    色值来自 `rarities.json`，与卡牌外圈光晕同源。
  */
  const foilStyle = {
    ['--foil-strength' as string]: foil.strength,
    ['--foil-density' as string]: foil.geometry.density,
    ['--foil-scan' as string]: foil.geometry.scanlines,
    ['--foil-c1' as string]: foil.palette[0],
    ['--foil-c2' as string]: foil.palette[1],
    ['--foil-c3' as string]: foil.palette[2],
    ['--foil-c4' as string]: foil.palette[3],
    ['--foil-c5' as string]: foil.palette[4],
    ['--foil-c6' as string]: foil.palette[5],
  };

  return (
    <div
      className="showcase"
      role="dialog"
      aria-label={`${card.name} 展示`}
      onClick={(event) => {
        // 点背景关闭；点卡片本身不关
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="showcase__inner">
        <div className="showcase__stage">
          <div ref={cardRef} className="showcase__card">
            {url ? (
              <img className="showcase__art" src={url} alt={card.name} draggable={false} />
            ) : (
              <span
                className="tile__plate"
                style={{ background: rarityIndex.colorOf(rarity) }}
                aria-hidden="true"
              >
                <span className="tile__rarity">{rarity}</span>
                <span className="tile__name">{card.name}</span>
              </span>
            )}

            {hasFoil && (
              <span className={`foil foil--${foil.kind}`} style={foilStyle} aria-hidden="true" />
            )}

            {/* 边缘高光与内描边：读起来像有厚度的成品卡，而不是一张图片 */}
            <span className="showcase__edge" aria-hidden="true" />
          </div>
        </div>

        <div className="showcase__info">
          <h2 className="showcase__name">{card.name}</h2>
          <p className="showcase__meta">
            {card.cardId} · {rarity}
          </p>
          <ul className="showcase__stats">
            <li>
              <b>{card.atk}</b>攻击
            </li>
            <li>
              <b>{card.hp}</b>生命
            </li>
            <li>
              <b>{card.cd}</b>冷却
            </li>
          </ul>
          <p className="showcase__meta">{card.rawTraits.join('、') || '没有特性'}</p>
          <p>{card.description}</p>
          <button type="button" className="btn showcase__close" onClick={onClose}>
            关闭（Esc）
          </button>
        </div>
      </div>
    </div>
  );
}
