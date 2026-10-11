import { useEffect } from 'react';
import type { CardDefinition } from '../domain/cards/types';
import { cardFaceUrlForDefinition } from '../data/assets';
import { hideCardTip, showCardTip, moveCardTip } from '../state/cardTipStore';

/** 深渊卡面的烘焙文字不作权威数值；下方面板始终展示本轮定义。 */
export function AbyssCard({ card, selected = false, onSelect, disabled = false, label = '本轮培养' }: {
  readonly card: CardDefinition;
  readonly selected?: boolean;
  readonly onSelect?: (() => void) | undefined;
  readonly disabled?: boolean;
  readonly label?: string;
}) {
  const ownerKey = `abyss-card:${card.cardId}`;
  useEffect(() => () => hideCardTip(ownerKey), [ownerKey]);
  const image = cardFaceUrlForDefinition(card, 'battle');
  const content = <>
    <div className="abyss-card__image">{image ? <img src={image} alt="" loading="lazy" draggable={false} /> : <span>{card.rarity}</span>}</div>
    <div className="abyss-card__copy"><small>{card.rarity} · {label}</small><strong>{card.name}</strong>
      <div className="abyss-card__stats"><b>ATK {card.atk}</b><b>HP {card.hp}</b><b>CD {card.cd}</b></div>
      <p>{card.rawTraits.join(' · ') || '无特性'}</p>
    </div>
  </>;
  const tip = (element: HTMLElement) => showCardTip(card.cardId, element.getBoundingClientRect(), { card, ownerKey, ownerElement: element });
  return onSelect ? <button type="button" className="abyss-card" data-selected={selected} disabled={disabled}
    aria-label={`选择${card.name}，攻击${card.atk}，生命${card.hp}，冷却${card.cd}`} aria-pressed={selected}
    onClick={onSelect} onPointerEnter={event => tip(event.currentTarget)} onPointerMove={event => moveCardTip(event.clientX, event.clientY)}
    onPointerLeave={() => hideCardTip(ownerKey)} onFocus={event => tip(event.currentTarget)} onBlur={() => hideCardTip(ownerKey)}>{content}</button>
    : <article className="abyss-card" tabIndex={0} onPointerEnter={event => tip(event.currentTarget)}
      onPointerMove={event => moveCardTip(event.clientX, event.clientY)} onPointerLeave={() => hideCardTip(ownerKey)}
      onFocus={event => tip(event.currentTarget)} onBlur={() => hideCardTip(ownerKey)}>{content}</article>;
}
