import { expect, it } from 'vitest';
import { cardDatabase } from '../../src/data';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import { abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import { validateAbyssState } from '../../src/domain/progression/abyssValidation';

it('all three starter choices can be committed across varied daily seeds', () => {
  for (let seed = 0; seed < 64; seed++) {
    const now = new Date(Date.UTC(2026, 9, 22, 0, 0, seed));
    const profile = createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261022', starterCardIds: [], now });
    const started = planAbyssAction(profile, { kind: 'start', expectedToken: abyssStateToken(profile) }, now);
    if ('rejected' in started) throw new Error(started.rejected);
    const drafted = applyEconomyTransaction(profile, started.transaction);
    expect(drafted.applied).toBe(true);
    for (let index = 0; index < 3; index++) {
      const chosen = planAbyssAction(drafted.profile, { kind: 'chooseStarter', index, expectedToken: abyssStateToken(drafted.profile) }, now);
      if ('rejected' in chosen) throw new Error(chosen.rejected);
      expect(validateAbyssState(chosen.view), `seed ${seed}, group ${index}, ${JSON.stringify(chosen.view.run?.stage)}`).toBe(true);
      expect(applyEconomyTransaction(drafted.profile, chosen.transaction).applied).toBe(true);
    }
  }
});
