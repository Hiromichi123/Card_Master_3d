import { describe, expect, it } from 'vitest';
import type { BattleEvent } from '../../src/domain/battle/types';
import { FAMILY_TO_EFFECT } from '../../src/rendering/effects/familyMap';
import { cardSoundFor, castSoundFor } from '../../src/rendering/presentation/soundMapping';

const skill = (family: string): BattleEvent => ({ type: 'SkillTriggered', seq: 1, turn: 1, side: 'player', instanceId: 'caster', trigger: 'ON_DEPLOY', family, raw: family, param: 1 });

describe('战斗音效映射', () => {
  it('抽牌、出牌、上场各有音效，双方共用，跳过不补播', () => {
    for (const side of ['player', 'enemy'] as const) {
      const base = { seq: 1, turn: 1, side, instanceId: 'card' };
      const cases: readonly [BattleEvent, string][] = [
        [{ ...base, type: 'CardDrawn', fromDeckIndex: 0 }, 'deal'],
        [{ ...base, type: 'CardPlayed', prepSlot: 0 }, 'play'],
        [{ ...base, type: 'CardDeployed', battleSlot: 0 }, 'deploy'],
      ];
      for (const [event, cue] of cases) {
        expect(cardSoundFor(event, false)).toBe(cue);
        expect(cardSoundFor(event, true)).toBeNull();
      }
    }
    expect(cardSoundFor(skill('fireball'), false)).toBeNull();
  });
  it('普通攻击有独立起手，跳过或没有视觉请求时不补播', () => {
    const event: BattleEvent = { type: 'AttackDeclared', seq: 1, turn: 1, side: 'player', attackerId: 'a', targetInstanceId: 'b', targetSlot: 0 };
    expect(castSoundFor(event, 'normalAttack', false)).toBe('attack');
    expect(castSoundFor(event, 'normalAttack', true)).toBeNull();
    expect(castSoundFor(event, null, false)).toBeNull();
  });

  it('单体与群体施法共享元素音色，目标事件不再次施法', () => {
    for (const [family, cue] of [
      ['fireball', 'fire'], ['groupFireball', 'fire'], ['bombard', 'fire'],
      ['iceSeal', 'ice'], ['groupIceSeal', 'ice'], ['lightning', 'lightning'],
      ['groupLightning', 'lightning'], ['slash', 'slash'], ['groupSwordDance', 'slash'],
      ['selfHeal', 'heal'], ['groupHeal', 'heal'], ['holyShield', 'shield'], ['teleport', 'teleport'],
    ]) {
      const event = skill(family!);
      const template = FAMILY_TO_EFFECT[family!] ?? null;
      expect(castSoundFor(event, template, false)).toBe(cue);
      expect(castSoundFor(event, null, false)).toBeNull();
      expect(castSoundFor(event, template, true)).toBeNull();
    }
    const healed: BattleEvent = { type: 'Healed', seq: 2, turn: 1, side: 'player', instanceId: 'target', amount: 2, hpBefore: 1, hpAfter: 3 };
    expect(castSoundFor(healed, 'heal', false)).toBeNull();
    expect(castSoundFor(skill('unknown'), null, false)).toBeNull();
  });

  it('反射法术按原元素出声', () => {
    const event: BattleEvent = { type: 'SpellReflected', seq: 2, turn: 1, side: 'enemy', casterId: 'a', reflectorId: 'b', family: 'lightning', raw: 'lightning', param: 1 };
    expect(castSoundFor(event, 'lightning', false)).toBe('lightning');
  });
});
