import type { EconomyTransaction, ProfileState } from './types';
import { reject, type Planned } from './plan';

export interface PlayerMail {
  readonly id: string; readonly title: string; readonly sender: string; readonly body: string; readonly createdAt: string;
  readonly gold: number; readonly crystal: number; readonly read: boolean; readonly claimed: boolean;
}
export interface MailboxState { readonly messages: readonly PlayerMail[] }
export const emptyMailbox = (): MailboxState => ({ messages: [] });
export function welcomeMailbox(now: Date): MailboxState {
  return { messages: [{ id: 'welcome-v1', title: '新手启程奖励', sender: '卡牌管理局',
    body: '欢迎来到 Card Master 3D！这份启程补给将帮助你组建卡组、探索世界。领取下方附件，开启属于你的卡牌旅程。',
    createdAt: now.toISOString(), gold: 3000, crystal: 300, read: false, claimed: false }] };
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const natural = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function normalizeMailbox(value: unknown): MailboxState | null {
  if (value === undefined) return emptyMailbox();
  if (!record(value) || !Array.isArray(value.messages) || value.messages.length > 1000) return null;
  const messages: PlayerMail[] = [], ids = new Set<string>();
  for (const row of value.messages as unknown[]) {
    if (!record(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id)
      || typeof row.title !== 'string' || typeof row.sender !== 'string' || typeof row.body !== 'string'
      || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))
      || !natural(row.gold) || !natural(row.crystal) || typeof row.read !== 'boolean' || typeof row.claimed !== 'boolean') return null;
    ids.add(row.id); messages.push({ id: row.id, title: row.title, sender: row.sender, body: row.body,
      createdAt: row.createdAt, gold: row.gold, crystal: row.crystal, read: row.read, claimed: row.claimed });
  }
  return { messages };
}
export function mailboxOf(profile: ProfileState): MailboxState { return profile.mailbox ?? emptyMailbox(); }
export function mailAttentionCount(profile: ProfileState): number {
  return mailboxOf(profile).messages.filter(mail => !mail.read || (!mail.claimed && (mail.gold > 0 || mail.crystal > 0))).length;
}
export function planMailAction(profile: ProfileState, mailId: string, kind: 'read' | 'claim'): Planned<string> {
  const mail = mailboxOf(profile).messages.find(m => m.id === mailId);
  if (!mail) return reject('邮件不存在。');
  if (kind === 'claim' && mail.claimed) return reject('这封邮件的奖励已领取。');
  if (kind === 'read' && mail.read) return reject('邮件已读。');
  return { transaction: { operationId: `mail:${kind}:${mailId}`, mailAction: { kind, mailId }, inventoryDelta: {},
      currencyDelta: kind === 'claim' ? { gold: mail.gold, crystal: mail.crystal } : {} },
    view: kind === 'claim' ? `领取成功：水晶 +${mail.crystal}，金币 +${mail.gold}` : '邮件已读' };
}
export function validMailTransaction(profile: ProfileState, tx: EconomyTransaction): boolean {
  const action = tx.mailAction; if (!action) return true;
  const mail = mailboxOf(profile).messages.find(m => m.id === action.mailId);
  if (!mail || !['read', 'claim'].includes(action.kind) || (action.kind === 'claim' ? mail.claimed : mail.read)
    || tx.abyssUpdate || tx.abyssReward || tx.noviceClaim || tx.activityEvent || tx.rewardClaim || tx.ladderRewardClaim
    || tx.settleBattleId || tx.clearStageId || tx.xpDelta !== undefined || tx.shopDayKey || tx.soldOutAdditions
    || tx.mazeUpdate || tx.mazeSoldOut || tx.mazeShopExpected || tx.mazeShopRefresh || Object.keys(tx.inventoryDelta).length > 0) return false;
  return (tx.currencyDelta.gold ?? 0) === (action.kind === 'claim' ? mail.gold : 0)
    && (tx.currencyDelta.crystal ?? 0) === (action.kind === 'claim' ? mail.crystal : 0) && (tx.currencyDelta.badge ?? 0) === 0;
}
export function foldMailbox(profile: ProfileState, tx: EconomyTransaction): MailboxState {
  const mailbox = mailboxOf(profile), action = tx.mailAction;
  return action ? { messages: mailbox.messages.map(mail => mail.id === action.mailId
    ? { ...mail, read: true, claimed: mail.claimed || action.kind === 'claim' } : mail) } : mailbox;
}
