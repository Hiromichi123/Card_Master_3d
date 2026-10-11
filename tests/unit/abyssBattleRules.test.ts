import { describe, expect, it } from 'vitest';
import { applyCommand, createBattle } from '../../src/domain/battle/engine';
import { resetCardLife } from '../../src/domain/battle/cardLifecycle';
import type { BattleConfig, BattleState, DamageSource, Resolution } from '../../src/domain/battle/types';
import type { CardDefinition, CardInstance, SideId } from '../../src/domain/cards/types';
import { groupOf } from '../../src/domain/skills/rules';
import { describeTraitFunction } from '../../src/domain/skills/traitDescriptions';
import type { SkillSpec } from '../../src/domain/skills/types';

const trait = (family: string, raw: string, param: number | null = null): SkillSpec =>
  ({ family, raw, param, resolution: 'implemented' });
const immunity = trait('immunity', '免疫');
const card = (cardId: string, skills: readonly SkillSpec[] = [], atk = 0, hp = 20): CardDefinition => ({
  cardId, rarity: 'C', name: cardId, level: 5, atk, hp, cd: 0,
  rawTraits: skills.map(skill => skill.raw), skills, description: '', status: 'complete',
  art: { artId: 'card/c/001', sourcePresent: true },
});

function setup(player: CardDefinition, enemy: CardDefinition) {
  const state = createBattle({ seed: 12, playerDeck: [player.cardId], enemyDeck: [enemy.cardId],
    rules: { drawPerTurn: 0 } }, { [player.cardId]: player, [enemy.cardId]: enemy });
  state.currentSide = 'player';
  state.phase = 'awaitingPlay';
  const p = place(state, 'player', player.cardId, 'battle');
  const e = place(state, 'enemy', enemy.cardId, 'battle');
  return { state, p, e };
}

function place(state: BattleState, side: SideId, definitionId: string, zone: 'battle' | 'prep'): CardInstance {
  const instance = Object.values(state.instances).find(value => value.owner === side && value.definitionId === definitionId)!;
  state.zones[side].hand = state.zones[side].hand.filter(id => id !== instance.instanceId);
  state.zones[side].deck = state.zones[side].deck.filter(id => id !== instance.instanceId);
  instance.zone = zone;
  instance.slotIndex = 0;
  instance.cd = 0;
  state.zones[side][zone][0] = instance.instanceId;
  return instance;
}

function act(state: BattleState): Resolution {
  const result = applyCommand(state, { kind: 'endTurn', side: state.currentSide });
  expect(result.accepted).toBe(true);
  return result;
}

function damage(result: Resolution, instance: CardInstance, source: DamageSource) {
  return result.events.filter(event => event.type === 'DamageApplied' &&
    event.instanceId === instance.instanceId && event.source === source);
}

const hp = (result: Resolution, instance: CardInstance) =>
  groupOf(result.finalState, result.finalState.instances[instance.instanceId]!).hp;

describe('真实技能免疫与明确伤害来源', () => {
  it('技能归零发生在圣盾之前，但普通攻击仍然扣血', () => {
    const { state, e } = setup(card('p', [trait('fireball', '火球3', 3)], 4),
      card('e', [immunity, trait('holyShield', '圣盾1', 1)]));
    const result = act(state);
    expect(damage(result, e, 'skill')).toMatchObject([{ amount: 0, hpBefore: 20, hpAfter: 20 }]);
    expect(damage(result, e, 'normalAttack')).toMatchObject([{ amount: 3 }]);
    expect(hp(result, e)).toBe(17);
    expect(result.events.filter(event => event.type === 'SkillTriggered' && event.family === 'holyShield')).toHaveLength(1);
  });

  it('反击被免疫，受伤自损不被免疫且保留selfInflicted来源', () => {
    const { state, p } = setup(card('p', [immunity, trait('injury', '受伤2', 2)], 1),
      card('e', [trait('counter', '反击4', 4)]));
    const result = act(state);
    expect(damage(result, p, 'counter')).toMatchObject([{ amount: 0 }]);
    expect(damage(result, p, 'selfInflicted')).toMatchObject([{ amount: 2 }]);
    expect(hp(result, p)).toBe(18);
  });

  it('不免疫物理技能或剑舞真伤', () => {
    const { state, e } = setup(card('p', [trait('directDamage', '伤害3', 3), trait('swordDance', '剑舞2', 2)]),
      card('e', [immunity]));
    const result = act(state);
    expect(damage(result, e, 'normalAttack').some(event => event.type === 'DamageApplied' && event.amount === 3)).toBe(true);
    expect(damage(result, e, 'trueDamage')).toMatchObject([{ amount: 2 }]);
    expect(hp(result, e)).toBe(15);
  });

  it('不免疫直接击杀', () => {
    const { state, e } = setup(card('p', [trait('instantDeath', '即死')]), card('e', [immunity]));
    const result = act(state);
    expect(damage(result, e, 'instantDeath')).toMatchObject([{ amount: 20 }]);
    expect(result.finalState.instances[e.instanceId]?.zone).toBe('discard');
  });

  it('免疫根据当前对位沉默而非旧marks动态判断', () => {
    const { state, p, e } = setup(card('p', [trait('fireball', '火球3', 3), trait('silence', '沉默')]),
      card('e', [immunity]));
    e.marks.silenced = false;
    expect(damage(act(state), e, 'skill')).toMatchObject([{ amount: 3 }]);
    state.zones.player.battle[0] = null;
    state.zones.player.battle[1] = p.instanceId;
    p.slotIndex = 1;
    e.marks.silenced = true;
    expect(damage(act(state), e, 'skill')).toMatchObject([{ amount: 0 }]);
  });

  it('不挡状态施加，但挡下一次行动的技能持续伤害', () => {
    const { state, p } = setup(card('p', [immunity], 1), card('e', [trait('burning', '燃烧3', 3)]));
    const first = act(state);
    expect(first.events.some(event => event.type === 'AttackStatusApplied' && event.instanceId === p.instanceId)).toBe(true);
    const next = first.finalState;
    next.currentSide = 'player';
    next.phase = 'awaitingPlay';
    next.instances[p.instanceId]!.hasAttackedThisTurn = false;
    const second = act(next);
    expect(second.events.some(event => event.type === 'AttackStatusTriggered' && event.instanceId === p.instanceId)).toBe(true);
    expect(damage(second, p, 'skill')).toMatchObject([{ amount: 0 }]);
    expect(hp(second, p)).toBe(20);
  });

  it('法术反弹后在实际受害方判免疫', () => {
    const { state, p } = setup(card('p', [immunity, trait('fireball', '火球3', 3)]),
      card('e', [trait('spellReflect', '法术反弹')]));
    const result = act(state);
    expect(result.events.some(event => event.type === 'SpellReflected')).toBe(true);
    expect(damage(result, p, 'skill')).toMatchObject([{ amount: 0 }]);
    expect(hp(result, p)).toBe(20);
  });

  it('直击本体和献祭生命转移不受卡牌免疫保护', () => {
    const { state } = setup(card('p', [trait('piercing', '穿刺3', 3)]), card('e', [immunity]));
    expect(act(state).finalState.hp.enemy).toBe(17);
    const self = card('healer', [trait('sacrifice', '献祭3', 3)]);
    const donor = card('donor', [immunity]);
    const enemy = card('enemy');
    const sacrifice = createBattle({ seed: 7, playerDeck: ['healer', 'donor'], enemyDeck: ['enemy'] },
      { healer: self, donor, enemy });
    sacrifice.currentSide = 'player';
    const recipient = place(sacrifice, 'player', 'healer', 'battle');
    const giving = place(sacrifice, 'player', 'donor', 'battle');
    sacrifice.zones.player.battle[0] = recipient.instanceId;
    sacrifice.zones.player.battle[1] = giving.instanceId;
    giving.slotIndex = 1;
    place(sacrifice, 'enemy', 'enemy', 'battle');
    groupOf(sacrifice, recipient).hp = 10;
    const result = act(sacrifice);
    expect(hp(result, giving)).toBe(17);
    expect(hp(result, recipient)).toBe(13);
  });

  it('文案说明真实边界而非尚未接入', () => {
    expect(describeTraitFunction(immunity)).toContain('反击');
    expect(describeTraitFunction(immunity)).toContain('沉默');
    expect(describeTraitFunction(immunity)).not.toContain('尚未接入');
  });
});

describe('分阵营召唤模板与本战增益', () => {
  function summonSetup(mapping = true) {
    const p = card('summoner-p', [trait('masterpiece', '杰作')]);
    const e = card('summoner-e', [trait('masterpiece', '杰作')]);
    const original = card('A+_006', [], 1, 3);
    const playerSummon = card('runtime-p', [immunity, trait('clone', '分身')], 3, 8);
    const enemySummon = card('runtime-e', [], 6, 12);
    const config: BattleConfig = { seed: 30, playerDeck: [p.cardId], enemyDeck: [e.cardId],
      ...(mapping ? { summonDefinitions: { player: { 'A+_006': 'runtime-p' }, enemy: { 'A+_006': 'runtime-e' } } } : {}) };
    const definitions = Object.fromEntries((mapping ? [p, e, playerSummon, enemySummon] : [p, e, original])
      .map(value => [value.cardId, value]));
    const state = createBattle(config, definitions);
    return { state, p, e, config };
  }

  function deploy(state: BattleState, side: SideId, definitionId: string) {
    state.currentSide = side;
    state.phase = 'awaitingPlay';
    const unit = place(state, side, definitionId, 'prep');
    const result = applyCommand(state, { kind: 'deployCard', side, instanceId: unit.instanceId, battleSlot: 0 });
    expect(result.accepted).toBe(true);
    return result;
  }

  it('没有全局召唤原模板时仍按双方映射成功，数值和免疫不串阵营', () => {
    const { state, p, e } = summonSetup();
    const playerResult = deploy(state, 'player', p.cardId);
    const enemyResult = deploy(playerResult.finalState, 'enemy', e.cardId);
    expect(playerResult.events.filter(event => event.type === 'CardSummoned')).toMatchObject([
      { definitionId: 'runtime-p', atk: 3, hp: 8 },
    ]);
    expect(enemyResult.events.filter(event => event.type === 'CardSummoned')).toMatchObject([
      { definitionId: 'runtime-e', atk: 6, hp: 12 },
    ]);
    const units = Object.values(enemyResult.finalState.instances);
    expect(units.filter(unit => unit.definitionId === 'runtime-p')).toHaveLength(2);
    for (const unit of units.filter(value => value.definitionId === 'runtime-p')) {
      expect(unit.marks.skillImmune).toBe(true);
      expect(groupOf(enemyResult.finalState, unit)).toMatchObject({ atk: 3, hp: 8, maxHp: 8 });
    }
    expect(units.find(unit => unit.definitionId === 'runtime-e')?.marks.skillImmune).toBe(false);
  });

  it('生命周期重置与复制读取已编译定义，不再叠一次增益', () => {
    const { state, p } = summonSetup();
    const result = deploy(state, 'player', p.cardId);
    const summon = Object.values(result.finalState.instances).find(unit => unit.definitionId === 'runtime-p')!;
    groupOf(result.finalState, summon).hp = 1;
    resetCardLife(result.finalState, summon);
    expect(groupOf(result.finalState, summon)).toMatchObject({ atk: 3, hp: 8, maxHp: 8 });
    expect(summon.marks.skillImmune).toBe(true);
    resetCardLife(result.finalState, summon);
    expect(groupOf(result.finalState, summon)).toMatchObject({ atk: 3, hp: 8, maxHp: 8 });
  });

  it('独立复制保留本战定义及当前数值，不重新套用培养或buff', () => {
    const { state, p } = setup(card('runtime-copy', [immunity, trait('copy', '复制')], 3, 8), card('enemy'));
    const result = act(state);
    const copy = Object.values(result.finalState.instances).find(unit =>
      unit.definitionId === 'runtime-copy' && unit.instanceId !== p.instanceId)!;
    expect(copy).toBeDefined();
    expect(copy.stateGroupId).not.toBe(p.stateGroupId);
    expect(groupOf(result.finalState, copy)).toMatchObject({ atk: 3, hp: 8, maxHp: 8 });
    expect(copy.marks.skillImmune).toBe(true);
  });

  it('映射召唤物死亡复活只恢复一次编译后的基础属性', () => {
    const summoner = card('summoner', [trait('masterpiece', '杰作')]);
    const summon = card('runtime-rebirth', [immunity, trait('rebirth', '复活')], 3, 8);
    const enemy = card('enemy', [trait('swordDance', '剑舞30', 30)]);
    const state = createBattle({ seed: 3, playerDeck: ['summoner'], enemyDeck: ['enemy'],
      summonDefinitions: { player: { 'A+_006': 'runtime-rebirth' } } },
      { summoner, 'runtime-rebirth': summon, enemy });
    const spawned = deploy(state, 'player', 'summoner').finalState;
    const target = Object.values(spawned.instances).find(unit => unit.definitionId === 'runtime-rebirth')!;
    const attacker = place(spawned, 'enemy', 'enemy', 'battle');
    spawned.zones.enemy.battle[0] = null;
    spawned.zones.enemy.battle[1] = attacker.instanceId;
    attacker.slotIndex = 1;
    spawned.currentSide = 'enemy';
    spawned.phase = 'awaitingPlay';
    const result = act(spawned);
    expect(result.finalState.instances[target.instanceId]?.zone).toBe('prep');
    expect(groupOf(result.finalState, result.finalState.instances[target.instanceId]!)).toMatchObject({ atk: 3, hp: 8, maxHp: 8 });
    expect(result.finalState.instances[target.instanceId]?.marks.skillImmune).toBe(true);
  });

  it('狐灵召唤也解析阵营映射，不依赖硬编码原定义存在', () => {
    const summoner = card('summoner', [trait('foxSpiritSummon', '狐灵召唤')]);
    const fox = card('runtime-fox', [immunity], 4, 7);
    const enemy = card('enemy');
    const state = createBattle({ seed: 2, playerDeck: ['summoner'], enemyDeck: ['enemy'],
      summonDefinitions: { player: { '#yoroi_009': 'runtime-fox' } } },
      { summoner, 'runtime-fox': fox, enemy });
    expect(deploy(state, 'player', 'summoner').events.filter(event => event.type === 'CardSummoned')).toMatchObject([
      { definitionId: 'runtime-fox', atk: 4, hp: 7 },
    ]);
  });

  it('未配置映射的普通战斗保持原始召唤ID', () => {
    const { state, p } = summonSetup(false);
    expect(deploy(state, 'player', p.cardId).events.filter(event => event.type === 'CardSummoned')).toMatchObject([
      { definitionId: 'A+_006', atk: 1, hp: 3 },
    ]);
  });

  it('建局克隆映射，外部修改输入不会改变恢复快照', () => {
    const mappings = { player: { 'A+_006': 'runtime' } };
    const p = card('p');
    const state = createBattle({ seed: 2, playerDeck: ['p'], enemyDeck: ['p'], summonDefinitions: mappings },
      { p, runtime: card('runtime') });
    mappings.player['A+_006'] = 'changed';
    expect(state.summonDefinitions?.player?.['A+_006']).toBe('runtime');
  });
});
