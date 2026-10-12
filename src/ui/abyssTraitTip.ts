import { ABYSS_GRADE_INFO } from '../domain/progression/abyssGrades';
import type { CardTipDetails } from '../state/cardTipStore';
import type { AbyssTraitItem } from './AbyssTraitCards';

/** Effect cards carry their own description; they are not fabricated ordinary card definitions. */
export function abyssTraitTip(item: AbyssTraitItem): CardTipDetails {
  if (item.card) return { card: item.card, theme: 'abyss' };
  const grade = ABYSS_GRADE_INFO[item.grade ?? 'purple'];
  const polarity = item.tone === 'positive' ? '正面契约' : item.tone === 'negative' ? '绑定负面契约' : '深渊加成';
  return { theme: 'abyss', effect: { name: item.name, description: item.description, color: grade.color,
    meta: `${grade.name}${item.level ? ` · ${item.level}级` : ''} · ${polarity}`,
    footer: item.footer ?? (item.tone === 'growth' ? '选择加成，再拖动或点击己方目标卡牌' : '仅在本场战斗生效') } };
}
