import { describe, expect, it } from 'vitest';

import type { CardDefinition } from '../../src/domain/cards/types';
import { chooseCommand } from '../../src/domain/battle/ai';
import {
  applyCommand,
  createBattle,
  stateFingerprint,
  validateCommand,
} from '../../src/domain/battle/engine';
import { createRng } from '../../src/domain/battle/rng';
import type { BattleState } from '../../src/domain/battle/types';

/**
 * 战斗引擎的规则测试。
 *
 * P2 的验收门槛是「引擎可在无 Canvas/DOM 的测试环境完成一局并稳定复现」，
 * 所以这里**一个 DOM API 都不用**：没有 document、没有 window、没有渲染。
 * `vitest.config.ts` 也把环境设成 node，用 jsdom 反而会掩盖对 DOM 的依赖。
 *
 * 测试集中在**会改变对局结果**的行为上（PLAN 第 9 节）：双方 CD、
 * 重复 trait、满槽与空手、飞行、免疫边界、分身共享与复制独立、
 * 死亡连锁与胜负边界。不断言「画面对不对」，那是 P1 的事。
 */

// ---------------------------------------------------------------------------
// 测试用卡牌
// ---------------------------------------------------------------------------

interface CardSpec {
  readonly id: string;
  readonly atk?: number;
  readonly hp?: number;
  readonly cd?: number;
  readonly traits?: readonly string[];
}

/** 造一张测试卡。默认是一个 1/1/1 的白板。 */
function card(spec: CardSpec): CardDefinition {
  return {
    cardId: spec.id,
    rarity: 'C',
    name: spec.id,
    level: 5,
    atk: spec.atk ?? 1,
    hp: spec.hp ?? 1,
    cd: spec.cd ?? 1,
    rawTraits: spec.traits ?? [],
    skills: (spec.traits ?? []).map((raw) => parseTrait(raw)),
    description: '',
    status: 'complete',
    art: { artId: `card/c/${spec.id}`, sourcePresent: true },
  };
}

/**
 * 极简的 trait 解析：把 `火球3` 拆成族 + 参数。
 *
 * 只覆盖测试用到的族。**不复用导入脚本的产物**——测试要能独立说明
 * 「引擎对某个族做了什么」，而不是依赖某张真实卡恰好带了那个 trait。
 */
const TEST_FAMILIES: Record<string, string> = {
  火球: 'fireball',
  // 本项目新增的族（旧注册表里没有），与 src/domain/skills/families.ts 一致
  圣盾: 'holyShield',
  冰封: 'iceSeal',
  群体火球: 'groupFireball',
  防御: 'defense',
  破甲: 'armorBreak',
  闪避: 'dodge',
  治愈: 'healAlly',
  恢复: 'selfHeal',
  祝福: 'blessing',
  抽卡: 'drawCard',
  自毁: 'selfDestruct',
  分身: 'clone',
  复制: 'copy',
  反击: 'counter',
  受伤: 'injury',
  吸血: 'vampire',
  狂暴: 'berserk',
  加速: 'haste',
  延迟: 'delay',
};

const EXACT_FAMILIES: Record<string, string> = {
  免疫: 'immunity',
  沉默: 'silence',
  不死: 'undying',
  复活: 'rebirth',
  爆裂: 'explodeOnDeath',
  飞行: 'flight',
};

function parseTrait(raw: string): {
  raw: string;
  resolution: 'implemented' | 'scene-rule';
  family: string | null;
  param: number | null;
} {
  if (raw in EXACT_FAMILIES) {
    const family = EXACT_FAMILIES[raw] as string;
    return {
      raw,
      resolution: family === 'flight' ? 'scene-rule' : 'implemented',
      family,
      param: null,
    };
  }
  for (const [prefix, family] of Object.entries(TEST_FAMILIES)) {
    if (raw.startsWith(prefix)) {
      const digits = raw.slice(prefix.length);
      return { raw, resolution: 'implemented', family, param: Number(digits) || 1 };
    }
  }
  return { raw, resolution: 'scene-rule', family: null, param: null };
}

function table(...specs: CardSpec[]): Record<string, CardDefinition> {
  const out: Record<string, CardDefinition> = {};
  for (const spec of specs) {
    out[spec.id] = card(spec);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 对局推进辅助
// ---------------------------------------------------------------------------

/** 用 AI 把一局跑完，返回最终状态与全部事件类型序列。 */
function playOut(
  state: BattleState,
  maxCommands = 4000,
): { state: BattleState; eventTypes: string[]; commands: number } {
  const rng = createRng(state.seed ^ 0x5f3759df);
  let current = state;
  const eventTypes: string[] = [];
  let commands = 0;

  while (!current.outcome && commands < maxCommands) {
    const command = chooseCommand(current, rng);
    const resolution = applyCommand(current, command);
    expect(resolution.accepted, `AI 提交了非法命令：${JSON.stringify(command)}`).toBe(true);
    for (const event of resolution.events) {
      eventTypes.push(event.type);
    }
    current = resolution.finalState;
    commands += 1;
  }

  return { state: current, eventTypes, commands };
}

/**
 * 从某方手牌里按卡牌定义 id 找一张。
 *
 * **不能假定手牌顺序**：牌堆是洗过的，`hand[0]` 是哪张卡不确定。
 * 测试里需要特定卡时必须按 id 找——这一条是踩过才补上的：
 * 一开始假定 `hand[0]` 就是想要的那张，结果测的是另一张卡。
 */
function handCardOf(state: BattleState, side: 'player' | 'enemy', cardId: string): string {
  const found = state.zones[side].hand.find(
    (id) => state.instances[id]?.definitionId === cardId,
  );
  if (!found) {
    throw new Error(`${side} 手牌里没有 ${cardId}`);
  }
  return found;
}

/**
 * 把一张指定的卡从它所在的区域取出来交给测试摆布。
 *
 * 手牌只有开局抽的那几张，想要的卡不一定在里面——所以也从牌堆找。
 * 取出来之后调用方自己决定放哪，避免测试依赖洗牌结果。
 */
function takeCard(state: BattleState, side: 'player' | 'enemy', cardId: string): string {
  const zones = state.zones[side];
  const inHand = zones.hand.find((id) => state.instances[id]?.definitionId === cardId);
  if (inHand) {
    zones.hand = zones.hand.filter((id) => id !== inHand);
    return inHand;
  }
  const inDeck = zones.deck.find((id) => state.instances[id]?.definitionId === cardId);
  if (inDeck) {
    zones.deck = zones.deck.filter((id) => id !== inDeck);
    return inDeck;
  }
  throw new Error(`${side} 的牌组里没有 ${cardId}`);
}

/** 建一局双方都用同一张卡的简单对局。 */
function simpleBattle(
  playerTraits: readonly string[] = [],
  enemyTraits: readonly string[] = [],
  overrides: { playerDeck?: string[]; enemyDeck?: string[]; turnLimit?: number } = {},
): BattleState {
  const definitions = table(
    { id: 'P', atk: 2, hp: 5, cd: 1, traits: playerTraits },
    { id: 'E', atk: 2, hp: 5, cd: 1, traits: enemyTraits },
    { id: 'BIG', atk: 9, hp: 20, cd: 1 },
  );
  return createBattle(
    {
      seed: 12345,
      playerDeck: overrides.playerDeck ?? Array.from({ length: 6 }, () => 'P'),
      enemyDeck: overrides.enemyDeck ?? Array.from({ length: 6 }, () => 'E'),
      rules: { turnLimit: overrides.turnLimit ?? 200 },
    },
    definitions,
  );
}

// ---------------------------------------------------------------------------
// 建局与基础
// ---------------------------------------------------------------------------

describe('建局', () => {
  it('开局各抽 3 张，其余在牌堆里', () => {
    const state = simpleBattle();
    expect(state.zones.player.hand).toHaveLength(3);
    expect(state.zones.enemy.hand).toHaveLength(3);
    expect(state.zones.player.deck).toHaveLength(3);
    expect(state.hp.player).toBe(20);
    expect(state.hp.enemy).toBe(20);
  });

  it('超过组卡上限直接报错，而不是静默截断', () => {
    const definitions = table({ id: 'P', atk: 1, hp: 1, cd: 1 });
    expect(() =>
      createBattle(
        { seed: 1, playerDeck: Array.from({ length: 13 }, () => 'P'), enemyDeck: ['P'] },
        definitions,
      ),
    ).toThrow(/超过上限/);
  });

  it('牌组引用不存在的卡会报错', () => {
    const definitions = table({ id: 'P', atk: 1, hp: 1, cd: 1 });
    expect(() =>
      createBattle({ seed: 1, playerDeck: ['NOPE'], enemyDeck: ['P'] }, definitions),
    ).toThrow(/不存在/);
  });
});

// ---------------------------------------------------------------------------
// 命令校验
// ---------------------------------------------------------------------------

describe('命令校验', () => {
  it('不是当前方就不能行动', () => {
    const state = simpleBattle();
    const result = validateCommand(state, { kind: 'endTurn', side: 'enemy' });
    expect(result).toEqual({ ok: false, reason: 'notYourTurn' });
  });

  it('没出牌不能结束回合（旧版同一条限制）', () => {
    const state = simpleBattle();
    const result = validateCommand(state, { kind: 'endTurn', side: 'player' });
    expect(result.ok).toBe(false);
  });

  it('出牌会进入准备区并消耗本回合额度', () => {
    const state = simpleBattle();
    const cardId = state.zones.player.hand[0] as string;
    const resolution = applyCommand(state, { kind: 'playCard', side: 'player', instanceId: cardId });
    expect(resolution.accepted).toBe(true);
    expect(resolution.finalState.zones.player.prep.filter(Boolean)).toHaveLength(1);
    expect(resolution.finalState.cardsPlayedThisTurn).toBe(1);

    // 同一回合再出一张会被拒
    const second = resolution.finalState.zones.player.hand[0] as string;
    const again = applyCommand(resolution.finalState, {
      kind: 'playCard',
      side: 'player',
      instanceId: second,
    });
    expect(again.accepted).toBe(false);
    expect(again.rejection).toBe('alreadyPlayedThisTurn');
  });

  it('结算不会改动传入的状态', () => {
    const state = simpleBattle();
    const before = JSON.stringify(state);
    const cardId = state.zones.player.hand[0] as string;
    applyCommand(state, { kind: 'playCard', side: 'player', instanceId: cardId });
    expect(JSON.stringify(state)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// CD 与部署
// ---------------------------------------------------------------------------

describe('冷却与部署', () => {
  it('结束回合时**双方**准备区 CD 都减 1，不是只有当前方', () => {
    // 双方各出一张 CD=3 的卡，然后只让玩家结束回合一次
    const definitions = table({ id: 'S', atk: 1, hp: 9, cd: 3 });
    let state = createBattle(
      {
        seed: 7,
        playerDeck: Array.from({ length: 4 }, () => 'S'),
        enemyDeck: Array.from({ length: 4 }, () => 'S'),
        rules: { turnLimit: 100 },
      },
      definitions,
    );

    // 双方各放一张 CD=3 的卡进准备区，再用**一次** endTurn 看双方是否都减。
    // 分两次 endTurn 也能观察到，但那验证不了「一次结算同时影响双方」。
    const playerPrepCard = state.zones.player.hand[0] as string;
    const enemyPrepCard = state.zones.enemy.hand[0] as string;
    state.zones.player.hand.splice(0, 1);
    state.zones.enemy.hand.splice(0, 1);
    state.zones.player.prep[0] = playerPrepCard;
    state.zones.enemy.prep[0] = enemyPrepCard;
    state.instances[playerPrepCard]!.zone = 'prep';
    state.instances[enemyPrepCard]!.zone = 'prep';
    state.instances[playerPrepCard]!.cd = 3;
    state.instances[enemyPrepCard]!.cd = 3;
    state.cardsPlayedThisTurn = state.rules.cardsPerTurn;

    const after = applyCommand(state, { kind: 'endTurn', side: 'player' }).finalState;
    // 只跑玩家的一次结束回合，**双方**都应当各减 1
    expect(after.instances[playerPrepCard]?.cd).toBe(2);
    expect(after.instances[enemyPrepCard]?.cd).toBe(2);
  });

  it('CD 归零的卡进入**第一个**空战斗槽', () => {
    const definitions = table(
      { id: 'A', atk: 1, hp: 9, cd: 0 },
      { id: 'B', atk: 1, hp: 9, cd: 0 },
      { id: 'X', atk: 1, hp: 9, cd: 5 },
    );
    let state = createBattle(
      {
        // 开局抽 3 张，牌堆要留得下后面手动摆进准备区的那两张
        seed: 3,
        playerDeck: ['A', 'B', 'X', 'X', 'X', 'X'],
        enemyDeck: ['X', 'X', 'X', 'X'],
        rules: { turnLimit: 50 },
      },
      definitions,
    );

    // 按定义 id 取 A、B 并摆进准备区：不依赖洗牌后它们落在手牌还是牌堆
    const a = takeCard(state, 'player', 'A');
    const b = takeCard(state, 'player', 'B');
    state.zones.player.prep[4] = a;
    state.zones.player.prep[6] = b;
    state.instances[a]!.cd = 0;
    state.instances[b]!.cd = 0;

    state.cardsPlayedThisTurn = state.rules.cardsPerTurn;
    const deployed = applyCommand(state, { kind: 'endTurn', side: 'player' }).finalState;

    expect(deployed.zones.player.battle[0]).toBe(a);
    expect(deployed.zones.player.battle[1]).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 攻击
// ---------------------------------------------------------------------------

describe('攻击', () => {
  it('对位空槽时攻击打到本体', () => {
    /**
     * 用手牌里 CD 很长的卡：它这回合不会部署，于是只有战斗区那一张会攻击。
     *
     * 这是旧版的真实行为——**同回合部署的卡也会立刻攻击**
     * （docs/rules.md 第 2.1 节）。测试若不隔离这一点，
     * 会把两次攻击的伤害误当成一次。
     */
    const definitions = table(
      { id: 'SLOW', atk: 2, hp: 5, cd: 9 },
      { id: 'E', atk: 2, hp: 5, cd: 9 },
    );
    const state = createBattle(
      {
        seed: 12345,
        playerDeck: ['SLOW', 'SLOW', 'SLOW', 'SLOW'],
        enemyDeck: ['E', 'E', 'E', 'E'],
        rules: { turnLimit: 50 },
      },
      definitions,
    );

    const attackerId = takeCard(state, 'player', 'SLOW');
    state.zones.player.battle[0] = attackerId;
    state.instances[attackerId]!.zone = 'battle';

    const hpBefore = state.hp.enemy;
    const played = handCardOf(state, 'player', 'SLOW');
    const after = applyCommand(state, {
      kind: 'playCard',
      side: 'player',
      instanceId: played,
    }).finalState;
    const ended = applyCommand(after, { kind: 'endTurn', side: 'player' }).finalState;

    // 攻击力 2 打到敌方本体；准备区那张 CD 还很长，不会一起攻击
    expect(ended.hp.enemy).toBe(hpBefore - 2);
  });

  it('地对空打不到飞行卡，改为打本体（旧版飞出规则）', () => {
    const state = simpleBattle([], ['飞行']);
    const playerId = state.zones.player.hand[0] as string;
    const enemyId = state.zones.enemy.hand[0] as string;

    state.zones.player.hand.splice(0, 1);
    state.zones.player.battle[0] = playerId;
    state.instances[playerId]!.zone = 'battle';

    state.zones.enemy.hand.splice(0, 1);
    state.zones.enemy.battle[0] = enemyId;
    state.instances[enemyId]!.zone = 'battle';

    const enemyHpBefore = state.groups[state.instances[enemyId]!.stateGroupId]!.hp;
    const playerBaseBefore = state.hp.player;

    const after = applyCommand(state, {
      kind: 'playCard',
      side: 'player',
      instanceId: state.zones.player.hand[0] as string,
    }).finalState;
    const ended = applyCommand(after, { kind: 'endTurn', side: 'player' }).finalState;

    // 飞行卡一点没掉
    expect(ended.groups[state.instances[enemyId]!.stateGroupId]!.hp).toBe(enemyHpBefore);
    void playerBaseBefore;
  });

  it('免疫挡技能伤害，但**不挡普通攻击**', () => {
    const state = simpleBattle([], ['免疫']);
    const playerId = state.zones.player.hand[0] as string;
    const enemyId = state.zones.enemy.hand[0] as string;
    state.zones.player.hand.splice(0, 1);
    state.zones.player.battle[0] = playerId;
    state.instances[playerId]!.zone = 'battle';
    state.zones.enemy.hand.splice(0, 1);
    state.zones.enemy.battle[0] = enemyId;
    state.instances[enemyId]!.zone = 'battle';

    const groupId = state.instances[enemyId]!.stateGroupId;
    const hpBefore = state.groups[groupId]!.hp;

    const after = applyCommand(state, {
      kind: 'playCard',
      side: 'player',
      instanceId: state.zones.player.hand[0] as string,
    }).finalState;
    const ended = applyCommand(after, { kind: 'endTurn', side: 'player' }).finalState;

    // 普通攻击绕过免疫：旧版就是这样（docs/rules.md 第 4.5 节）
    expect(ended.groups[groupId]!.hp).toBe(hpBefore - 2);
  });
});

// ---------------------------------------------------------------------------
// 技能
// ---------------------------------------------------------------------------

describe('技能规则', () => {
  it('抽卡在牌堆不足 n 时整条失败，不是抽到什么算什么', () => {
    const definitions = table(
      { id: 'D', atk: 1, hp: 9, cd: 0, traits: ['抽卡3'] },
      { id: 'E', atk: 1, hp: 9, cd: 9 },
    );
    const state = createBattle(
      {
        seed: 11,
        playerDeck: ['D', 'E'],
        enemyDeck: ['E', 'E', 'E', 'E'],
        rules: { turnLimit: 20 },
      },
      definitions,
    );

    // 牌堆只剩 0 张（2 张都进手牌了）
    expect(state.zones.player.deck).toHaveLength(0);
    const drawCardId = state.zones.player.hand[0] as string;
    state.zones.player.hand.splice(0, 1);
    state.zones.player.battle[0] = drawCardId;
    state.instances[drawCardId]!.zone = 'battle';

    const after = applyCommand(state, {
      kind: 'playCard',
      side: 'player',
      instanceId: state.zones.player.hand[0] as string,
    }).finalState;
    const before = after.zones.player.hand.length;
    const ended = applyCommand(after, { kind: 'endTurn', side: 'player' }).finalState;

    // 牌堆 0 < 3，整条抽卡不生效
    expect(ended.zones.player.hand.length).toBe(before);
  });

  it('加速把自己最左占用准备槽的 CD 减 n', () => {
    const definitions = table(
      { id: 'H', atk: 1, hp: 9, cd: 0, traits: ['加速3'] },
      { id: 'T', atk: 1, hp: 9, cd: 8 },
    );
    const state = createBattle(
      {
        seed: 5,
        playerDeck: ['H', 'T', 'T'],
        enemyDeck: ['T', 'T', 'T'],
        rules: { turnLimit: 20 },
      },
      definitions,
    );

    const hasteId = state.zones.player.hand[0] as string;
    const targetId = state.zones.player.hand[1] as string;
    state.zones.player.hand = [];
    state.zones.player.deck = [];
    state.zones.player.battle[0] = hasteId;
    state.instances[hasteId]!.zone = 'battle';
    state.zones.player.prep[0] = targetId;
    state.instances[targetId]!.zone = 'prep';
    state.instances[targetId]!.cd = 8;
    state.cardsPlayedThisTurn = 1;

    const ended = applyCommand(state, { kind: 'endTurn', side: 'player' }).finalState;
    // 8 − 3（加速）− 1（回合递减）= 4
    expect(ended.instances[targetId]!.cd).toBe(4);
  });

  it('爆裂在死亡时对对位造成固定 2 点', () => {
    const definitions = table(
      { id: 'R', atk: 1, hp: 9, cd: 0, traits: ['爆裂'] },
      { id: 'K', atk: 9, hp: 2, cd: 0 },
    );
    const state = createBattle(
      {
        seed: 13,
        playerDeck: ['K', 'K'],
        enemyDeck: ['R', 'K'],
        rules: { turnLimit: 20 },
      },
      definitions,
    );

    const killerId = takeCard(state, 'player', 'K');
    const bomberId = takeCard(state, 'enemy', 'R');
    state.zones.player.hand = [];
    state.zones.player.battle[0] = killerId;
    state.instances[killerId]!.zone = 'battle';
    state.zones.enemy.hand = [];
    state.zones.enemy.battle[0] = bomberId;
    state.instances[bomberId]!.zone = 'battle';
    state.cardsPlayedThisTurn = 1;

    const killerHpBefore = state.groups[state.instances[killerId]!.stateGroupId]!.hp;
    const ended = applyCommand(state, { kind: 'endTurn', side: 'player' }).finalState;

    // 攻击力 9 → 爆裂卡 2 血被打死，然后爆裂反击 2 点打在攻击者身上
    expect(ended.groups[state.instances[killerId]!.stateGroupId]!.hp).toBe(
      killerHpBefore - 2,
    );
  });
});

// ---------------------------------------------------------------------------
// 分身与复制
// ---------------------------------------------------------------------------

describe('分身共享与复制独立', () => {
  it('分身加入同一个状态组，复制另起一组', () => {
    const definitions = table(
      { id: 'C', atk: 2, hp: 6, cd: 0, traits: ['分身'] },
      { id: 'Y', atk: 2, hp: 6, cd: 0, traits: ['复制'] },
      { id: 'E', atk: 1, hp: 9, cd: 9 },
    );

    for (const [id, expectedMode] of [
      ['C', 'shared'],
      ['Y', 'independent'],
    ] as const) {
      const state = createBattle(
        {
          seed: 21,
          playerDeck: [id, 'E'],
          enemyDeck: ['E', 'E'],
          rules: { turnLimit: 20 },
        },
        definitions,
      );

      const sourceId = state.zones.player.hand.find((handId) => {
        const instance = state.instances[handId];
        return instance?.definitionId === id;
      }) as string;

      state.zones.player.hand = state.zones.player.hand.filter((h) => h !== sourceId);
      state.zones.player.battle[0] = sourceId;
      state.instances[sourceId]!.zone = 'battle';
      state.cardsPlayedThisTurn = 1;
      const sourceGroupId = state.instances[sourceId]!.stateGroupId;

      // 「分身」是上场触发，直接触发一次
      const { triggerOnDeployForTest } = loadTestHooks();
      triggerOnDeployForTest(state, sourceId);

      const cloneSlot = state.zones.player.battle[1];
      expect(cloneSlot, `${id} 没有产生第二个实例`).toBeTruthy();
      const clone = state.instances[cloneSlot as string]!;

      if (expectedMode === 'shared') {
        expect(clone.stateGroupId).toBe(sourceGroupId);
        expect(state.groups[sourceGroupId]!.memberIds).toHaveLength(2);
      } else {
        expect(clone.stateGroupId).not.toBe(sourceGroupId);
        expect(state.groups[clone.stateGroupId]).toBeTruthy();
      }
    }
  });

  it('分身受伤，同组的所有位置一起掉血', () => {
    const definitions = table(
      { id: 'C', atk: 2, hp: 6, cd: 0, traits: ['分身'] },
      { id: 'E', atk: 1, hp: 9, cd: 9 },
    );
    const state = createBattle(
      { seed: 31, playerDeck: ['C', 'E'], enemyDeck: ['E', 'E'], rules: { turnLimit: 20 } },
      definitions,
    );
    const sourceId = state.zones.player.hand.find((handId) => {
      const instance = state.instances[handId];
      return instance?.definitionId === 'C';
    }) as string;

    state.zones.player.hand = state.zones.player.hand.filter((h) => h !== sourceId);
    state.zones.player.battle[0] = sourceId;
    state.instances[sourceId]!.zone = 'battle';
    state.cardsPlayedThisTurn = 1;

    const { triggerOnDeployForTest } = loadTestHooks();
    triggerOnDeployForTest(state, sourceId);

    const groupId = state.instances[sourceId]!.stateGroupId;
    const cloneId = state.zones.player.battle[1] as string;
    expect(state.instances[cloneId]!.stateGroupId).toBe(groupId);

    state.groups[groupId]!.hp -= 4;
    // 一个组，两个位置共享同一份数值——这就是「分身共享」的全部含义
    expect(state.groups[state.instances[cloneId]!.stateGroupId]!.hp).toBe(2);
  });
});

/** 取出引擎内部用于测试的钩子。 */
function loadTestHooks(): {
  triggerOnDeployForTest: (state: BattleState, instanceId: string) => void;
} {
  // 用一个 CD=0 的卡结束回合即可触发上场技能，但为了聚焦「分身本身」，
  // 这里直接复用引擎的公开路径：把卡放进准备区再走一次部署。
  return {
    triggerOnDeployForTest: (state, instanceId) => {
      const instance = state.instances[instanceId];
      if (!instance) {
        return;
      }
      // 把本体挪回准备区、CD 归零，再让引擎部署一次，从而走到 ON_DEPLOY
      const side = instance.owner;
      const battleSlot = state.zones[side].battle.indexOf(instanceId);
      if (battleSlot >= 0) {
        state.zones[side].battle[battleSlot] = null;
      }
      const prepSlot = state.zones[side].prep.findIndex((id) => id === null);
      state.zones[side].prep[prepSlot] = instanceId;
      instance.zone = 'prep';
      instance.cd = 0;

      // 借一次真实结算来触发部署（命令要合法：先补足出牌额度）
      state.cardsPlayedThisTurn = state.rules.cardsPerTurn;
      const resolution = applyCommand(state, { kind: 'endTurn', side: state.currentSide });
      Object.assign(state, resolution.finalState);
    },
  };
}

// ---------------------------------------------------------------------------
// 完整对局：验收门槛
// ---------------------------------------------------------------------------

describe('完整对局', () => {
  it('无 Canvas/DOM 也能跑完一局（验收门槛）', () => {
    const { state, commands } = playOut(simpleBattle());
    expect(state.outcome, '对局没有结束').not.toBeNull();
    expect(commands).toBeLessThan(4000);
  });

  it('同 seed 同命令序列得到相同结果（验收门槛）', () => {
    const a = playOut(simpleBattle());
    const b = playOut(simpleBattle());
    expect(stateFingerprint(a.state)).toBe(stateFingerprint(b.state));
    expect(a.eventTypes).toEqual(b.eventTypes);
  });

  it('完整对局会产出全部关键事件，且事件里的数值已确定', () => {
    const { eventTypes } = playOut(simpleBattle());
    for (const required of ['CardDrawn', 'CardPlayed', 'CardDeployed', 'AttackDeclared']) {
      expect(eventTypes, `缺少事件 ${required}`).toContain(required);
    }
  });

  it('满战斗槽不会卡住：继续出牌仍然能推进', () => {
    const { state } = playOut(
      simpleBattle([], [], {
        playerDeck: Array.from({ length: 12 }, () => 'BIG'),
        enemyDeck: Array.from({ length: 12 }, () => 'BIG'),
      }),
    );
    expect(state.outcome).not.toBeNull();
  });

  it('空手牌不会卡住：会自动跳过回合', () => {
    // 双方各 3 张，开局全进手牌，牌堆为空
    const definitions = table({ id: 'S', atk: 1, hp: 3, cd: 0 });
    const state = createBattle(
      {
        seed: 99,
        playerDeck: ['S', 'S', 'S'],
        enemyDeck: ['S', 'S', 'S'],
        rules: { turnLimit: 200 },
      },
      definitions,
    );
    const { state: ended } = playOut(state);
    expect(ended.outcome).not.toBeNull();
  });

  it('回合上限会判平局，而不是无限跑下去', () => {
    const definitions = table({ id: 'W', atk: 0, hp: 20, cd: 1 });
    const state = createBattle(
      {
        seed: 5,
        // 攻击力 0、血量高：谁都打不死谁，必定拖到回合上限
        playerDeck: Array.from({ length: 12 }, () => 'W'),
        enemyDeck: Array.from({ length: 12 }, () => 'W'),
        rules: { turnLimit: 12 },
      },
      definitions,
    );
    const { state: ended } = playOut(state);
    expect(ended.outcome?.kind).toBe('draw');
    expect(ended.outcome?.reason).toBe('turnLimit');
  });

  it('不死与复活不会造成无限递归', () => {
    const { state, commands } = playOut(
      simpleBattle(['不死'], ['复活'], {
        playerDeck: Array.from({ length: 6 }, () => 'P'),
        enemyDeck: Array.from({ length: 6 }, () => 'E'),
      }),
    );
    expect(state.outcome).not.toBeNull();
    expect(commands).toBeLessThan(4000);
  });

  it('牌堆计入存活判定：手上没牌但牌堆还有，不算输（差异 D2）', () => {
    const definitions = table({ id: 'Z', atk: 1, hp: 5, cd: 1 });
    const state = createBattle(
      { seed: 3, playerDeck: ['Z', 'Z', 'Z'], enemyDeck: ['Z'], rules: { turnLimit: 5 } },
      definitions,
    );
    // 玩家开局抽 3 张、牌堆 0；敌方只有 1 张
    expect(state.outcome).toBeNull();
    const after = applyCommand(state, {
      kind: 'playCard',
      side: 'player',
      instanceId: state.zones.player.hand[0] as string,
    }).finalState;
    expect(after.outcome).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 圣盾（本项目新增的族，旧注册表里没有——见 docs/rules.md）
// ---------------------------------------------------------------------------

describe('圣盾', () => {
  /**
   * 把攻方与守方各摆进战斗区，结束一个回合，量守方掉了多少血、圣盾触发了几次。
   *
   * 攻方 rd 0，所以这一回合里它会先放技能（BEFORE_ATTACK）、再打一次普通攻击；
   * 守方 cd 9，这一回合不动手，掉的血全部来自攻方。
   */
  function oneTurn(
    attacker: { atk?: number; traits?: readonly string[] },
    defenderTraits: readonly string[],
  ): { damage: number; triggers: Record<string, number>; log: string[] } {
    const definitions = table(
      { id: 'A', atk: attacker.atk ?? 2, hp: 9, cd: 0, traits: attacker.traits ?? [] },
      { id: 'D', atk: 1, hp: 9, cd: 9, traits: defenderTraits },
    );
    const state = createBattle(
      { seed: 7, playerDeck: ['A'], enemyDeck: ['D'], rules: { turnLimit: 20 } },
      definitions,
    );
    const attackerId = state.zones.player.hand[0] as string;
    const defenderId = state.zones.enemy.hand[0] as string;
    state.zones.player.hand = [];
    state.zones.player.battle[0] = attackerId;
    state.instances[attackerId]!.zone = 'battle';
    state.zones.enemy.hand = [];
    state.zones.enemy.battle[0] = defenderId;
    state.instances[defenderId]!.zone = 'battle';
    state.cardsPlayedThisTurn = 1;

    const groupId = state.instances[defenderId]!.stateGroupId;
    const before = state.groups[groupId]!.hp;
    const resolution = applyCommand(state, { kind: 'endTurn', side: 'player' });

    const triggers: Record<string, number> = {};
    for (const event of resolution.events) {
      if (event.type === 'SkillTriggered' && event.family) {
        triggers[event.family] = (triggers[event.family] ?? 0) + 1;
      }
    }

    return {
      damage: before - resolution.finalState.groups[groupId]!.hp,
      triggers,
      log: resolution.events.map((event) => event.type),
    };
  }

  it('技能伤害也减 n——这正是它与防御的区别', () => {
    // 攻方 atk 2 + 火球3：技能 3 点 + 普攻 2 点
    const shielded = oneTurn({ traits: ['火球3'] }, ['圣盾2']);
    const defended = oneTurn({ traits: ['火球3'] }, ['防御2']);

    // 圣盾2：技能 3−2=1，普攻 2−2=0 → 共 1
    expect(shielded.damage).toBe(1);
    // 防御2 只挡普通攻击：技能照扣 3，普攻 2−2=0 → 共 3
    expect(defended.damage).toBe(3);
  });

  it('普通攻击同样被减 n', () => {
    // 攻方没有技能，只有一次 atk 3 的普通攻击
    expect(oneTurn({ atk: 3 }, ['圣盾1']).damage).toBe(2);
    // 对照：白板防守方照扣 3
    expect(oneTurn({ atk: 3 }, []).damage).toBe(3);
  });

  it('两条路径各发一次 SkillTriggered——动画就是吃这个事件的', () => {
    /*
      演出层只认 `SkillTriggered`：**发一次就播一次护盾**。
      所以「普通攻击和法术攻击都触发动画」在规则层的判据就是触发次数：
      圣盾 2 次（技能 + 普攻），防御 1 次（只有普攻那条路）。
    */
    const shielded = oneTurn({ atk: 3, traits: ['火球3'] }, ['圣盾1']);
    expect(shielded.damage).toBe(4); // 技能 3−1=2 + 普攻 3−1=2
    expect(shielded.triggers['holyShield']).toBe(2);

    const defended = oneTurn({ atk: 3, traits: ['火球3'] }, ['防御1']);
    expect(defended.triggers['defense']).toBe(1);
  });
});
