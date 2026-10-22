import { describe, expect, it } from 'vitest';
import { cardDatabase, cardById } from '../../src/data';
import { createInitialProfile } from '../../src/domain/progression/profile';
import { abyssStateToken, planAbyssAction } from '../../src/domain/progression/abyssRun';
import { ABYSS_EFFECTS, makeAbyssCard } from '../../src/domain/progression/abyssRules';
import { applyEconomyTransaction } from '../../src/domain/progression/economy';
import type { AbyssEncounter, AbyssRun } from '../../src/domain/progression/abyssTypes';
import { compileAbyssBattle, withAbyssBattleEffects } from '../../src/scenes/abyssBattle';

function ready() {
  let profile = createInitialProfile({ contentVersion: cardDatabase.contentVersion, dayKey: '20261011', starterCardIds: [], now: new Date('2026-10-11') });
  for (const body of [{ kind: 'start' }, { kind: 'chooseStarter', index: 0 }, { kind: 'chooseBoon', index: 0 }] as const) {
    const plan = planAbyssAction(profile, { ...body, expectedToken: abyssStateToken(profile) }, 1000);
    if ('rejected' in plan) throw new Error(plan.rejected);
    const outcome = applyEconomyTransaction(profile, plan.transaction);
    if (!outcome.applied) throw new Error(outcome.reason);
    profile = outcome.profile;
  }
  const run = profile.abyss.run!;
  if (!('battle' in run.stage)) throw new Error('no battle');
  return { run, battle: run.stage.battle };
}

describe('深渊战斗编译', () => {
  it('同快照重编译保持seed与定义，buff不写回培养卡或主库', () => {
    const { run, battle } = ready();
    const before = structuredClone(run);
    const globals = JSON.stringify(cardDatabase.definitions);
    const first = compileAbyssBattle(run, battle);
    expect(compileAbyssBattle(run, battle)).toEqual(first);
    expect(first.config.seed).toBe(battle.seed);
    expect(first.config.playerDeck).toEqual(run.cards.map(card => card.instanceId));
    expect(run).toEqual(before); expect(JSON.stringify(cardDatabase.definitions)).toBe(globals);
    for (const card of run.cards) expect(first.definitions[card.instanceId]?.art).toEqual(card.definition.art);
  });
  it('同模板不同培养独立；双方召唤目标各自编译全体效果', () => {
    const { run, battle } = ready();
    const template = cardDatabase.definitions.find(card => card.skills.some(skill => skill.family === 'masterpiece'))!;
    expect(template).toBeDefined();
    const player = makeAbyssCard(template, `${run.id}/p`, 2, 3);
    const enemy = makeAbyssCard(template, `${run.id}/e`);
    const positive = ABYSS_EFFECTS.find(effect => effect.id === 'might')!;
    const negative = ABYSS_EFFECTS.find(effect => effect.id === 'delay')!;
    const enemyEffect = ABYSS_EFFECTS.find(effect => effect.id === 'vitality')!;
    const localRun: AbyssRun = { ...run, cards: [player] };
    const localBattle: AbyssEncounter = { ...battle, floor: 2, enemyCards: [enemy], enemyEffect, selectedBoon: 0,
      boonChoices: [{ id: 'test', positive, negative }] };
    const compiled = compileAbyssBattle(localRun, localBattle);
    expect(compiled.definitions[player.instanceId]!.atk).toBe(template.atk + 3);
    expect(compiled.definitions[enemy.instanceId]!.atk).toBe(template.atk);
    const playerSummon = compiled.config.summonDefinitions!.player!['A+_006']!;
    const enemySummon = compiled.config.summonDefinitions!.enemy!['A+_006']!;
    expect(playerSummon).not.toBe(enemySummon);
    expect(compiled.definitions[playerSummon]!.atk).toBe(cardById.get('A+_006')!.atk + 1);
    expect(compiled.definitions[enemySummon]!.hp).toBe(cardById.get('A+_006')!.hp + 1);
    expect(compiled.definitions['A+_006']).toBeUndefined();
  });
  it('边界截断、原有trait重复保留，免疫不重复追加', () => {
    const template = cardDatabase.definitions.find(card => card.status === 'complete')!;
    const immunity = ABYSS_EFFECTS.find(effect => effect.id === 'immunity')!;
    const base = { ...template, atk: 0, hp: 1, cd: 0 };
    const first = withAbyssBattleEffects(base, [immunity, immunity, ABYSS_EFFECTS.find(effect => effect.id === 'frailty')!]);
    expect(first.hp).toBe(1);
    expect(first.rawTraits.slice(0, base.rawTraits.length)).toEqual(base.rawTraits);
    expect(first.skills.filter(skill => skill.family === 'immunity')).toHaveLength(Math.max(1, base.skills.filter(skill => skill.family === 'immunity').length));
  });
});
