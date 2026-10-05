import type { CardDefinition, CardInstance, SideId } from '../cards/types';
import {
  battleInstances,
  groupOf,
  isSilenced,
  opponentOf,
  SKILL_RULES,
  traitsOf,
  type AttackState,
  type SkillContext,
} from '../skills/rules';

import { createRng, type Rng } from './rng';
import {
  DEFAULT_BATTLE_RULES,
  type BattleConfig,
  type BattleEvent,
  type BattleEventPayload,
  type BattleEndReason,
  type BattleOutcome,
  type BattleRules,
  type BattleState,
  type Command,
  type CommandValidation,
  type DamageSource,
  type DisplayPatch,
  type Resolution,
  type SideZones,
} from './types';

/**
 * 战斗引擎。
 *
 * 只做规则：不依赖 React、Three.js、DOM 或文件 IO，因此可以在
 * `node` 环境的单元测试里跑完整局（P2 的验收门槛）。
 *
 * 一次行动**一次性算完**，产出 `Resolution(events + patches + finalState)`。
 * 演出层按事件顺序播放、在命中节点应用 patch，但它不重新决定任何数值
 * （旧版把伤害写在动画回调里，是整个重写要消除的东西，见 `docs/rules.md` 第 9 节）。
 *
 * 顺序基线（`docs/rules.md` 第 2 节）：
 *
 *   出牌/结束回合 → 胜负预检 → 双方 CD 递减 → 部署 → 上场技能
 *   → 当前方从左到右攻击 → 死亡与死亡技能 → 槽位整理 → 胜负 → 换边
 */

/** 卡牌定义表。引擎自包含，不依赖外部数据库。 */
export type DefinitionTable = Readonly<Record<string, CardDefinition>>;

// ---------------------------------------------------------------------------
// 建局
// ---------------------------------------------------------------------------

function emptyZones(rules: BattleRules): SideZones {
  return {
    deck: [],
    hand: [],
    prep: Array.from({ length: rules.prepSlots }, () => null),
    battle: Array.from({ length: rules.battleSlots }, () => null),
    discard: [],
  };
}

/** 建一局。牌组里允许重复，重复的每一张都是独立实例。 */
export function createBattle(
  config: BattleConfig,
  definitions: DefinitionTable,
): BattleState {
  const rules: BattleRules = { ...DEFAULT_BATTLE_RULES, ...config.rules };
  const rng = createRng(config.seed);

  const state: BattleState = {
    rules,
    definitions,
    seed: config.seed,
    rng: rng.snapshot(),
    turnNumber: 1,
    currentSide: 'player',
    phase: 'awaitingPlay',
    hp: { player: rules.baseHp, enemy: rules.baseHp },
    zones: { player: emptyZones(rules), enemy: emptyZones(rules) },
    instances: {},
    groups: {},
    cardsPlayedThisTurn: 0,
    copyUsedThisTurn: { player: false, enemy: false },
    nextEventSeq: 1,
    outcome: null,
    stateHistory: [],
  };

  let counter = 0;
  const instantiate = (cardId: string, side: SideId): string => {
    counter += 1;
    const instanceId = `${side[0]}${counter}`;
    const definition = definitions[cardId];
    if (!definition) {
      throw new Error(`牌组引用了不存在的卡牌：${cardId}`);
    }
    state.instances[instanceId] = {
      instanceId,
      definitionId: cardId,
      owner: side,
      zone: 'deck',
      slotIndex: -1,
      stateGroupId: `g${instanceId}`,
      cd: definition.cd,
      flying: definition.rawTraits.includes('飞行'),
      hasAttackedThisTurn: false,
      marks: {
        undyingUsed: false,
        revivedUsed: false,
        skillImmune: definition.rawTraits.includes('免疫'),
        silenced: false,
      },
    };
    state.groups[`g${instanceId}`] = {
      groupId: `g${instanceId}`,
      owner: side,
      hp: definition.hp,
      maxHp: definition.hp,
      atk: definition.atk,
      memberIds: [instanceId],
      deathHandled: false,
    };
    return instanceId;
  };

  // 建实例、组牌堆、洗牌
  for (const side of ['player', 'enemy'] as const) {
    const cardIds = side === 'player' ? config.playerDeck : config.enemyDeck;
    if (cardIds.length > rules.deckLimit) {
      throw new Error(
        `${side} 的牌组有 ${cardIds.length} 张，超过上限 ${rules.deckLimit}`,
      );
    }
    const ids = cardIds.map((cardId) => instantiate(cardId, side));
    state.zones[side].deck = rng.shuffle(ids);
  }

  // 开局各抽 openingDraw 张
  for (const side of ['player', 'enemy'] as const) {
    for (let i = 0; i < rules.openingDraw; i += 1) {
      drawOne(state, rng, side);
    }
  }

  state.rng = rng.snapshot();
  return state;
}

/** 抽一张牌进手牌。牌堆空则什么也不做。 */
function drawOne(state: BattleState, rng: Rng, side: SideId): string | null {
  const zones = state.zones[side];
  const instanceId = zones.deck.shift();
  if (!instanceId) {
    return null;
  }
  zones.hand.push(instanceId);
  const instance = state.instances[instanceId];
  if (instance) {
    instance.zone = 'hand';
    instance.slotIndex = zones.hand.length - 1;
  }
  void rng;
  return instanceId;
}

// ---------------------------------------------------------------------------
// 深拷贝：一次行动在副本上跑，原始状态不被中途污染
// ---------------------------------------------------------------------------

function cloneState(state: BattleState): BattleState {
  // definitions 是只读的共享表，不参与克隆——否则每步都要复制整张卡表
  const { definitions, ...rest } = state;
  return { definitions, ...(structuredClone(rest) as Omit<BattleState, 'definitions'>) };
}

// ---------------------------------------------------------------------------
// 可用的命令
// ---------------------------------------------------------------------------

/**
 * 这一方现在还有没有合法出牌。
 *
 * 旧版在「手牌为空」或「两个区都满」时会**自动跳过回合**
 * （`BBS:674-683` 与 `SB:145-156`）。新版不自动替玩家做决定，
 * 但必须允许在这种局面下结束回合——否则轮到谁都动不了，整局卡死。
 */
export function hasLegalPlay(state: BattleState, side: SideId): boolean {
  const zones = state.zones[side];
  if (zones.hand.length === 0) {
    return false;
  }
  // 准备区没有空位、且战斗区也满时，出了也放不下
  const hasEmptyPrep = zones.prep.some((id) => id === null);
  const hasEmptyBattle = zones.battle.some((id) => id === null);
  return hasEmptyPrep || hasEmptyBattle;
}

/** 校验一个命令是否当前合法。合法性与演出时长无关。 */
export function validateCommand(state: BattleState, command: Command): CommandValidation {
  if (state.outcome) {
    return { ok: false, reason: 'battleEnded' };
  }
  if (state.phase !== 'awaitingPlay') {
    return { ok: false, reason: 'wrongPhase' };
  }
  if (command.side !== state.currentSide) {
    return { ok: false, reason: 'notYourTurn' };
  }

  if (command.kind === 'endTurn' || command.kind === 'concede') {
    // 旧版必须先出一张才能结束回合（`BBS:566-568`），
    // 但无牌可出时自动跳过（`BBS:674-683`）。这两条一起才不至于卡死。
    if (
      state.cardsPlayedThisTurn < state.rules.cardsPerTurn &&
      hasLegalPlay(state, command.side)
    ) {
      return {
        ok: false,
        reason: 'alreadyPlayedThisTurn',
        detail: '本回合还没出牌',
      };
    }
    return { ok: true };
  }

  if (state.cardsPlayedThisTurn >= state.rules.cardsPerTurn) {
    return { ok: false, reason: 'alreadyPlayedThisTurn' };
  }
  const zones = state.zones[command.side];
  if (!zones.hand.includes(command.instanceId)) {
    return { ok: false, reason: 'cardNotInHand' };
  }
  const slot = command.prepSlot ?? zones.prep.findIndex((id) => id === null);
  if (slot < 0 || slot >= state.rules.prepSlots || zones.prep[slot] !== null) {
    return { ok: false, reason: 'noEmptyPrepSlot' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 结算
// ---------------------------------------------------------------------------

class Resolver {
  readonly events: BattleEvent[] = [];
  readonly patches: DisplayPatch[] = [];
  /** 从状态的 RNG 快照续上，保证同 seed 的取数序列一致。 */
  readonly rng: Rng;

  constructor(private readonly state: BattleState) {
    this.rng = createRng(state.rng.state);
  }

  /**
   * 记录一个事件。
   *
   * 序号由引擎统一分配且只增不减：演出层按序号对齐，
   * 断点续播与同 seed 比对都依赖它稳定。
   */
  emit(event: BattleEventPayload): void {
    const seq = this.state.nextEventSeq;
    this.state.nextEventSeq += 1;
    this.events.push({ ...event, seq, turn: this.state.turnNumber } as BattleEvent);

    // 命中的同一事件配一条显示 patch：界面按命中节点应用，
    // 不能提前把最终 HP 显示出来（PLAN 第 4.1 节）
    if (event.type === 'DamageApplied') {
      this.patches.push({
        atEventSeq: seq,
        kind: 'setHp',
        side: event.side,
        instanceId: event.instanceId,
        value: event.hpAfter,
      });
    } else if (event.type === 'Healed') {
      this.patches.push({
        atEventSeq: seq,
        kind: 'setHp',
        side: event.side,
        instanceId: event.instanceId,
        value: event.hpAfter,
      });
    } else if (event.type === 'PlayerHpChanged') {
      this.patches.push({
        atEventSeq: seq,
        kind: 'setHp',
        side: event.side,
        // 本体没有卡牌实例，用固定 id 表示
        instanceId: '@player',
        value: event.hpAfter,
      });
    } else if (event.type === 'StatChanged') {
      this.patches.push({
        atEventSeq: seq,
        kind: 'setAtk',
        side: event.side,
        instanceId: event.instanceId,
        value: event.to,
      });
    }
  }

  /** 造成伤害。返回实际伤害值。 */
  damage(target: CardInstance, amount: number): number {
    const group = groupOf(this.state, target);
    // 免疫只挡**技能**伤害，普通攻击绕过它（docs/rules.md 第 4.5 节）
    const before = group.hp;
    const dealt = Math.max(0, Math.min(before, amount));
    group.hp = before - dealt;
    this.emit({
      type: 'DamageApplied',
      side: group.owner,
      instanceId: target.instanceId,
      amount: dealt,
      hpBefore: before,
      hpAfter: group.hp,
      source: 'skill',
    });
    return dealt;
  }

  heal(target: CardInstance, amount: number): number {
    const group = groupOf(this.state, target);
    const before = group.hp;
    group.hp = Math.min(group.maxHp, before + amount);
    const healed = group.hp - before;
    if (healed > 0) {
      this.emit({
        type: 'Healed',
        side: group.owner,
        instanceId: target.instanceId,
        amount: healed,
        hpBefore: before,
        hpAfter: group.hp,
      });
    }
    return healed;
  }

  /** 建一个分身 / 复制体实例。 */
  duplicate(source: CardInstance, mode: 'shared' | 'independent', slot: number): void {
    const zones = this.state.zones[source.owner];
    const definition = this.state.definitions[source.definitionId];
    if (!definition) {
      return;
    }
    const instanceId = `${source.instanceId}-d${this.state.nextEventSeq}`;
    const sourceGroup = groupOf(this.state, source);

    const groupId =
      mode === 'shared'
        ? sourceGroup.groupId
        : `${instanceId}-g`;

    if (mode === 'independent') {
      const group = groupOf(this.state, source);
      this.state.groups[groupId] = {
        groupId,
        owner: source.owner,
        // 复制是 deepcopy：独立生命与攻击，取当前值
        hp: group.hp,
        maxHp: group.maxHp,
        atk: group.atk,
        memberIds: [instanceId],
        deathHandled: false,
      };
    } else {
      sourceGroup.memberIds.push(instanceId);
    }

    this.state.instances[instanceId] = {
      instanceId,
      definitionId: source.definitionId,
      owner: source.owner,
      zone: 'battle',
      slotIndex: slot,
      stateGroupId: groupId,
      cd: 0,
      flying: definition.rawTraits.includes('飞行'),
      hasAttackedThisTurn: false,
      marks: {
        undyingUsed: false,
        revivedUsed: false,
        skillImmune: definition.rawTraits.includes('免疫'),
        silenced: false,
      },
    };
    zones.battle[slot] = instanceId;

    this.emit({
      type: 'CloneCreated',
      side: source.owner,
      instanceId,
      groupId,
      battleSlot: slot,
      mode,
    });
  }
}

/** 触发某个卡在某个触发点上的全部技能。 */
function triggerSkills(
  resolver: Resolver,
  state: BattleState,
  instance: CardInstance,
  trigger: 'ON_DEPLOY' | 'BEFORE_ATTACK' | 'ON_DAMAGED' | 'AFTER_DAMAGED' | 'AFTER_ATTACK' | 'ON_DEATH',
  attack: AttackState | null,
  deathSlot: number | null,
): void {
  const definition = state.definitions[instance.definitionId];
  if (!definition) {
    return;
  }

  for (const skill of definition.skills) {
    if (!skill.family) {
      continue;
    }
    // 未识别的 trait 不参与战斗（PLAN 第 4.3 节）
    if (skill.resolution !== 'implemented' && skill.resolution !== 'alias') {
      continue;
    }
    const rule = SKILL_RULES[skill.family];
    if (!rule || rule.trigger !== trigger) {
      continue;
    }

    resolver.emit({
      type: 'SkillTriggered',
      side: instance.owner,
      instanceId: instance.instanceId,
      trigger,
      family: skill.family,
      raw: skill.raw,
      param: skill.param,
    });

    const ctx: SkillContext = {
      state,
      rng: resolver.rng,
      owner: instance.owner,
      self: instance,
      param: skill.param ?? 1,
      attack,
      deathSlot,
      emit: (event) => resolver.emit(event),
      damage: (target, amount, _source: DamageSource) => resolver.damage(target, amount),
      heal: (target, amount) => resolver.heal(target, amount),
      discard: () => undefined,
      placeInPrep: () => false,
      createDuplicate: (source, mode, slot) => resolver.duplicate(source, mode, slot),
    };
    rule.apply(ctx);
  }
}

// ---------------------------------------------------------------------------
// 一次攻击
// ---------------------------------------------------------------------------

function resolveAttack(
  resolver: Resolver,
  state: BattleState,
  attacker: CardInstance,
  attackerSlot: number,
): void {
  const side = attacker.owner;
  const other = opponentOf(side);
  const defenderId = state.zones[other].battle[attackerSlot] ?? null;
  const defender = defenderId ? (state.instances[defenderId] ?? null) : null;

  const group = groupOf(state, attacker);
  if (group.hp <= 0) {
    // 已经死了的不再发起行动（差异记录 D10）
    return;
  }

  const attack: AttackState = {
    attacker,
    defenderSlot: attackerSlot,
    damage: group.atk,
    armorBreak: 0,
    dodged: false,
    dealt: 0,
  };

  // 沉默：对位带「沉默」时，攻击者的技能整份不触发（BBS:1321-1324）
  const silenced = isSilenced(state, side, attackerSlot);
  if (!silenced) {
    triggerSkills(resolver, state, attacker, 'BEFORE_ATTACK', attack, null);
  }

  // 自毁可能把攻击者自己打死；死亡后不再继续这次攻击
  if (groupOf(state, attacker).hp <= 0) {
    return;
  }

  resolver.emit({
    type: 'AttackDeclared',
    side,
    attackerId: attacker.instanceId,
    targetInstanceId: defender?.instanceId ?? null,
    targetSlot: attackerSlot,
  });

  const attackerIsFlying = traitsOf(state, attacker).includes('飞行');

  if (defender && traitsOf(state, defender).includes('飞行') && !attackerIsFlying) {
    // 地对空：**不能伤害飞行卡**，改为把攻击者的原始 atk 打到飞行卡所属方的本体上。
    // 这条路径绕过防御/闪避/免疫（旧版 `BBS:1347-1368` 就是这样，docs/rules.md 第 4.3 节）
    const targetOwner = opponentOf(defender.owner);
    const before = state.hp[targetOwner];
    state.hp[targetOwner] = Math.max(0, before - group.atk);
    resolver.emit({
      type: 'PlayerHpChanged',
      side: targetOwner,
      amount: before - state.hp[targetOwner],
      hpBefore: before,
      hpAfter: state.hp[targetOwner],
      source: 'flyingRedirect',
    });
  } else if (defender) {
    // 正常卡对卡：防御者先跑 ON_DAMAGED（防御/闪避）
    const defenderSilenced = isSilenced(state, other, attackerSlot);
    if (!defenderSilenced) {
      const swapped: AttackState = { ...attack, attacker: defender };
      triggerSkills(resolver, state, defender, 'ON_DAMAGED', swapped, null);
      attack.damage = swapped.damage;
      attack.dodged = swapped.dodged;
    }
    const dealt = resolver.damage(defender, attack.damage);
    attack.dealt = dealt;
  } else {
    // 对位空槽：固定 atk 打本体
    const before = state.hp[other];
    state.hp[other] = Math.max(0, before - group.atk);
    const dealt = before - state.hp[other];
    // 打本体的伤害也要计入「造成伤害」，否则吸血判不出来
    attack.dealt = dealt;
    resolver.emit({
      type: 'PlayerHpChanged',
      side: other,
      amount: dealt,
      hpBefore: before,
      hpAfter: state.hp[other],
      source: 'emptySlot',
    });
  }

  // 受击后：反击只在**确实造成伤害**时触发
  if (defender && attack.dealt > 0 && !isSilenced(state, other, attackerSlot)) {
    const swapped: AttackState = { ...attack, attacker: defender };
    triggerSkills(resolver, state, defender, 'AFTER_DAMAGED', swapped, null);
    attack.dealt = swapped.dealt;
  }

  // 攻击后：吸血 / 受伤 / 狂暴
  if (!silenced && groupOf(state, attacker).hp > 0) {
    triggerSkills(resolver, state, attacker, 'AFTER_ATTACK', attack, null);
  }
}

// ---------------------------------------------------------------------------
// 死亡与整理
// ---------------------------------------------------------------------------

function removeDead(resolver: Resolver, state: BattleState): void {
  const sides: SideId[] = ['player', 'enemy'];

  // 按**状态组**分组：分身共享一份状态，只处理一次
  const deadGroups = new Map<string, { side: SideId; slot: number; members: CardInstance[] }>();

  for (const side of sides) {
    state.zones[side].battle.forEach((instanceId, slot) => {
      if (!instanceId) {
        return;
      }
      const instance = state.instances[instanceId];
      if (!instance) {
        return;
      }
      const group = groupOf(state, instance);
      if (group.hp > 0 || group.deathHandled) {
        return;
      }
      const existing = deadGroups.get(group.groupId);
      if (existing) {
        existing.members.push(instance);
        return;
      }
      deadGroups.set(group.groupId, { side, slot, members: [instance] });
    });
  }

  for (const [, entry] of deadGroups) {
    const primary = entry.members[0];
    if (!primary) {
      continue;
    }
    const group = groupOf(state, primary);
    group.deathHandled = true;

    const side = primary.owner;
    const zones = state.zones[side];

    /**
     * 同组的**全部**实例，以 `group.memberIds` 为准，而不是只看当前战斗区。
     *
     * 分身共享一份状态，但成员可能散在不同区域（比如一个被复活回了准备区）；
     * 只按战斗区收，会漏掉那些成员，留下一个血量已经是 0 却还在场上的残影。
     */
    const collapsed = group.memberIds
      .map((id) => state.instances[id])
      .filter((member): member is CardInstance => member !== undefined);

    resolver.emit({
      type: 'CardDied',
      side,
      instanceId: primary.instanceId,
      groupId: group.groupId,
      collapsedInstanceIds: collapsed.map((member) => member.instanceId),
    });

    // 死亡技能（爆裂）在移出之前触发，对位下标仍然有效
    triggerSkills(resolver, state, primary, 'ON_DEATH', null, entry.slot);

    // 不死 → 回手牌；复活 → 回准备区。
    // 两者都是**死亡后**的处理，且在 ON_DEATH 之后（旧版 `BBS:1883-1887` 同序）
    const traits = traitsOf(state, primary);
    const revived = reviveIfAble(resolver, state, primary, traits);

    // 移出战场并入弃牌堆
    for (const member of collapsed) {
      const battleRow = state.zones[member.owner].battle;
      battleRow.forEach((id, slot) => {
        if (id === member.instanceId) {
          battleRow[slot] = null;
        }
      });
      member.zone = 'discard';
      member.slotIndex = -1;
    }
    if (!revived) {
      zones.discard.push(primary.instanceId);
    }
    group.deathHandled = false;
  }
}

/** 不死 / 复活。返回是否已经复活回场上（回场则不进弃牌堆）。 */
function reviveIfAble(
  resolver: Resolver,
  state: BattleState,
  instance: CardInstance,
  traits: readonly string[],
): boolean {
  const side = instance.owner;
  const zones = state.zones[side];

  if (traits.includes('不死')) {
    // 回**手牌**，旧版没有一次性标记，可以再次抽到再打出
    const group = groupOf(state, instance);
    group.hp = group.maxHp;
    instance.zone = 'hand';
    zones.hand.push(instance.instanceId);
    instance.slotIndex = zones.hand.length - 1;
    resolver.emit({
      type: 'CardMoved',
      side,
      instanceId: instance.instanceId,
      from: 'battle',
      to: 'hand',
      slotIndex: instance.slotIndex,
    });
    return true;
  }

  if (traits.includes('复活') && !instance.marks.revivedUsed) {
    const slot = zones.prep.findIndex((id) => id === null);
    if (slot < 0) {
      // 没有空准备槽就留在弃牌堆（旧版也是静默返回）
      return false;
    }
    const group = groupOf(state, instance);
    group.hp = group.maxHp;
    const definition = state.definitions[instance.definitionId];
    instance.marks.revivedUsed = true;
    instance.cd = definition?.cd ?? 0;
    instance.zone = 'prep';
    instance.slotIndex = slot;
    zones.prep[slot] = instance.instanceId;
    resolver.emit({
      type: 'CardMoved',
      side,
      instanceId: instance.instanceId,
      from: 'battle',
      to: 'prep',
      slotIndex: slot,
    });
    return true;
  }

  return false;
}

/** 把战斗区里的空位向左侧压缩。 */
function compactRow(resolver: Resolver, state: BattleState, side: SideId): void {
  const row = state.zones[side].battle;
  const moves: { instanceId: string; from: number; to: number }[] = [];
  const kept: string[] = [];
  row.forEach((id, slot) => {
    if (id) {
      if (kept.length !== slot) {
        moves.push({ instanceId: id, from: slot, to: kept.length });
      }
      kept.push(id);
    }
  });
  if (moves.length === 0) {
    return;
  }
  for (let i = 0; i < row.length; i += 1) {
    row[i] = kept[i] ?? null;
  }
  for (const move of moves) {
    const instance = state.instances[move.instanceId];
    if (instance) {
      instance.slotIndex = move.to;
    }
  }
  resolver.emit({ type: 'SlotCompacted', side, moves });
}

// ---------------------------------------------------------------------------
// 胜负
// ---------------------------------------------------------------------------

/**
 * 一方是否还有能继续战斗的牌。
 *
 * 旧版只数手牌/准备区/战斗区，**漏掉了剩余牌堆**，于是「手上没牌但牌堆还有」
 * 会被提前判负（`docs/rules.md` 差异记录 D2）。新版把牌堆计入。
 */
function hasCards(state: BattleState, side: SideId): boolean {
  const zones = state.zones[side];
  return (
    zones.hand.length > 0 ||
    zones.prep.some((id) => id !== null) ||
    zones.battle.some((id) => id !== null) ||
    zones.deck.length > 0
  );
}

function checkOutcome(state: BattleState): BattleOutcome | null {
  if (state.outcome) {
    return state.outcome;
  }
  const playerOut = state.hp.player <= 0 || !hasCards(state, 'player');
  const enemyOut = state.hp.enemy <= 0 || !hasCards(state, 'enemy');

  if (playerOut && enemyOut) {
    // 旧版固定判玩家失败；新版改为对称判定（差异记录 D4）
    return { kind: 'draw', reason: 'simultaneous' };
  }
  if (playerOut) {
    return { kind: 'win', winner: 'enemy', reason: outcomeReason(state, 'player') };
  }
  if (enemyOut) {
    return { kind: 'win', winner: 'player', reason: outcomeReason(state, 'enemy') };
  }
  return null;
}

/** 这一方失败的**具体原因**。事件里带上它，界面才能给出准确提示。 */
function outcomeReason(state: BattleState, side: SideId): BattleEndReason {
  return state.hp[side] <= 0 ? 'hpDepleted' : 'noCardsRemaining';
}

// ---------------------------------------------------------------------------
// 回合推进
// ---------------------------------------------------------------------------

function endTurn(resolver: Resolver, state: BattleState): void {
  state.phase = 'resolving';

  // 1. 胜负预检（旧版在 `end_turn` 开头就查，这里保持同序）
  const pre = checkOutcome(state);
  if (pre) {
    state.outcome = pre;
    state.phase = 'ended';
    resolver.emit({ type: 'BattleEnded', outcome: pre });
    return;
  }

  // 2. 双方准备区 CD 各减 1。
  //    **是双方，不是只在当前方回合**（旧版 `BBS:1517`，docs/rules.md 第 3 节）
  for (const side of ['player', 'enemy'] as const) {
    state.zones[side].prep.forEach((instanceId, slot) => {
      if (!instanceId) {
        return;
      }
      const instance = state.instances[instanceId];
      if (!instance || instance.cd <= 0) {
        return;
      }
      const from = instance.cd;
      instance.cd = Math.max(0, instance.cd - 1);
      resolver.emit({
        type: 'CooldownChanged',
        side,
        instanceId,
        from,
        to: instance.cd,
        cause: 'turnTick',
      });
      void slot;
    });
  }

  // 3. 部署：CD 归零的卡进入第一个空战斗槽（从左到右）
  for (const side of ['player', 'enemy'] as const) {
    deployReady(resolver, state, side);
  }

  // 4. 当前方从左到右逐个攻击
  const attacker = state.currentSide;
  const slots = state.zones[attacker].battle.length;
  for (let index = 0; index < slots; index += 1) {
    const instanceId = state.zones[attacker].battle[index];
    if (!instanceId) {
      continue;
    }
    const instance = state.instances[instanceId];
    if (!instance) {
      continue;
    }
    // 已经死掉的不再行动
    if (groupOf(state, instance).hp <= 0) {
      continue;
    }
    resolveAttack(resolver, state, instance, index);
  }

  // 5. 死亡与死亡技能
  removeDead(resolver, state);

  // 6. 槽位整理
  compactRow(resolver, state, 'player');
  compactRow(resolver, state, 'enemy');

  // 7. 胜负
  const post = checkOutcome(state);
  if (post) {
    state.outcome = post;
    state.phase = 'ended';
    resolver.emit({ type: 'BattleEnded', outcome: post });
    return;
  }

  // 8. 回合上限：到点判平局，避免无限循环
  if (state.rules.turnLimit > 0 && state.turnNumber >= state.rules.turnLimit) {
    const draw: BattleOutcome = { kind: 'draw', reason: 'turnLimit' };
    state.outcome = draw;
    state.phase = 'ended';
    resolver.emit({ type: 'BattleEnded', outcome: draw });
    return;
  }

  // 9. 换边
  const next = opponentOf(state.currentSide);
  state.currentSide = next;
  if (next === 'player') {
    state.turnNumber += 1;
  }
  state.cardsPlayedThisTurn = 0;
  state.copyUsedThisTurn = { player: false, enemy: false };
  for (const instance of Object.values(state.instances)) {
    instance.hasAttackedThisTurn = false;
  }

  resolver.emit({ type: 'TurnEnded', side: attacker, nextSide: next });

  // 10. 新回合抽一张
  for (let i = 0; i < state.rules.drawPerTurn; i += 1) {
    const drawn = drawOne(state, resolver.rng, next);
    if (drawn) {
      resolver.emit({
        type: 'CardDrawn',
        side: next,
        instanceId: drawn,
        fromDeckIndex: 0,
      });
    }
  }

  state.phase = 'awaitingPlay';
}

/** 把 CD 归零的卡部署到第一个空战斗槽。 */
function deployReady(resolver: Resolver, state: BattleState, side: SideId): void {
  const zones = state.zones[side];
  for (let prepSlot = 0; prepSlot < zones.prep.length; prepSlot += 1) {
    const instanceId = zones.prep[prepSlot];
    if (!instanceId) {
      continue;
    }
    const instance = state.instances[instanceId];
    if (!instance || instance.cd > 0) {
      continue;
    }
    const battleSlot = zones.battle.findIndex((id) => id === null);
    if (battleSlot < 0) {
      // 战斗区满，留在准备区等下一次
      continue;
    }
    zones.prep[prepSlot] = null;
    zones.battle[battleSlot] = instanceId;
    instance.zone = 'battle';
    instance.slotIndex = battleSlot;
    instance.hasAttackedThisTurn = false;
    resolver.emit({
      type: 'CardDeployed',
      side,
      instanceId,
      battleSlot,
    });
    // 上场技能
    if (!isSilenced(state, side, battleSlot)) {
      triggerSkills(resolver, state, instance, 'ON_DEPLOY', null, null);
    }
  }
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

/**
 * 结算一个命令。
 *
 * 不修改传入的 `state`；返回的 `finalState` 才是权威结果。
 * 命令被拒绝时不产生事件，`accepted` 为 false。
 */
export function applyCommand(state: BattleState, command: Command): Resolution {
  const validation = validateCommand(state, command);
  if (!validation.ok) {
    return {
      events: [],
      patches: [],
      finalState: state,
      accepted: false,
      rejection: validation.reason,
    };
  }

  const working = cloneState(state);
  const resolver = new Resolver(working);

  if (command.kind === 'concede') {
    const outcome: BattleOutcome = {
      kind: 'win',
      winner: opponentOf(command.side),
      reason: 'noCardsRemaining',
    };
    working.outcome = outcome;
    working.phase = 'ended';
    resolver.emit({ type: 'BattleEnded', outcome });
  } else if (command.kind === 'playCard') {
    const zones = working.zones[command.side];
    const from = zones.hand.indexOf(command.instanceId);
    const slot = command.prepSlot ?? zones.prep.findIndex((id) => id === null);
    zones.hand.splice(from, 1);
    zones.prep[slot] = command.instanceId;
    const instance = working.instances[command.instanceId];
    if (instance) {
      instance.zone = 'prep';
      instance.slotIndex = slot;
      // 进入准备区时重新套用卡牌原始 CD（旧版 `CMP:49-50`）
      const definition = working.definitions[instance.definitionId];
      instance.cd = definition?.cd ?? 0;
    }
    working.cardsPlayedThisTurn += 1;
    resolver.emit({
      type: 'CardPlayed',
      side: command.side,
      instanceId: command.instanceId,
      prepSlot: slot,
    });
  } else {
    endTurn(resolver, working);
  }

  working.rng = resolver.rng.snapshot();

  return {
    events: resolver.events,
    patches: resolver.patches,
    finalState: working,
    accepted: true,
  };
}

/**
 * 状态指纹。用于「无进展平局」的重复检测与同 seed 对局比对。
 *
 * 只包含会影响后续走向的字段，不含事件序号之类的记账字段。
 */
export function stateFingerprint(state: BattleState): string {
  return JSON.stringify({
    currentSide: state.currentSide,
    hp: state.hp,
    zones: state.zones,
    groups: Object.values(state.groups)
      .map((group) => [group.groupId, group.hp, group.atk])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
}

/** 供演出与调试读取：某一方战斗区的卡（按槽位）。 */
export function battleRow(state: BattleState, side: SideId): (CardInstance | null)[] {
  return state.zones[side].battle.map((id) => (id ? (state.instances[id] ?? null) : null));
}

export { battleInstances };
