import type { RarityEntryLike } from './rarityIndex';

export interface LadderTier {
  readonly floor: number;
  readonly title: string;
  readonly color: string;
  readonly win: number;
  readonly loss: number;
}

/** 当前仅用于预览；匹配和真实积分结算尚未开放。 */
export const LADDER_TIERS: readonly LadderTier[] = [
  { floor: 0, title: '新手卡牌师', color: '#c8d8e5', win: 30, loss: 5 },
  { floor: 300, title: '战斗卡牌师', color: '#69d9a0', win: 28, loss: 7 },
  { floor: 600, title: '精英卡牌师', color: '#46cedc', win: 25, loss: 10 },
  { floor: 900, title: '高阶卡牌师', color: '#598aff', win: 23, loss: 12 },
  { floor: 1200, title: '史诗卡牌师', color: '#b77bff', win: 20, loss: 15 },
  { floor: 1500, title: '圣域卡牌师', color: '#edcf74', win: 18, loss: 18 },
  { floor: 1800, title: '传奇卡牌师', color: '#ff8856', win: 15, loss: 20 },
  { floor: 2100, title: '深渊卡牌师', color: '#9b5dda', win: 12, loss: 23 },
  { floor: 2400, title: '世界卡牌师', color: '#fff0ae', win: 10, loss: 25 },
];
export const LADDER_TOP = 2400;

export function ladderTier(points: number): LadderTier {
  return [...LADDER_TIERS].reverse().find(tier => points >= tier.floor) ?? LADDER_TIERS[0]!;
}

export function ladderProgress(points: number) {
  const tier = ladderTier(points);
  const next = LADDER_TIERS[LADDER_TIERS.indexOf(tier) + 1] ?? null;
  return { tier, next, remaining: next ? Math.max(0, next.floor - points) : 0,
    value: Math.max(0, Math.min(LADDER_TOP, points)) };
}

export function ladderScorePreview(points: number, mode: 'solo' | 'duo') {
  const tier = ladderTier(points);
  const multiplier = mode === 'duo' ? 2 : 1;
  const ruleLoss = tier.loss * multiplier;
  return { win: tier.win * multiplier, loss: Math.min(Math.max(0, points), ruleLoss), ruleLoss };
}

export interface DeckStrength {
  readonly average: number | null;
  readonly label: string;
  readonly color: string;
  readonly gradient: string;
  readonly invalidCardIds: readonly string[];
}

function mixColor(a: string, b: string, amount: number): string {
  const channels = [1, 3, 5].map(offset => {
    const from = parseInt(a.slice(offset, offset + 2), 16);
    const to = parseInt(b.slice(offset, offset + 2), 16);
    return Math.round(from + (to - from) * amount).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

/** 权重越大越稀有；事件档使用数据level，不使用图鉴排序位。空槽不稀释平均值。 */
export function deckStrength(
  cardIds: readonly string[],
  rarityOf: (cardId: string) => string | undefined,
  rarities: readonly RarityEntryLike[],
): DeckStrength {
  const neutral = '#8a93a6';
  const byRarity = new Map(rarities.map(rarity => [rarity.rarity, rarity]));
  const invalidCardIds: string[] = [];
  let total = 0;
  for (const id of cardIds) {
    const rarity = byRarity.get(rarityOf(id) ?? '');
    if (!rarity || !Number.isFinite(rarity.level) || rarity.level < 0 || rarity.level > 6) {
      invalidCardIds.push(id);
    } else {
      total += 7 - rarity.level;
    }
  }
  if (!cardIds.length || invalidCardIds.length) {
    return { average: null, label: invalidCardIds.length ? '无法评估' : '未配置',
      color: neutral, gradient: `linear-gradient(90deg, ${neutral}, ${neutral})`, invalidCardIds };
  }
  const average = total / cardIds.length;
  const anchors = rarities.filter(rarity => !rarity.isEvent).sort((a, b) => b.level - a.level);
  const lower = anchors.filter(rarity => 7 - rarity.level <= average).at(-1) ?? anchors[0];
  const upper = anchors.find(rarity => 7 - rarity.level >= average) ?? anchors.at(-1);
  if (!lower || !upper) return { average, label: '未知档位', color: neutral, gradient: neutral, invalidCardIds };
  const span = lower.level - upper.level;
  const ratio = span === 0 ? 0 : (average - (7 - lower.level)) / span;
  return {
    average, label: lower.rarity === upper.rarity ? lower.rarity : `${lower.rarity} — ${upper.rarity}`,
    color: mixColor(lower.color, upper.color, ratio),
    gradient: `linear-gradient(90deg, ${lower.color}, ${upper.color})`, invalidCardIds,
  };
}
