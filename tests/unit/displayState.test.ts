/**
 * 显示状态与桌面映射。
 *
 * 这一层的关键性质是：**显示状态按事件逐个推进之后，必须与权威状态的投影完全一致**。
 * 只要有一处数值改动没有对应的 patch，这里就会露出来——不用等到浏览器。
 */

import { describe, expect, it } from 'vitest';

import { chooseCommand } from '../../src/domain/battle/ai';
import { applyCommand, createBattle } from '../../src/domain/battle/engine';
import { createRng } from '../../src/domain/battle/rng';
import type {
  BattleEvent,
  DisplayPatch,
  Resolution,
} from '../../src/domain/battle/types';
import { BATTLE_SLOT_COUNT, PREP_SLOT_COUNT, buildSlots } from '../../src/rendering/battle/layout';
import { globalSlotIndex, slotKeyFor } from '../../src/rendering/battle/placements';
import {
  applyEventToDisplay,
  applyPatchesToDisplay,
  displayFromState,
  projectDisplay,
  type DisplayState,
} from '../../src/rendering/presentation/displayState';
import { AI_SEED_MIX, demoDefinitions } from '../../src/rendering/presentation/demoBattle';

const definitions = demoDefinitions();

/** 演示牌组的前几张，用来跑一整局。 */
const DECK_PLAYER = ['A_011', 'B+_002', 'B_021', 'SSS_001', 'C+_014'];
const DECK_ENEMY = ['S_001', 'A+_013', 'SS+_011', 'SS+_002', 'C+_007'];

function demoBattle(overrides: { playerDeck?: string[]; enemyDeck?: string[] } = {}) {
  return createBattle(
    {
      seed: 20261005,
      playerDeck: overrides.playerDeck ?? ['A_011', 'A_011', 'B+_002'],
      enemyDeck: overrides.enemyDeck ?? ['S_001', 'A+_013', 'SS+_011'],
    },
    definitions,
  );
}

/** 按演出导演的次序重放一次结算：先 patch（命中节点），再事件（结构）。 */
function replayInto(display: DisplayState, resolution: Resolution): void {
  const patchesAt = new Map<number, DisplayPatch[]>();
  for (const patch of resolution.patches) {
    const list = patchesAt.get(patch.atEventSeq);
    if (list) {
      list.push(patch);
    } else {
      patchesAt.set(patch.atEventSeq, [patch]);
    }
  }
  for (const event of resolution.events) {
    applyPatchesToDisplay(display, patchesAt.get(event.seq) ?? []);
    applyEventToDisplay(display, event);
  }
}

const KNOWN_EVENTS: readonly BattleEvent['type'][] = [
  'BattleStarted',
  'CardDrawn',
  'CardPlayed',
  'CooldownChanged',
  'CardDeployed',
  'SkillTriggered',
  'AttackDeclared',
  'DamageApplied',
  'Healed',
  'StatChanged',
  'PlayerHpChanged',
  'CardDied',
  'CardMoved',
  'CloneCreated',
  'SlotCompacted',
  'TurnEnded',
  'BattleEnded',
];

describe('槽位键的桥', () => {
  it('每侧下标 → 全局下标与 buildSlots 的排布一致', () => {
    const slots = buildSlots();
    // 玩家战斗区 5 + 敌方战斗区 5 + 玩家准备区 8 + 敌方准备区 8
    expect(slots).toHaveLength(BATTLE_SLOT_COUNT * 2 + PREP_SLOT_COUNT * 2);

    const cases = [
      { side: 'player', zone: 'battle', count: BATTLE_SLOT_COUNT },
      { side: 'enemy', zone: 'battle', count: BATTLE_SLOT_COUNT },
      { side: 'player', zone: 'prep', count: PREP_SLOT_COUNT },
      { side: 'enemy', zone: 'prep', count: PREP_SLOT_COUNT },
    ] as const;

    for (const { side, zone, count } of cases) {
      for (let index = 0; index < count; index += 1) {
        const global = globalSlotIndex(side, zone, index);
        const slot = slots[global];
        // 翻回全局下标之后必须指回同一个槽：若 buildSlots 的顺序变了却没同步这里，
        // 高亮会亮在别人的槽上，这条断言就是那道防线
        expect(slot, `${side}/${zone}/${index} → ${global}`).toBeDefined();
        expect(slot?.side).toBe(side);
        expect(slot?.zone).toBe(zone);
      }
    }
  });

  it('同一格的键稳定且互不相同', () => {
    expect(slotKeyFor('player', 'prep', 0)).toBe(slotKeyFor('player', 'prep', 0));
    expect(slotKeyFor('player', 'prep', 0)).not.toBe(slotKeyFor('enemy', 'prep', 0));
  });
});

describe('显示状态', () => {
  it('开局与权威状态一致：各抽 3 张、场上为空、本体满血', () => {
    const state = demoBattle();
    const display = displayFromState(state);

    expect(display.zones.player.hand).toHaveLength(3);
    expect(display.zones.enemy.hand).toHaveLength(3);
    expect(display.zones.player.battle.every((slot) => slot === null)).toBe(true);
    expect(display.zones.player.prep.every((slot) => slot === null)).toBe(true);
    expect(display.playerHp).toEqual({ player: state.hp.player, enemy: state.hp.enemy });
    expect(projectDisplay(display)).toBe(projectDisplay(displayFromState(state)));
  });

  it('同一个 cardId 的两份实例是不同的 instanceId', () => {
    const state = demoBattle();
    const drawn = state.zones.player.deck.concat(state.zones.player.hand);
    const copies = drawn.filter((id) => state.instances[id]?.definitionId === 'A_011');

    expect(copies.length).toBeGreaterThanOrEqual(2);
    expect(new Set(copies).size).toBe(copies.length);
  });

  it('推进一次结算之后，显示状态与权威状态一致', () => {
    const state = demoBattle();
    const display = displayFromState(state);
    const instanceId = state.zones.player.hand[0] as string;

    const resolution = applyCommand(state, {
      kind: 'playCard',
      side: 'player',
      instanceId,
    });
    expect(resolution.accepted).toBe(true);

    replayInto(display, resolution);
    expect(projectDisplay(display)).toBe(
      projectDisplay(displayFromState(resolution.finalState)),
    );
  });
});

describe('整局推进', () => {
  it('每一手之后显示状态都与权威状态一致', () => {
    let state = demoBattle({ playerDeck: DECK_PLAYER, enemyDeck: DECK_ENEMY });
    const display = displayFromState(state);
    const rng = createRng(state.seed ^ AI_SEED_MIX);

    let steps = 0;
    while (!state.outcome && steps < 400) {
      const command = chooseCommand(state, rng);
      const resolution = applyCommand(state, command);
      expect(resolution.accepted).toBe(true);

      replayInto(display, resolution);
      expect(
        projectDisplay(display),
        `第 ${steps} 手（${command.kind}）之后显示状态与权威状态不一致`,
      ).toBe(projectDisplay(displayFromState(resolution.finalState)));

      state = resolution.finalState;
      steps += 1;
    }

    expect(state.outcome).not.toBeNull();
  });

  it('整局不会冒出处理不了的事件类型', () => {
    // 事件种类增加时这条会提醒：演出层需要为它决定「做什么」还是「什么都不做」
    const known = new Set<string>(KNOWN_EVENTS);
    let state = demoBattle({ playerDeck: DECK_PLAYER, enemyDeck: DECK_ENEMY });
    const rng = createRng(state.seed ^ AI_SEED_MIX);
    const seen = new Set<string>();
    let steps = 0;

    while (!state.outcome && steps < 400) {
      const resolution = applyCommand(state, chooseCommand(state, rng));
      for (const event of resolution.events) {
        seen.add(event.type);
        expect(known.has(event.type), `未处理的事件类型：${event.type}`).toBe(true);
      }
      state = resolution.finalState;
      steps += 1;
    }
    expect(seen.size).toBeGreaterThan(3);
  });
});
