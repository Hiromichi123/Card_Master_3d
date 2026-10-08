import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CardTipOrb } from './CardTipOrb';
import { cardById } from '../data';
import { COOLDOWN_CARD, isCooldownCard } from '../domain/battle/turnActions';
import { isSelfDestructCard } from '../domain/cards/traits';
import { describeTraitFunction } from '../domain/skills/traitDescriptions';
import { statPalette } from '../rendering/cards/statColors';
import type { CardTipTarget } from '../state/cardTipStore';
import { useSettingsStore } from '../state/settingsStore';
import { useRarityIndex } from '../state/useRarityIndex';

export function CardHoverTip({ target }: { readonly target: CardTipTarget }) {
  const rarityIndex = useRarityIndex();
  const still = useSettingsStore((state) => state.reduceMotion);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 340, height: 260 });
  const card = target.card ?? (isCooldownCard(target.cardId) ? COOLDOWN_CARD : cardById.get(target.cardId));
  const traits = useMemo(() => card?.skills.map((skill) => ({ raw: skill.raw, text: describeTraitFunction(skill) })) ?? [], [card]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      setSize((previous) => previous.width === rect.width && previous.height === rect.height
        ? previous : { width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [card]);
  if (!card) return null;
  const stats = target.stats ?? card;
  const utility = isCooldownCard(card.cardId);
  const color = rarityIndex.colorOf(card.rarity);
  const gap = 18;
  const margin = 18;
  const width = Math.min(340, Math.max(1, window.innerWidth - margin * 2));
  const onRight = target.pointer.x + gap + size.width <= window.innerWidth - margin;
  const left = Math.max(margin, Math.min(window.innerWidth - size.width - margin,
    onRight ? target.pointer.x + gap : target.pointer.x - size.width - gap));
  const preferredTop = target.pointer.y + gap + size.height <= window.innerHeight - margin
    ? target.pointer.y + gap : target.pointer.y - size.height - gap;
  const top = Math.max(margin, Math.min(preferredTop, window.innerHeight - size.height - margin));
  const style = { left, top, width, '--tip-rarity': color } as CSSProperties;
  const statuses = (target.attackStatuses ?? []).map((kind) =>
    ({ frost: '严霜', burn: '燃烧', poison: '剧毒', bleed: '流血', grievous: '重伤' })[kind]);
  if (target.unyielding) statuses.push('不屈持续中');
  if (card.rawTraits.includes('飞行') && target.flying === false) statuses.push('飞行被压制');
  return createPortal(<div ref={ref} className={`cardtip${still ? ' cardtip--still' : ''}`} style={style} role="tooltip">
    <div className="cardtip__frame"><div className="cardtip__surface">
      <div className="cardtip__flow" aria-hidden="true" />
      <div className="cardtip__trim" aria-hidden="true" />
      <div className="cardtip__content">
        <header><h4 className="cardtip__name" style={{ color }}>{card.name}</h4>
          <p className="cardtip__meta">{utility ? '本局资源 · 不占普通出牌额度' : `${card.rarity} · ${card.cardId}`}</p></header>
        {!utility && <ul className="cardtip__stats">
          {!isSelfDestructCard(card) && <><li><span>攻击</span><b style={{ color: statPalette('atk').fg }}>{stats.atk}</b></li>
            <li><span>生命</span><b style={{ color: statPalette('hp').fg }}>{stats.hp}</b></li></>}
          <li><span>冷却</span><b style={{ color: statPalette('cd').fg }}>{stats.cd}</b></li>
        </ul>}
        {statuses.length > 0 && <p className="cardtip__status">当前状态：{statuses.join(' · ')}</p>}
        {utility ? <p className="cardtip__function">指定己方等待卡冷却 −1，最低为 0；用后消耗。</p>
          : traits.length > 0 ? <ul className="cardtip__skills">{traits.map((trait, index) =>
            <li key={`${trait.raw}-${index}`}><b>{trait.raw}</b><span>{trait.text}</span></li>)}</ul>
            : <p className="cardtip__empty">没有特性</p>}
        {!utility && card.description && <p className="cardtip__desc">{card.description}</p>}
      </div>
    </div></div>
    <span className="cardtip__orb-mount" aria-hidden="true"><CardTipOrb color={color} /></span>
  </div>, document.body);
}
