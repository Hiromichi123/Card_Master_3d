import type { AttackStatusKind, CardInstance, CombatStateGroup, SideId } from '../cards/types';
import type { BattleEventPayload, BattleState, DamageSource } from '../battle/types';
import type { Rng } from '../battle/rng';

/**
 * 35 个技能族的规则实现。
 *
 * 逐族的机制来源与证据见 `docs/SKILL_COVERAGE.md`，触发时机与顺序见 `docs/rules.md`。
 * 这里只写**纯数据改动**：不碰场景、不碰渲染、不 sleep、不依赖动画回调，
 * 因此可以在没有 Canvas/DOM 的环境里跑完整局（P2 的验收门槛）。
 *
 * 与旧版的关键区别（`docs/rules.md` 的差异记录）：
 * - 旧版把「技能伤害」写在动画的命中回调里，这里改成规则层按固定顺序一次算完；
 * - 旧版 `_resolve_owner` 在拿不到施法者时会静默兜底成 `enemy`（给错一方加血），
 *   这里一律用显式的 `owner` 字段，拿不到就报错；
 * - 旧版用 `id(card_data)` 给分身分组，这里用 `stateGroupId`。
 */

/** 一次攻击在结算过程中的可变状态。由引擎持有，技能只读写它。 */
export interface AttackState {
  /** 攻击者。 */
  attacker: CardInstance;
  /** 防御者所在槽位下标；对位空槽时为 null。 */
  defenderSlot: number | null;
  /** 当前伤害值。防御/闪避/破甲都在改它。 */
  damage: number;
  /** 攻击者施加的破甲量，会被防御消耗。 */
  armorBreak: number;
  /** 本次攻击是否被闪避掉。 */
  dodged: boolean;
  /** 实际造成的伤害（含 0）。 */
  dealt: number;
  /** Ordinary damage remaining after mitigation minus target HP before that hit. */
  overflow?: number;
  rawAtk?: number;
  hitCard?: boolean;
}

/** 技能执行上下文。 */
export interface SkillContext {
  readonly state: BattleState;
  readonly rng: Rng;
  /** 施法者所在的一方。一律显式给出，不做兜底推断。 */
  readonly owner: SideId;
  /** 技能所属的卡。 */
  readonly self: CardInstance;
  /** 参数 n。 */
  readonly param: number;
  /** 仅攻击相关触发点有值。 */
  readonly attack: AttackState | null;
  /** 记录一个事件（序号与回合由引擎补）。 */
  emit(event: BattleEventPayload): void;
  /** 对某个实例造成伤害，返回实际值。 */
  damage(target: CardInstance, amount: number, source: DamageSource): number;
  /** 治疗某个实例，返回实际值。 */
  heal(target: CardInstance, amount: number): number;
  /** 把一个实例移入弃牌堆（不走死亡流程）。 */
  discard(instance: CardInstance): void;
  /** 从手牌之外的区域找一个空槽放入。 */
  placeInPrep(instance: CardInstance): boolean;
  /**
   * 创建一张分身 / 复制体。
   *
   * 实例 id 的分配权在引擎手里（它保证唯一、并按顺序记事件），
   * 所以技能只表达意图，真正建实例由引擎做。
   */
  createDuplicate(
    source: CardInstance,
    mode: 'shared' | 'independent',
    battleSlot: number,
  ): void;
  /** 死亡触发时的对位槽位下标；仅 `ON_DEATH` 有值。 */
  readonly deathSlot: number | null;
  /** New rules use engine-owned primitives so deaths/ordinary hit reactions stay atomic. */
  readonly summonCard?: (definitionId: string) => void;
  readonly kill?: (target: CardInstance) => void;
  readonly grantAttackStatus?: (target: CardInstance, kind: AttackStatusKind, level: number) => void;
  readonly grantDodge?: (target: CardInstance, level: number) => void;
  /** Transfer actual ally HP to self, without mitigation or free healing. */
  readonly drainAlly?: (donor: CardInstance, amount: number) => number;
  readonly physicalAttack?: (target: CardInstance, amount: number) => void;
  readonly damagePlayer?: (side: SideId, amount: number, source: DamageSource) => number;
  /** Reflected single-target spells return to their original caster. */
  readonly reflectedTarget?: CardInstance | undefined;
}

// ---------------------------------------------------------------------------
// 查询辅助
// ---------------------------------------------------------------------------

/** 某方战斗区里的实例，按槽位从左到右。 */
export function battleInstances(
  state: BattleState,
  side: SideId,
): { instance: CardInstance; slot: number }[] {
  const row = state.zones[side].battle;
  const out: { instance: CardInstance; slot: number }[] = [];
  row.forEach((instanceId, slot) => {
    if (!instanceId) {
      return;
    }
    const instance = state.instances[instanceId];
    if (instance) {
      out.push({ instance, slot });
    }
  });
  return out;
}

/** 某方战斗区里的全部实例。 */
export function battleCards(state: BattleState, side: SideId): CardInstance[] {
  return battleInstances(state, side).map((entry) => entry.instance).filter((card) => isBattleActive(state, card));
}

/** 状态组。战斗中的可变数值都存在这里。 */
export function groupOf(state: BattleState, instance: CardInstance): CombatStateGroup {
  const group = state.groups[instance.stateGroupId];
  if (!group) {
    throw new Error(`实例 ${instance.instanceId} 的状态组 ${instance.stateGroupId} 不存在`);
  }
  return group;
}

/** HP-zero unyielding units remain fully operational until their scheduled departure. */
export function isBattleActive(state: BattleState, instance: CardInstance): boolean {
  const group = groupOf(state, instance);
  return instance.zone === 'battle' && (group.hp > 0 || group.unyielding?.active === true || instance.marks.deploymentCast === true);
}

/** 对手一方。 */
export function opponentOf(side: SideId): SideId {
  return side === 'player' ? 'enemy' : 'player';
}

/** 对位槽位下标：两侧都是同下标（旧版 `BBS:609`）。 */
export function oppositeIndex(index: number): number {
  return index;
}

/** 某方的准备区里第一个被占用的槽位下标，没有则 -1。 */
export function firstOccupiedPrep(state: BattleState, side: SideId): number {
  return state.zones[side].prep.findIndex((id) => id !== null);
}

/** 某方准备区里第一个空槽下标，没有则 -1。 */
export function firstEmptyPrep(state: BattleState, side: SideId): number {
  return state.zones[side].prep.findIndex((id) => id === null);
}

/** 某方战斗区里第一个空槽下标，没有则 -1。 */
export function firstEmptyBattle(state: BattleState, side: SideId): number {
  return state.zones[side].battle.findIndex((id) => id === null);
}

/** 卡牌定义上的 trait 列表。 */
export function traitsOf(state: BattleState, instance: CardInstance): readonly string[] {
  const definition = state.definitions[instance.definitionId];
  if (!definition) {
    throw new Error(`卡牌定义 ${instance.definitionId} 不存在`);
  }
  return definition.rawTraits;
}

/** 沉默：对位槽位当前占用者带「沉默」时，本方该槽的技能不触发。 */
export function isSilenced(state: BattleState, side: SideId, slot: number): boolean {
  const oppositeRow = state.zones[opponentOf(side)].battle;
  const oppositeId = oppositeRow[oppositeIndex(slot)] ?? null;
  if (!oppositeId) {
    return false;
  }
  const opposite = state.instances[oppositeId];
  return opposite ? traitsOf(state, opposite).includes('沉默') : false;
}

// ---------------------------------------------------------------------------
// 规则表
// ---------------------------------------------------------------------------

/** 一个技能族在某触发点上的规则。 */
export interface SkillRule {
  /** 触发点。与 `SkillTrigger` 对应。 */
  readonly trigger:
    | 'ON_DEPLOY'
    | 'OWN_TURN'
    | 'BEFORE_ATTACK'
    | 'ON_DAMAGED'
    | 'AFTER_DAMAGED'
  | 'AFTER_TARGETED_ATTACK'
    | 'AFTER_ATTACK'
    | 'ON_DEATH';
  apply(ctx: SkillContext): void;
}

/** 取敌方战斗区的全部实例。 */
function enemiesInBattle(ctx: SkillContext): CardInstance[] {
  return battleCards(ctx.state, opponentOf(ctx.owner));
}

/** 取己方战斗区的全部实例。 */
function alliesInBattle(ctx: SkillContext): CardInstance[] {
  return battleCards(ctx.state, ctx.owner);
}

/** 对随机一个敌人造成 n 点技能伤害。 */
function hitRandomEnemy(ctx: SkillContext): void {
  const enemies = enemiesInBattle(ctx);
  if (enemies.length === 0) {
    return;
  }
  ctx.damage(ctx.reflectedTarget ?? ctx.rng.pick(enemies), ctx.param, 'skill');
}

/** Authored slash hits the current aligned unit; an empty slot does not hit the base. */
function hitAlignedWithSlash(ctx: SkillContext, trueDamage: boolean): void {
  const slot = ctx.attack?.defenderSlot ?? ctx.self.slotIndex;
  const targetId = ctx.state.zones[opponentOf(ctx.owner)].battle[slot];
  const target = ctx.reflectedTarget ?? (targetId ? ctx.state.instances[targetId] : undefined);
  if (target?.zone === 'battle' && isBattleActive(ctx.state, target)) {
    ctx.damage(target, ctx.param, trueDamage ? 'trueDamage' : 'skill');
  }
}

function hitAllWithSlash(ctx: SkillContext, trueDamage: boolean): void {
  for (const target of enemiesInBattle(ctx).filter((card) => isBattleActive(ctx.state, card))) {
    ctx.damage(target, ctx.param, trueDamage ? 'trueDamage' : 'skill');
  }
}

/** 对全部敌人造成 n 点技能伤害。 */
function hitAllEnemies(ctx: SkillContext): void {
  for (const enemy of enemiesInBattle(ctx)) {
    ctx.damage(enemy, ctx.param, 'skill');
  }
}

/** 治疗一个目标，返回实际治疗量。 */
function healTarget(ctx: SkillContext, target: CardInstance, amount: number): number {
  return ctx.heal(target, amount);
}

/** 受伤的友方（当前 HP < 上限）。 */
function woundedAllies(ctx: SkillContext): CardInstance[] {
  return alliesInBattle(ctx).filter((card) => {
    const group = groupOf(ctx.state, card);
    return group.hp < group.maxHp;
  });
}

/** Hostile spells are intercepted as one whole cast, including every target of group spells. */
export const OFFENSIVE_SPELL_FAMILIES = new Set([
  'fireball', 'iceSeal', 'lightning', 'groupFireball', 'groupIceSeal', 'groupLightning',
  'bombard', 'groupBombard', 'explodeOnDeath', 'curse', 'delay', 'instantDeath', 'slash', 'groupSlash', 'teleport', 'groupDelay', 'severeFrost', 'burning', 'venom', 'bleeding', 'grievousWound', 'poisonCloud',
  // Sword dance is direct HP loss across mechanisms, so it is not a reflectable spell.
]);

function retaliatoryStatus(kind: AttackStatusKind): SkillRule {
  return { trigger: 'AFTER_TARGETED_ATTACK', apply: (ctx) => {
    const target = ctx.reflectedTarget ?? ctx.attack?.attacker;
    if (target && isBattleActive(ctx.state, target)) ctx.grantAttackStatus?.(target, kind, ctx.param);
  } };
}

export const SKILL_RULES: Record<string, SkillRule> = {
  concealment: { trigger: 'ON_DEPLOY', apply: () => undefined },
  firstStrike: { trigger: 'ON_DEPLOY', apply: () => undefined },
  vanguard: { trigger: 'ON_DEPLOY', apply: () => undefined },
  devour: { trigger: 'BEFORE_ATTACK', apply(ctx) {
    const side=opponentOf(ctx.owner);
    const ids=ctx.state.zones[side].discard.splice(0);
    for(const id of ids){const card=ctx.state.instances[id];if(card)card.marks.devoured=true;}
    if(ids.length>0)ctx.emit({type:'DiscardDevoured',side,casterId:ctx.self.instanceId,instanceIds:ids});
  } },
  masterpiece: { trigger: 'ON_DEPLOY', apply: (ctx) => ctx.summonCard?.('A+_006') },
  // The engine rolls once before emitting SkillTriggered, so failed rolls have no kill animation.
  lethalStrike: { trigger: 'BEFORE_ATTACK', apply(ctx) {
    const id=ctx.state.zones[opponentOf(ctx.owner)].battle[ctx.attack?.defenderSlot??ctx.self.slotIndex];
    const target=id?ctx.state.instances[id]:undefined;
    if(target&&isBattleActive(ctx.state,target)&&groupOf(ctx.state,target).hp>0)ctx.kill?.(target);
  } },
  severeFrost: retaliatoryStatus('frost'),
  burning: retaliatoryStatus('burn'),
  venom: retaliatoryStatus('poison'),
  bleeding: retaliatoryStatus('bleed'),
  grievousWound: retaliatoryStatus('grievous'),
  poisonCloud: { trigger: 'BEFORE_ATTACK', apply: (ctx) => {
    const enemies = enemiesInBattle(ctx);
    if (enemies.length === 0 || ctx.param < 1) return;
    const target = ctx.reflectedTarget ?? ctx.rng.pick(enemies);
    ctx.damage(target, ctx.rng.int(1, ctx.param), 'skill');
    ctx.grantAttackStatus?.(target, 'poison', ctx.param);
  } },
  splash: { trigger: 'AFTER_ATTACK', apply: (ctx) => {
    if (!ctx.attack?.hitCard || ctx.attack.defenderSlot === null) return;
    const amount = Math.floor((ctx.attack.rawAtk ?? groupOf(ctx.state, ctx.self).atk) / 2);
    if (amount <= 0) return;
    const row = ctx.state.zones[opponentOf(ctx.owner)].battle;
    for (const slot of [ctx.attack.defenderSlot - 1, ctx.attack.defenderSlot + 1]) {
      const id = row[slot]; const target = id ? ctx.state.instances[id] : undefined;
      if (target && isBattleActive(ctx.state, target)) ctx.physicalAttack?.(target, amount);
    }
  } },
  groupDelay: { trigger: 'BEFORE_ATTACK', apply: (ctx) => {
    const side = opponentOf(ctx.owner);
    ctx.state.zones[side].prep.forEach((id, slot) => {
      if (id) adjustPrepCooldown(ctx, side, slot, ctx.param, 'skill');
    });
  } },
  groupPiercing: { trigger: 'BEFORE_ATTACK', apply: (ctx) => {
    for (let i = 0; i < 5; i++) ctx.damagePlayer?.(opponentOf(ctx.owner), ctx.param, 'groupPiercing');
  } },
  criticalCollapse: { trigger: 'AFTER_ATTACK', apply: (ctx) => {
    if ((ctx.attack?.overflow ?? 0) > 0) ctx.damage(ctx.self, ctx.attack!.overflow!, 'collapse');
  } },
  // The actual lethal-hit interception is engine-owned, including true damage and direct kills.
  unyielding: { trigger: 'ON_DEPLOY', apply: () => undefined },
  sacrifice: {
    trigger: 'OWN_TURN',
    apply(ctx) {
      const selfGroup = groupOf(ctx.state, ctx.self);
      let remaining = Math.min(ctx.param, Math.max(0, selfGroup.maxHp - selfGroup.hp));
      if (remaining <= 0) return;
      const seen = new Set<string>();
      const donors = alliesInBattle(ctx).filter((card) => {
        if (card.stateGroupId === ctx.self.stateGroupId || seen.has(card.stateGroupId) || groupOf(ctx.state, card).hp <= 0) return false;
        seen.add(card.stateGroupId);
        return true;
      });
      for (const donor of ctx.rng.shuffle(donors)) {
        if (remaining <= 0 || selfGroup.hp >= selfGroup.maxHp) break;
        remaining -= ctx.drainAlly?.(donor, remaining) ?? 0;
      }
    },
  },
  execute: {
    trigger: 'BEFORE_ATTACK',
    apply(ctx) {
      if (ctx.state.currentSide !== ctx.owner) return;
      const id = ctx.state.zones[opponentOf(ctx.owner)].battle[ctx.attack?.defenderSlot ?? ctx.self.slotIndex];
      const target = id ? ctx.state.instances[id] : undefined;
      if (target && isBattleActive(ctx.state, target) && groupOf(ctx.state, target).hp < groupOf(ctx.state, ctx.self).hp) {
        ctx.kill?.(target);
      }
    },
  },
  teleport: {
    trigger: 'OWN_TURN',
    apply(ctx) {
      const side = opponentOf(ctx.owner);
      const row = ctx.state.zones[side].battle;
      const entries = battleInstances(ctx.state, side).filter(({ instance }) => isBattleActive(ctx.state, instance));
      if (entries.length < 2) return;
      const original = entries.map(({ instance }) => instance.instanceId);
      const shuffled = ctx.rng.shuffle([...original]);
      // Avoid a visible no-op without unbounded random retries.
      if (shuffled.every((id, index) => id === original[index])) {
        const offset = ctx.rng.int(1, shuffled.length - 1);
        shuffled.push(...shuffled.splice(0, offset));
      }
      entries.forEach(({ slot }, index) => {
        const id = shuffled[index]!;
        row[slot] = id;
        ctx.state.instances[id]!.slotIndex = slot;
      });
      ctx.emit({ type: 'FormationShuffled', side, casterId: ctx.self.instanceId, order: [...row] });
    },
  },
  slash: { trigger: 'BEFORE_ATTACK', apply: (ctx) => hitAlignedWithSlash(ctx, false) },
  groupSlash: { trigger: 'BEFORE_ATTACK', apply: (ctx) => hitAllWithSlash(ctx, false) },
  swordDance: { trigger: 'BEFORE_ATTACK', apply: (ctx) => hitAlignedWithSlash(ctx, true) },
  groupSwordDance: { trigger: 'BEFORE_ATTACK', apply: (ctx) => hitAllWithSlash(ctx, true) },
  instantDeath: { trigger: 'BEFORE_ATTACK', apply: (ctx) => {
    const enemies = enemiesInBattle(ctx).filter((card) => isBattleActive(ctx.state, card));
    if (enemies.length > 0) ctx.kill?.(ctx.reflectedTarget ?? ctx.rng.pick(enemies));
  } },
  spellReflect: { trigger: 'ON_DEPLOY', apply: () => undefined },
  grantDodge: { trigger: 'BEFORE_ATTACK', apply: (ctx) => {
    const allies = alliesInBattle(ctx).filter((card) => isBattleActive(ctx.state, card));
    const others = allies.filter((card) => card.instanceId !== ctx.self.instanceId);
    const choices = others.length > 0 ? others : allies;
    if (choices.length > 0) ctx.grantDodge?.(ctx.rng.pick(choices), ctx.param);
  } },
  groupPhysicalDamage: { trigger: 'BEFORE_ATTACK', apply: (ctx) => {
    for (const enemy of enemiesInBattle(ctx).filter((card) => isBattleActive(ctx.state, card))) {
      ctx.physicalAttack?.(enemy, ctx.param);
    }
  } },
  ranged: { trigger: 'BEFORE_ATTACK', apply: () => undefined },
  piercing: { trigger: 'BEFORE_ATTACK', apply: (ctx) => { ctx.damagePlayer?.(opponentOf(ctx.owner), ctx.param, 'piercing'); } },
  directDamage: { trigger: 'BEFORE_ATTACK', apply: (ctx) => {
    const enemies = enemiesInBattle(ctx).filter((card) => isBattleActive(ctx.state, card));
    if (enemies.length > 0) ctx.physicalAttack?.(ctx.rng.pick(enemies), ctx.param);
  } },
  // ---- 元素（6）----------------------------------------------------------
  // 冰封与闪电的**规则**和火球完全相同，只造成伤害。
  // 旧版就是这样（docs/SKILL_COVERAGE.md 第 3 节），不额外发明冻结或麻痹机制。
  fireball: { trigger: 'BEFORE_ATTACK', apply: hitRandomEnemy },
  iceSeal: { trigger: 'BEFORE_ATTACK', apply: hitRandomEnemy },
  lightning: { trigger: 'BEFORE_ATTACK', apply: hitRandomEnemy },
  groupFireball: { trigger: 'BEFORE_ATTACK', apply: hitAllEnemies },
  groupIceSeal: { trigger: 'BEFORE_ATTACK', apply: hitAllEnemies },
  groupLightning: { trigger: 'BEFORE_ATTACK', apply: hitAllEnemies },

  // ---- 爆破（3）----------------------------------------------------------
  bombard: { trigger: 'BEFORE_ATTACK', apply: hitRandomEnemy },
  groupBombard: { trigger: 'BEFORE_ATTACK', apply: hitAllEnemies },
  explodeOnDeath: {
    trigger: 'ON_DEATH',
    apply(ctx) {
      const side = opponentOf(ctx.owner);
      const enemies = enemiesInBattle(ctx).filter((card) => isBattleActive(ctx.state, card));
      if (enemies.length > 0) {
        for (const target of enemies) ctx.damage(target, ctx.param, 'skill');
      }
      else {
        const before = ctx.state.hp[side];
        const amount = Math.max(0, Math.min(before, ctx.param));
        ctx.state.hp[side] = before - amount;
        ctx.emit({ type: 'PlayerHpChanged', side, amount, hpBefore: before,
          hpAfter: ctx.state.hp[side], source: 'deathBlast' });
      }
    },
  },

  // ---- 牌堆与准备区（5）--------------------------------------------------
  drawCard: {
    trigger: 'BEFORE_ATTACK',
    apply(ctx) {
      const zones = ctx.state.zones[ctx.owner];
      // 旧版：牌堆不足 n 时**整条效果失败**，不是抽到什么算什么
      if (zones.deck.length < ctx.param) {
        return;
      }
      for (let i = 0; i < ctx.param; i += 1) {
        const instanceId = zones.deck.shift();
        if (!instanceId) {
          break;
        }
        zones.hand.push(instanceId);
        const instance = ctx.state.instances[instanceId];
        if (instance) {
          instance.zone = 'hand';
          instance.slotIndex = zones.hand.length - 1;
        }
        ctx.emit({
          type: 'CardDrawn',
          side: ctx.owner,
          instanceId,
          fromDeckIndex: 0,
        });
      }
    },
  },

  soulReturn: {
    trigger: 'BEFORE_ATTACK',
    apply(ctx) {
      const zones = ctx.state.zones[ctx.owner];
      if (zones.discard.length < ctx.param) {
        return;
      }
      for (let i = 0; i < ctx.param; i += 1) {
        const instanceId = zones.discard.pop();
        if (!instanceId) {
          break;
        }
        const instance = ctx.state.instances[instanceId];
        if (!instance) {
          continue;
        }
        // 回到手牌，重置一次性标记
        instance.marks.revivedUsed = false;
        instance.marks.undyingUsed = false;
        instance.zone = 'hand';
        zones.hand.push(instanceId);
        instance.slotIndex = zones.hand.length - 1;
        ctx.emit({
          type: 'CardMoved',
          side: ctx.owner,
          instanceId,
          from: 'discard',
          to: 'hand',
          slotIndex: instance.slotIndex,
        });
      }
    },
  },

  haste: {
    trigger: 'BEFORE_ATTACK',
    apply(ctx) {
      const slot = firstOccupiedPrep(ctx.state, ctx.owner);
      if (slot < 0) {
        return;
      }
      adjustPrepCooldown(ctx, ctx.owner, slot, -ctx.param, 'skill');
    },
  },

  delay: {
    trigger: 'BEFORE_ATTACK',
    apply(ctx) {
      const side = opponentOf(ctx.owner);
      const slot = firstOccupiedPrep(ctx.state, side);
      if (slot < 0) {
        return;
      }
      adjustPrepCooldown(ctx, side, slot, ctx.param, 'skill');
    },
  },

  selfDestruct: {
    trigger: 'ON_DEPLOY',
    apply(ctx) {
      // The deployment pipeline defers this rule until the one-use action has
      // completed, then processes death immediately to free the battle slot.
      const group = groupOf(ctx.state, ctx.self);
      const before = group.hp;
      group.hp = 0;
      ctx.emit({
        type: 'DamageApplied',
        side: ctx.owner,
        instanceId: ctx.self.instanceId,
        amount: before,
        hpBefore: before,
        hpAfter: 0,
        source: 'selfInflicted',
      });
    },
  },

  // ---- 增益与弱化（6）----------------------------------------------------
  blessing: {
    trigger: 'BEFORE_ATTACK',
    apply(ctx) {
      const allies = alliesInBattle(ctx);
      if (allies.length === 0) {
        return;
      }
      // 优先非自身，没有别的友方才给自己
      const others = allies.filter((card) => card.instanceId !== ctx.self.instanceId);
      const target = ctx.rng.pick(others.length > 0 ? others : allies);
      buffCard(ctx, target, ctx.param, true);
    },
  },

  groupBlessing: {
    trigger: 'BEFORE_ATTACK',
    apply(ctx) {
      for (const ally of alliesInBattle(ctx)) {
        buffCard(ctx, ally, ctx.param, true);
      }
    },
  },

  inspire: {
    trigger: 'ON_DEPLOY',
    apply(ctx) {
      const allies = alliesInBattle(ctx);
      if (allies.length === 0) {
        return;
      }
      // 与祝福的差别：**含自身**，且只加 ATK 不加 HP
      buffCard(ctx, ctx.rng.pick(allies), ctx.param, false);
    },
  },

  groupInspire: {
    trigger: 'ON_DEPLOY',
    apply(ctx) {
      for (const ally of alliesInBattle(ctx)) {
        buffCard(ctx, ally, ctx.param, false);
      }
    },
  },

  curse: {
    trigger: 'BEFORE_ATTACK',
    apply(ctx) {
      const defenderSlot = ctx.attack?.defenderSlot ?? null;
      if (defenderSlot === null) {
        return;
      }
      const defenderId = ctx.state.zones[opponentOf(ctx.owner)].battle[defenderSlot];
      if (!defenderId) {
        return;
      }
      const defender = ctx.state.instances[defenderId];
      if (!defender) {
        return;
      }
      const group = groupOf(ctx.state, defender);
      // 已经是 0 就失败，不记负值
      if (group.atk <= 0) {
        return;
      }
      const next = Math.max(0, group.atk - ctx.param);
      ctx.emit({
        type: 'StatChanged',
        side: group.owner,
        instanceId: defender.instanceId,
        stat: 'atk',
        from: group.atk,
        to: next,
        cause: 'curse',
      });
      group.atk = next;
    },
  },

  armorBreak: {
    trigger: 'BEFORE_ATTACK',
    apply(ctx) {
      const attack = ctx.attack;
      if (!attack || attack.defenderSlot === null) {
        return;
      }
      const defenderId =
        ctx.state.zones[opponentOf(ctx.owner)].battle[attack.defenderSlot];
      if (!defenderId) {
        return;
      }
      const defender = ctx.state.instances[defenderId];
      // 旧版只在防御者确实有防御 trait 时才记破甲（skill_effects.py:402-404）
      if (!defender || !hasFamily(ctx.state, defender, 'defense')) {
        return;
      }
      attack.armorBreak = Math.max(attack.armorBreak, ctx.param);
    },
  },

  // ---- 防御与治疗（5）----------------------------------------------------
  defense: {
    trigger: 'ON_DAMAGED',
    apply(ctx) {
      const attack = ctx.attack;
      if (!attack) {
        return;
      }
      // 先减去破甲，再按剩余值减伤
      const effective = Math.max(0, ctx.param - attack.armorBreak);
      attack.damage = Math.max(0, attack.damage - effective);
    },
  },

  /**
   * 圣盾n（本项目新增的族，旧注册表里没有——见 `docs/rules.md` 第 13 节）。
   *
   * 与防御的区别就一条：**技能伤害一样挡**。防御只在「卡打卡」那条路上触发
   * （引擎的 ON_DAMAGED 只由 `resolveAttack` 发），而圣盾还会被技能伤害路径
   * 叫起来一次（`Resolver.damage` 里只挑这一个族，见那里的注释）。
   * 减伤量固定 n，不参与破甲——破甲n 只在对位有防御时才会被记下来
   * （见上面的 `armorBreak` 规则），所以它对圣盾本来就不生效。
   *
   * 触发点用 `ON_DAMAGED` 是有意的：那条路上引擎会发 `SkillTriggered`，
   * 演出层据此播护盾特效——所以「普通攻击和法术攻击都触发动画」不是另写的，
   * 是这条规则被两条路径各叫一次的自然结果。
   */
  holyShield: {
    trigger: 'ON_DAMAGED',
    apply(ctx) {
      const attack = ctx.attack;
      if (!attack) {
        return;
      }
      attack.damage = Math.max(0, attack.damage - ctx.param);
    },
  },

  healAlly: {
    trigger: 'BEFORE_ATTACK',
    apply(ctx) {
      const wounded = woundedAllies(ctx);
      if (wounded.length === 0) {
        return;
      }
      const others = wounded.filter((card) => card.instanceId !== ctx.self.instanceId);
      const target = ctx.rng.pick(others.length > 0 ? others : wounded);
      healTarget(ctx, target, ctx.param);
    },
  },

  groupHeal: {
    trigger: 'BEFORE_ATTACK',
    apply(ctx) {
      for (const ally of woundedAllies(ctx)) {
        healTarget(ctx, ally, ctx.param);
      }
    },
  },

  selfHeal: {
    trigger: 'BEFORE_ATTACK',
    apply(ctx) {
      const group = groupOf(ctx.state, ctx.self);
      // 满血时失败
      if (group.hp >= group.maxHp) {
        return;
      }
      healTarget(ctx, ctx.self, ctx.param);
    },
  },

  vampire: {
    trigger: 'AFTER_ATTACK',
    apply(ctx) {
      // 只有在这次攻击**确实造成了伤害**之后才回血，且回的是固定 n 而不是伤害量
      if (!ctx.attack || ctx.attack.dealt <= 0) {
        return;
      }
      healTarget(ctx, ctx.self, ctx.param);
    },
  },

  // ---- 攻击后与受击后（5）------------------------------------------------
  injury: {
    trigger: 'AFTER_ATTACK',
    apply(ctx) {
      // 攻击后自己掉血，可以把自己打死
      ctx.damage(ctx.self, ctx.param, 'selfInflicted');
    },
  },

  counter: {
    trigger: 'AFTER_DAMAGED',
    apply(ctx) {
      const attack = ctx.attack;
      if (!attack || attack.dealt <= 0) {
        return;
      }
      // 反击走技能伤害管线，因此**会被免疫挡下**（docs/rules.md 第 4.5 节）
      ctx.damage(attack.attacker, ctx.param, 'counter');
    },
  },

  dodge: {
    trigger: 'ON_DAMAGED',
    apply(ctx) {
      const attack = ctx.attack;
      if (!attack) {
        return;
      }
      // 旧版公式（skill_effects.py:683-708）：0.9 − 0.6 · 0.5^(lvl−1)
      // 1 级 0.3、2 级 0.6、3 级 0.75，向上渐近 0.9
      const probability = 0.9 - 0.6 * 0.5 ** (Math.max(1, ctx.param, ctx.self.marks.grantedDodge ?? 0) - 1);
      if (ctx.rng.chance(probability)) {
        attack.damage = 0;
        attack.dodged = true;
      }
    },
  },

  // These properties are maintained by the engine; no active skill dispatch or animation.
  berserk: { trigger: 'ON_DEPLOY', apply: () => undefined },
  antiAir: { trigger: 'ON_DEPLOY', apply: () => undefined },
  groupGround: { trigger: 'ON_DEPLOY', apply: () => undefined },
  siege: { trigger: 'ON_DEPLOY', apply: () => undefined },

  // ---- 单位复制（2）------------------------------------------------------
  clone: {
    trigger: 'ON_DEPLOY',
    apply(ctx) {
      const side = ctx.owner;
      const slot = firstEmptyBattle(ctx.state, side);
      if (slot < 0) {
        return;
      }
      // 共享状态组：新实例加入**同一个组**，而不是复制一份状态
      ctx.createDuplicate(ctx.self, 'shared', slot);
    },
  },

  copy: {
    trigger: 'BEFORE_ATTACK',
    apply(ctx) {
      const side = ctx.owner;
      // 旧版每方每回合只能用一次（battle_base_scene.py:542-558）
      if (ctx.state.copyUsedThisTurn[side]) {
        return;
      }
      const slot = firstEmptyBattle(ctx.state, side);
      if (slot < 0) {
        return;
      }
      ctx.state.copyUsedThisTurn[side] = true;
      // 独立状态组：新实例另起一组，HP/ATK 都与本体分开
      ctx.createDuplicate(ctx.self, 'independent', slot);
    },
  },

  // ---- 特殊（5）——规则在引擎的位置/伤害管线里，这里不重复实现 -------------
  silence: { trigger: 'ON_DEPLOY', apply: () => undefined },
  immunity: { trigger: 'ON_DEPLOY', apply: () => undefined },
  // 不死与复活的真正逻辑在引擎的死亡处理里（回手牌 / 回准备区）
  undying: { trigger: 'ON_DEATH', apply: () => undefined },
  rebirth: { trigger: 'ON_DEATH', apply: () => undefined },
};

/** 调整准备区槽位的 CD。 */
function adjustPrepCooldown(
  ctx: SkillContext,
  side: SideId,
  slot: number,
  delta: number,
  cause: 'skill',
): void {
  const instanceId = ctx.state.zones[side].prep[slot];
  if (!instanceId) {
    return;
  }
  const instance = ctx.state.instances[instanceId];
  if (!instance) {
    return;
  }
  const from = instance.cd;
  const to = Math.max(0, instance.cd + delta);
  instance.cd = to;
  ctx.emit({
    type: 'CooldownChanged',
    side,
    instanceId,
    from,
    to,
    cause,
  });
}

/** 给一张卡加 ATK（以及可选的 HP）。 */
function buffCard(
  ctx: SkillContext,
  target: CardInstance,
  amount: number,
  withHp: boolean,
): void {
  const group = groupOf(ctx.state, target);
  const nextAtk = group.atk + amount;
  ctx.emit({
    type: 'StatChanged',
    side: group.owner,
    instanceId: target.instanceId,
    stat: 'atk',
    from: group.atk,
    to: nextAtk,
    cause: 'blessing',
  });
  group.atk = nextAtk;

  if (withHp) {
    // 祝福同时提高当前 HP 与上限——上限是 readonly，所以只加当前值，
    // 并允许它暂时高于上限（旧版也是直接加 hp）
    const before = group.hp;
    group.hp = group.hp + amount;
    ctx.emit({
      type: 'Healed',
      side: group.owner,
      instanceId: target.instanceId,
      amount,
      hpBefore: before,
      hpAfter: group.hp,
    });
  }
}

/** 这张卡是否带某个族的 trait。 */
export function hasFamily(
  state: BattleState,
  instance: CardInstance,
  family: string,
): boolean {
  const definition = state.definitions[instance.definitionId];
  if (!definition) {
    return false;
  }
  return definition.skills.some(
    (skill) =>
      skill.family === family &&
      (skill.resolution === 'implemented' || skill.resolution === 'alias'),
  );
}
