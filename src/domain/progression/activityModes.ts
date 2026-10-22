import type { BattleConfig, BattleOutcome } from '../battle/types';
import type { CardDefinition, CardRarity } from '../cards/types';
import type { ProfileState, EconomyTransaction } from './types';
import type { Planned } from './plan';

export type ActivityKind = 'coop' | 'extreme';
export interface ActivityPeriod { readonly key: string; readonly start: number; readonly end: number }
const DAY = 86_400_000;
// Epochs are Beijing 04:00, independent of the host timezone.
const WEEK_EPOCH = Date.UTC(2026, 9, 11, 20);
const CHALLENGE_EPOCH = Date.UTC(2026, 9, 14, 20);
export function activityPeriod(kind: ActivityKind, now: number): ActivityPeriod {
  const span = DAY * (kind === 'coop' ? 7 : 3), epoch = kind === 'coop' ? WEEK_EPOCH : CHALLENGE_EPOCH;
  const index = Math.floor((now - epoch) / span), start = epoch + index * span;
  return { key: `${kind}:${index}`, start, end: start + span };
}
export const BOSS_PHASES: readonly { hp: number; rarity: CardRarity }[] = [
  { hp: 300, rarity: 'D' }, { hp: 450, rarity: 'C' }, { hp: 650, rarity: 'C+' },
  { hp: 950, rarity: 'B' }, { hp: 1300, rarity: 'B+' }, { hp: 1800, rarity: 'A' },
  { hp: 2400, rarity: 'A+' }, { hp: 3200, rarity: 'S' }, { hp: 4200, rarity: 'S+' },
  { hp: 5400, rarity: 'SS' }, { hp: 6900, rarity: 'SS+' }, { hp: 9000, rarity: 'SSS' },
];
export const BOSS_TOTAL_HP = BOSS_PHASES.reduce((n, p) => n + p.hp, 0);
export const BOSS_MILESTONES = [
  { damage: 25, gold: 150, crystal: 15 }, { damage: 100, gold: 300, crystal: 30 },
  { damage: 300, gold: 600, crystal: 60 }, { damage: 700, gold: 1000, crystal: 100 },
  { damage: 1500, gold: 1500, crystal: 150 },
] as const;
export const CHALLENGE_OBJECTIVES = ['赢得挑战', '本体全程未扣血', '少于15回合获胜', '获胜时普通手牌超过6张'] as const;
export const CHALLENGE_THEMES = ['空域压制', '要塞攻坚', '元素洪流', '亡者反扑'] as const;
const THEME_TRAITS = [/飞行|对空|远射/, /防御|刺甲|先锋|攻城/, /火球|冰封|闪电|毒雾/, /爆裂|还魂|复活|自毁/];
export function activitySeed(text: string): number {
  let seed = 2166136261;
  for (const ch of text) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  return seed >>> 0;
}
function random(seed: number): () => number {
  let x = seed || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
}
export function bossPhase(damage: number): { index: number; remaining: number } {
  let left = Math.max(0, damage);
  for (let index = 0; index < BOSS_PHASES.length; index++) {
    const phase = BOSS_PHASES[index]!;
    if (left < phase.hp) return { index, remaining: phase.hp - left };
    left -= phase.hp;
  }
  return { index: BOSS_PHASES.length - 1, remaining: 0 };
}
export function challengeTheme(key: string): number { return activitySeed(key) % CHALLENGE_THEMES.length; }
/** Stable public decks. No hidden numerical multipliers or event/summon cards. */
export function activityEnemyDeck(kind: ActivityKind, key: string, phase: number, cards: readonly CardDefinition[]): string[] {
  const rng = random(activitySeed(`${key}:${phase}:deck-v1`));
  const complete = cards.filter(c => c.status === 'complete' && !c.rarity.startsWith('#')).slice().sort((a,b) => a.cardId.localeCompare(b.cardId));
  const theme = THEME_TRAITS[challengeTheme(key)]!;
  return Array.from({ length: 12 }, (_, i) => {
    const rarity: CardRarity = kind === 'coop' ? BOSS_PHASES[phase]!.rarity : (['A','A+','S','A+','S','SS'] as const)[i % 6]!;
    let pool = complete.filter(c => c.rarity === rarity);
    if (kind === 'extreme' && i % 2 === 0) {
      const tactical = pool.filter(c => c.rawTraits.some(trait => theme.test(trait)));
      if (tactical.length) pool = tactical;
    }
    if (!pool.length) throw new Error(`卡库缺少可用的 ${rarity} 级卡牌。`);
    return pool[Math.floor(rng() * pool.length)]!.cardId;
  });
}
export interface ActivityBattleReport {
  readonly outcome: BattleOutcome; readonly turns: number; readonly playerHp: number; readonly enemyHp: number;
  readonly enemyBaseDamage: number; readonly playerBaseDamage: number; readonly handCount: number;
}
export function challengeMask(report: ActivityBattleReport): number {
  if (report.outcome.kind !== 'win' || report.outcome.winner !== 'player') return 0;
  return 1 | (report.playerBaseDamage === 0 ? 2 : 0) | (report.turns < 15 ? 4 : 0) | (report.handCount > 6 ? 8 : 0);
}
export function challengeReward(mask: number): { gold: number; crystal: number } {
  const extras = [2,4,8].filter(bit => (mask & bit) !== 0).length;
  return { gold: (mask & 1 ? 1000 : 0) + extras * 200, crystal: (mask & 1 ? 100 : 0) + extras * 20 };
}
export function rankReward(rank: number): { gold: number; crystal: number } {
  return rank === 1 ? { gold: 600, crystal: 60 } : rank <= 3 ? { gold: 400, crystal: 40 }
    : rank <= 10 ? { gold: 250, crystal: 25 } : { gold: 100, crystal: 10 };
}
export interface ActivityTicket {
  readonly id: string; readonly actorId: string; readonly name: string; readonly mode: ActivityKind;
  readonly period: ActivityPeriod; readonly phase: number; readonly config: BattleConfig; readonly createdAt: number;
  readonly status: 'pending' | 'finished' | 'abandoned';
}
export interface ActivityReceipt {
  readonly id: string; readonly actorId: string; readonly cycleKey: string;
  readonly kind: 'battle' | 'milestone' | 'rank'; readonly mode: ActivityKind;
  readonly battleId?: string; readonly report?: ActivityBattleReport; readonly damage?: number;
  readonly gold: number; readonly crystal: number; readonly challengeBits?: number; readonly label: string;
}
export interface ActivityProgress {
  readonly receipts: readonly string[]; readonly challengeBits: Readonly<Record<string, number>>;
}
export const emptyActivityProgress = (): ActivityProgress => ({ receipts: [], challengeBits: {} });
export function normalizeActivityProgress(value: unknown): ActivityProgress | null {
  if (value === undefined) return emptyActivityProgress();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<ActivityProgress>;
  if (!Array.isArray(v.receipts) || v.receipts.some(id => typeof id !== 'string' || !id)
    || new Set(v.receipts).size !== v.receipts.length || !v.challengeBits || typeof v.challengeBits !== 'object' || Array.isArray(v.challengeBits)
    || Object.entries(v.challengeBits).some(([key, bits]) => !/^extreme:-?\d+$/.test(key) || !Number.isInteger(bits) || bits < 0 || bits > 15 || (bits > 0 && !(bits & 1)))) return null;
  return { receipts: [...v.receipts], challengeBits: { ...v.challengeBits } };
}
export const activityProgressOf = (profile: ProfileState): ActivityProgress => profile.activityModes ?? emptyActivityProgress();
function receiptReward(profile: ProfileState, receipt: ActivityReceipt): { gold: number; crystal: number } {
  if (receipt.kind !== 'battle' || receipt.mode !== 'extreme') return { gold: receipt.gold, crystal: receipt.crystal };
  const before = activityProgressOf(profile).challengeBits[receipt.cycleKey] ?? 0;
  return challengeReward((receipt.challengeBits ?? 0) & ~before);
}
export function planActivityReceipt(profile: ProfileState, receipt: ActivityReceipt): Planned<string> {
  if (activityProgressOf(profile).receipts.includes(receipt.id)) return { rejected: '该笔结算已入账。' };
  const reward = receiptReward(profile, receipt);
  return { transaction: { operationId: `activity-receipt:${receipt.id}`, activityReceipt: receipt,
    currencyDelta: reward, inventoryDelta: {}, ...(receipt.battleId ? { settleBattleId: receipt.battleId } : {}) },
    view: `${receipt.label}：金币 +${reward.gold}，水晶 +${reward.crystal}` };
}
export function validActivityReceipt(profile: ProfileState, tx: EconomyTransaction): boolean {
  const r = tx.activityReceipt;
  if (!r) return true;
  const reward = receiptReward(profile, r);
  return Boolean(r.id && r.actorId && r.cycleKey && ['battle','rank','milestone'].includes(r.kind)
    && ['coop','extreme'].includes(r.mode) && !activityProgressOf(profile).receipts.includes(r.id)
    && [r.gold,r.crystal,reward.gold,reward.crystal].every(n => Number.isSafeInteger(n) && n >= 0)
    && (r.challengeBits === undefined || (Number.isInteger(r.challengeBits) && r.challengeBits >= 0 && r.challengeBits <= 15))
    && (r.kind !== 'battle' || (r.battleId && r.report && r.gold === 0 && r.crystal === 0
      && (r.mode !== 'extreme' || r.challengeBits === challengeMask(r.report)))) && (r.kind === 'battle' || !r.battleId)
    && tx.settleBattleId === r.battleId && tx.currencyDelta.gold === reward.gold && tx.currencyDelta.crystal === reward.crystal
    && !(tx.currencyDelta.badge ?? 0) && !Object.keys(tx.inventoryDelta).length
    && !tx.mailAction && !tx.noviceClaim && !tx.activityEvent && !tx.rewardClaim && !tx.ladderRewardClaim
    && !tx.abyssUpdate && !tx.abyssReward && !tx.clearStageId && tx.xpDelta === undefined && !tx.shopDayKey
    && !tx.soldOutAdditions && !tx.mazeUpdate && !tx.mazeSoldOut && !tx.mazeShopExpected && !tx.mazeShopRefresh);
}
export function foldActivityProgress(profile: ProfileState, tx: EconomyTransaction): ActivityProgress {
  const before = activityProgressOf(profile), r = tx.activityReceipt;
  if (!r) return before;
  return { receipts: [...before.receipts, r.id], challengeBits: r.mode === 'extreme' && r.kind === 'battle'
    ? { ...before.challengeBits, [r.cycleKey]: (before.challengeBits[r.cycleKey] ?? 0) | (r.challengeBits ?? 0) } : before.challengeBits };
}
