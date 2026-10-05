/**
 * 演出用的显示状态。
 *
 * **权威状态在 `applyCommand` 返回时已经是终态**；显示状态是一份独立的、
 * 落后于它的副本，按事件逐个推进。这样做的理由是 PLAN 第 4.1 节：
 * 「显示状态按命中节点应用对应 patch，不能提前把所有 HP 显示成最终值」。
 *
 * 推进分两种，分别对应两类信息：
 *
 * - **结构**（谁在哪个区、哪个槽）→ 跟着**事件**走（`applyEventToDisplay`）。
 * - **数值**（HP / ATK）→ 跟着**patch** 走（`applyPatchesToDisplay`），
 *   因为 patch 的 `atEventSeq` 就是命中节点。
 *
 * 本文件不 import three / React / DOM，可以在 node 环境里直接测。
 */

import type { BattleState, BattleEvent, DisplayPatch } from '../../domain/battle/types';
import type { SideId } from '../../domain/cards/types';
import type { StatKind } from '../cards/statBadge';

/** 显示状态里的一张卡：只保留身份，不保留数值。 */
export interface DisplayCard {
  readonly definitionId: string;
  /**
   * 所属状态组。
   *
   * HP/ATK 存在**组**上而不是实例上——分身共享同一个组，
   * 因此「分身受伤处处可见」是自动成立的，不需要两处同步（P2 的数据模型决定）。
   */
  readonly stateGroupId: string;
}

/** 组上的可变战斗数值。分身按 `stateGroupId` 共享同一份。 */
export interface DisplayGroup {
  hp: number;
  maxHp: number;
  atk: number;
}

export interface DisplaySide {
  /** 牌堆剩余张数——牌堆是盖着的，只显示数量。 */
  deckCount: number;
  /**
   * 弃牌堆，按先后顺序存 instanceId。
   *
   * 存列表而不是计数，是因为**弃牌区要画出来**：最上面那张是明牌，
   * 得知道它是哪一张。数量由 `discard.length` 得到。
   */
  discard: string[];
  /** 手牌，按顺序存 instanceId。 */
  hand: string[];
  /** 准备区，定长，`null` 表示空槽。 */
  prep: (string | null)[];
  /** 战斗区，定长，`null` 表示空槽。 */
  battle: (string | null)[];
}

/**
 * 离场代理。
 *
 * 规则上已经离场的卡，在它的离场演出播完之前仍要留在画面上——
 * 否则弹体会追向一个已经空掉的槽位（PLAN 第 4.1 节）。
 * 代理的生命周期由演出导演控制（一个普通的 `wait` beat），不由它自己的动画回调决定。
 */
export interface ProxyCard {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly side: SideId;
  /** 它离场前所在的槽位下标。 */
  readonly slotIndex: number;
  /** 那一刻的数值，冻结下来显示。 */
  readonly stats: { readonly atk: number; readonly hp: number; readonly cd: number };
}

export interface DisplayState {
  playerHp: Record<SideId, number>;
  zones: Record<SideId, DisplaySide>;
  /** 身份表：instanceId → 定义与状态组。整局不变。 */
  instances: Record<string, DisplayCard>;
  /** 数值表：stateGroupId → 当前 HP/ATK。 */
  groups: Record<string, DisplayGroup>;
  /** 冷却：instanceId → 剩余回合。CD 是槽位级的，不共享。 */
  cd: Record<string, number>;
  /** 正在播离场演出的卡。 */
  proxies: ProxyCard[];
  /** 刚刚变化过的项，用来给数值徽标加白圈。 */
  emphasised: Record<string, ReadonlySet<StatKind>>;
}

/**
 * 把 `source` 的内容灌进 `target`，**保持 `target` 的对象身份**。
 *
 * 需要它是因为：演出导演在构造时就按引用拿到了显示状态对象，
 * 而「开一局」「取消演出」都要把显示状态整体换成另一份。
 * 直接换对象会让导演还捏着旧的那一份（改了也没人看）。
 */
export function adoptDisplay(target: DisplayState, source: DisplayState): void {
  target.playerHp = source.playerHp;
  target.zones = source.zones;
  target.instances = source.instances;
  target.groups = source.groups;
  target.cd = source.cd;
  target.proxies = [];
  target.emphasised = {};
}

/** 把权威状态整体投影成显示状态。用于开局、取消演出、以及测试里的期望值。 */
export function displayFromState(state: BattleState): DisplayState {
  const instances: Record<string, DisplayCard> = {};
  const groups: Record<string, DisplayGroup> = {};
  const cd: Record<string, number> = {};

  for (const [instanceId, card] of Object.entries(state.instances)) {
    instances[instanceId] = {
      definitionId: card.definitionId,
      stateGroupId: card.stateGroupId,
    };
    cd[instanceId] = card.cd;
  }
  for (const [groupId, group] of Object.entries(state.groups)) {
    groups[groupId] = { hp: group.hp, maxHp: group.maxHp, atk: group.atk };
  }

  return {
    playerHp: { player: state.hp.player, enemy: state.hp.enemy },
    zones: {
      player: sideZonesFromState(state, 'player'),
      enemy: sideZonesFromState(state, 'enemy'),
    },
    instances,
    groups,
    cd,
    proxies: [],
    emphasised: {},
  };
}

function sideZonesFromState(state: BattleState, side: SideId): DisplaySide {
  const zones = state.zones[side];
  return {
    deckCount: zones.deck.length,
    discard: [...zones.discard],
    hand: [...zones.hand],
    prep: [...zones.prep],
    battle: [...zones.battle],
  };
}

/**
 * 补上身份表里还没有的实例。
 *
 * 分身 / 复活这类事件会凭空造出实例，而事件里只有 `instanceId`，
 * 没有 `definitionId` 与 `stateGroupId`。这些是**身份**不是数值，
 * 演出层无从发明，只能从权威状态取一次；数值仍然只按 patch 推进。
 */
export function syncIdentities(display: DisplayState, state: BattleState): void {
  for (const [instanceId, card] of Object.entries(state.instances)) {
    if (!(instanceId in display.instances)) {
      display.instances[instanceId] = {
        definitionId: card.definitionId,
        stateGroupId: card.stateGroupId,
      };
    }
    if (!(instanceId in display.cd)) {
      display.cd[instanceId] = card.cd;
    }
  }
  for (const [groupId, group] of Object.entries(state.groups)) {
    if (!(groupId in display.groups)) {
      display.groups[groupId] = { hp: group.hp, maxHp: group.maxHp, atk: group.atk };
    }
  }
}

/** 取一张卡当前该显示的数值。组上取血量与攻击，冷却按实例取。 */
export function statsOf(
  display: DisplayState,
  instanceId: string,
): { atk: number; hp: number; cd: number } | null {
  const card = display.instances[instanceId];
  if (!card) {
    return null;
  }
  const group = display.groups[card.stateGroupId];
  if (!group) {
    return null;
  }
  return { atk: group.atk, hp: group.hp, cd: display.cd[instanceId] ?? 0 };
}

/**
 * 应用一批 patch。**命中节点就是这里**——HP/ATK 只在这个函数里变。
 *
 * 本体没有卡牌实例，引擎用一个固定 id `@player` 表示。
 */
export function applyPatchesToDisplay(
  display: DisplayState,
  patches: readonly DisplayPatch[],
): void {
  for (const patch of patches) {
    if (patch.kind === 'setHp' || patch.kind === 'setAtk') {
      const value = patch.value;
      if (value === undefined) {
        continue;
      }
      if (patch.instanceId === PLAYER_SENTINEL) {
        if (patch.kind === 'setHp') {
          display.playerHp[patch.side] = value;
        }
        continue;
      }
      const card = display.instances[patch.instanceId];
      if (!card) {
        continue;
      }
      const group = display.groups[card.stateGroupId];
      if (!group) {
        continue;
      }
      if (patch.kind === 'setHp') {
        group.hp = value;
        markEmphasised(display, patch.instanceId, 'hp');
      } else {
        group.atk = value;
        markEmphasised(display, patch.instanceId, 'atk');
      }
    }
  }
}

/** 本体的固定 id，与引擎 `emit()` 里写的一致。 */
export const PLAYER_SENTINEL = '@player';

function markEmphasised(display: DisplayState, instanceId: string, stat: StatKind): void {
  const existing = display.emphasised[instanceId];
  const next = new Set<StatKind>(existing ?? []);
  next.add(stat);
  display.emphasised[instanceId] = next;
  // 同组的分身一起高亮：数值本来就是一个
  const groupId = display.instances[instanceId]?.stateGroupId;
  if (groupId) {
    for (const [otherId, card] of Object.entries(display.instances)) {
      if (otherId !== instanceId && card.stateGroupId === groupId) {
        const other = new Set<StatKind>(display.emphasised[otherId] ?? []);
        other.add(stat);
        display.emphasised[otherId] = other;
      }
    }
  }
}

export function clearEmphasis(display: DisplayState): void {
  display.emphasised = {};
}

/** 推进一件**结构**上的变化。数值一律不走这里。 */
export function applyEventToDisplay(display: DisplayState, event: BattleEvent): void {
  switch (event.type) {
    case 'CardDrawn': {
      const side = display.zones[event.side];
      side.hand.push(event.instanceId);
      side.deckCount = Math.max(0, side.deckCount - 1);
      break;
    }

    case 'CardPlayed': {
      const side = display.zones[event.side];
      removeFromList(side.hand, event.instanceId);
      if (event.prepSlot >= 0 && event.prepSlot < side.prep.length) {
        side.prep[event.prepSlot] = event.instanceId;
      }
      break;
    }

    case 'CardDeployed': {
      const side = display.zones[event.side];
      clearSlot(side.prep, event.instanceId);
      if (event.battleSlot >= 0 && event.battleSlot < side.battle.length) {
        side.battle[event.battleSlot] = event.instanceId;
      }
      break;
    }

    case 'CloneCreated': {
      const side = display.zones[event.side];
      if (event.battleSlot >= 0 && event.battleSlot < side.battle.length) {
        side.battle[event.battleSlot] = event.instanceId;
      }
      break;
    }

    case 'CardMoved': {
      const side = display.zones[event.side];
      // 先从原处拿掉（含从弃牌堆列表里摘掉），再放到新处。
      // 还魂会把牌从弃牌堆捞回手牌，漏掉摘除这一步弃牌堆就只增不减。
      removeFromZone(side, event.instanceId);
      adjustCount(side, event.from, -1);
      placeInZone(side, event.to, event.slotIndex, event.instanceId);
      break;
    }

    case 'CooldownChanged': {
      display.cd[event.instanceId] = event.to;
      break;
    }

    case 'CardDied': {
      const side = display.zones[event.side];
      // `collapsedInstanceIds` 是整组的成员，**包含** primary 自己。
      // 分身共享一份状态，所以整组只死一次、只弃一张牌。
      for (const id of event.collapsedInstanceIds) {
        const slotIndex = indexOfInBoard(side, id);
        if (slotIndex !== null) {
          pushProxy(display, id, event.side, slotIndex);
        }
        removeFromZone(side, id);
      }
      // 弃牌数不在这里 +1：不死/复活同样会发 `CardDied`，但那张牌不进弃牌堆。
      // 真正进堆时引擎会补一条 `CardMoved → discard`，由上面那个分支计数。
      break;
    }

    case 'SlotCompacted': {
      const side = display.zones[event.side];
      // 整理是「把有牌的槽向左压实」，事件里的 `moves` 只列**真正挪动了**的卡，
      // 没挪的不在里面——照着 moves 逐条搬会误清空那些没动的槽。
      // 直接按显示状态自己的这一行压实，结果与引擎一致，也不必去读终态。
      const kept = side.battle.filter((id): id is string => id !== null);
      for (let i = 0; i < side.battle.length; i += 1) {
        side.battle[i] = kept[i] ?? null;
      }
      break;
    }

    // 这些事件没有结构变化：数值走 patch，回合与胜负由会话层读权威状态
    case 'BattleStarted':
    case 'SkillTriggered':
    case 'AttackDeclared':
    case 'DamageApplied':
    case 'Healed':
    case 'StatChanged':
    case 'PlayerHpChanged':
    case 'TurnEnded':
    case 'BattleEnded':
      break;
  }
}

function pushProxy(
  display: DisplayState,
  instanceId: string,
  side: SideId,
  slotIndex: number,
): void {
  const card = display.instances[instanceId];
  if (!card) {
    return;
  }
  const stats = statsOf(display, instanceId) ?? { atk: 0, hp: 0, cd: 0 };
  display.proxies.push({
    instanceId,
    definitionId: card.definitionId,
    side,
    slotIndex,
    stats,
  });
}

function removeFromList(list: string[], value: string): void {
  const at = list.indexOf(value);
  if (at >= 0) {
    list.splice(at, 1);
  }
}

function clearSlot(list: (string | null)[], value: string): void {
  const at = list.indexOf(value);
  if (at >= 0) {
    list[at] = null;
  }
}

function indexOfInBoard(side: DisplaySide, instanceId: string): number | null {
  const inBattle = side.battle.indexOf(instanceId);
  if (inBattle >= 0) {
    return inBattle;
  }
  const inPrep = side.prep.indexOf(instanceId);
  return inPrep >= 0 ? inPrep : null;
}

function removeFromZone(side: DisplaySide, instanceId: string): void {
  removeFromList(side.hand, instanceId);
  removeFromList(side.discard, instanceId);
  clearSlot(side.prep, instanceId);
  clearSlot(side.battle, instanceId);
}

function placeInZone(
  side: DisplaySide,
  zone: 'deck' | 'hand' | 'prep' | 'battle' | 'discard',
  slotIndex: number,
  instanceId: string,
): void {
  switch (zone) {
    case 'hand':
      side.hand.push(instanceId);
      break;
    case 'prep':
      if (slotIndex >= 0 && slotIndex < side.prep.length) {
        side.prep[slotIndex] = instanceId;
      }
      break;
    case 'battle':
      if (slotIndex >= 0 && slotIndex < side.battle.length) {
        side.battle[slotIndex] = instanceId;
      }
      break;
    case 'discard':
      // 进弃牌堆要记下是哪一张——弃牌区画的是最上面那张明牌
      side.discard.push(instanceId);
      break;
    // 牌堆是盖着的，只有数量
    case 'deck':
      break;
  }
}

/** 牌堆的计数增减。弃牌堆存的是列表，由 `placeInZone` 维护。 */
function adjustCount(
  side: DisplaySide,
  zone: 'deck' | 'hand' | 'prep' | 'battle' | 'discard',
  delta: number,
): void {
  if (zone === 'deck') {
    side.deckCount = Math.max(0, side.deckCount + delta);
  }
}

/**
 * 把显示状态投影成一个可比较的字符串。
 *
 * 刻意**不含** `proxies` 与 `emphasised`——那两样是纯演出，不进规则对照。
 * 等价性测试拿它与「权威状态的投影」比。
 *
 * `cd` 必须在里面：冷却也是会变的数值，而且它的变化路径和 HP 不同
 * （走 `CooldownChanged` 事件而不是 patch），漏掉就没人看着它。
 */
export function projectDisplay(display: DisplayState): string {
  const groupHp: Record<string, [number, number, number]> = {};
  for (const [groupId, group] of Object.entries(display.groups)) {
    groupHp[groupId] = [group.hp, group.maxHp, group.atk];
  }
  return JSON.stringify({
    playerHp: display.playerHp,
    zones: display.zones,
    groups: groupHp,
    cd: display.cd,
  });
}
