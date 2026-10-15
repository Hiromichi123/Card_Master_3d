import { describe, expect, it } from 'vitest';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { mailboxOf, normalizeMailbox, planMailAction } from '../../src/domain/progression/mailbox';
import { migrateToCurrent } from '../../src/domain/progression/migrations';

const fresh = () => createInitialProfile({ contentVersion: 'test', dayKey: '20261014',
  starterCardIds: Array.from({ length: 12 }, (_, i) => `D_${String(i + 1).padStart(3, '0')}`),
  initialCurrencies: { gold: 0, crystal: 0, badge: 0 }, now: new Date('2026-10-14T00:00:00Z') });
describe('welcome mailbox', () => {
  it('new beginner profile owns twelve D cards, zero resources and one unclaimed mail', () => {
    const p = fresh(); expect(p.currencies).toEqual({ gold: 0, crystal: 0, badge: 0 });
    expect(Object.values(p.inventory).reduce((a, b) => a + b, 0)).toBe(12);
    expect(p.decks[0]!.cardIds).toHaveLength(12);
    expect(mailboxOf(p).messages).toHaveLength(1); expect(mailboxOf(p).messages[0]!.claimed).toBe(false);
  });
  it('reading does not grant rewards; claiming atomically grants exact attachments once', () => {
    let p = fresh();
    const read = planMailAction(p, 'welcome-v1', 'read'); if ('rejected' in read) throw new Error(read.rejected);
    p = applyEconomyTransaction(p, read.transaction).profile;
    expect(p.currencies.gold).toBe(0); expect(mailboxOf(p).messages[0]!.read).toBe(true);
    const claim = planMailAction(p, 'welcome-v1', 'claim'); if ('rejected' in claim) throw new Error(claim.rejected);
    const result = applyEconomyTransaction(p, claim.transaction);
    expect(result.profile.currencies).toEqual({ gold: 3000, crystal: 300, badge: 0 });
    expect(mailboxOf(result.profile).messages[0]!.claimed).toBe(true);
    expect(applyEconomyTransaction(result.profile, claim.transaction).applied).toBe(false);
    expect(applyEconomyTransaction(p, { ...claim.transaction, currencyDelta: { gold: 6000, crystal: 300 } }).applied).toBe(false);
  });
  it('v8 saves migrate without retroactively creating rewards or resetting resources', () => {
    const old = { ...fresh(), schemaVersion: 8, mailbox: undefined };
    const migrated = migrateToCurrent(old, 8);
    if (!migrated.ok) throw new Error(migrated.message);
    expect(migrated.value).toMatchObject({ schemaVersion: 10, mailbox: { messages: [] }, currencies: old.currencies });
  });
  it('duplicate mail IDs cannot reset the claim ledger', () => {
    const mail = mailboxOf(fresh()).messages[0]!;
    expect(normalizeMailbox({ messages: [mail, mail] })).toBeNull();
  });
});
