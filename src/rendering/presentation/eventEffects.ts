/**
 * 规则事件 → 特效请求。
 *
 * 这一层的纪律（PLAN 第 4.1 节）：**只读事件里已经确定的目标与数值**，
 * 不重新随机、不自己扣血。事件里没有目标的那几种（`SkillTriggered`），
 * 目标由它**后面**的伤害/治疗事件反推——那些是引擎已经定好的结果，
 * 不是演出层的选择。
 *
 * 不 import three / React。`EffectRequest` 与 `EffectTemplateId` 都是纯类型导入，
 * 编译后不产生运行时依赖。
 */

import type { BattleEvent } from '../../domain/battle/types';
import type { SideId } from '../../domain/cards/types';
import type { EffectRequest } from '../effects/effectDirector';
import { FAMILY_TO_EFFECT } from '../effects/familyMap';
import type { SlotZone } from '../battle/layout';
import {
  CAST_OFFSET,
  CAST_Y,
  IMPACT_Y,
  PLAYER_ANCHOR_Y,
  PLAYER_ANCHOR_Z,
} from './constants';

/** 本体在事件里的固定 id，与引擎 `emit()` 里写的一致。 */
const PLAYER_SENTINEL = '@player';

export type Point = readonly [number, number, number];

export interface EffectContext {
  /** 某个实例此刻在世界里的位置。按 beat 构建期的显示状态解析。 */
  readonly worldPointOf: (instanceId: string) => Point;
  /** 某个槽位中心的世界坐标。`slotIndex` 是**每侧**下标。 */
  readonly slotPointOf: (side: SideId, zone: SlotZone, slotIndex: number) => Point;
  /** 某一方本体的位置（打本体、本体掉血时的落点）。 */
  readonly playerAnchor: (side: SideId) => Point;
  /** 同一次结算里的全部事件，用于向后推导目标。 */
  readonly events: readonly BattleEvent[];
  /** 当前事件在 `events` 里的下标。 */
  readonly index: number;
}

export type EffectPlayRequest = Omit<EffectRequest, 'id'>;

/**
 * 卡是平放在台面上的，卡牌组的原点就在台面高度，
 * 所以命中点贴在 y=IMPACT_Y 而不是卡的中心高度——
 * 模板自己会算抛物线弧度，喂给它台面高度才有正确的轨迹。
 */
export function impactPointOf(point: Point): Point {
  return [point[0], IMPACT_Y, point[2]];
}

/** 施法起点：在卡的上方、朝施法者自己那一侧偏出一点，轨迹才有高度差。 */
export function castPointOf(point: Point, side: SideId): Point {
  const toward = side === 'player' ? CAST_OFFSET : -CAST_OFFSET;
  return [point[0], CAST_Y, point[2] + toward];
}

export function playerAnchorPoint(side: SideId): Point {
  return [0, PLAYER_ANCHOR_Y, side === 'player' ? PLAYER_ANCHOR_Z : -PLAYER_ANCHOR_Z];
}

function oppositeOf(side: SideId): SideId {
  return side === 'player' ? 'enemy' : 'player';
}

/**
 * `SkillTriggered` 的目标推导。
 *
 * 这个事件本身不带目标（目标是技能结算时才知道的）。往后读到下一个
 * 「另一个技能 / 一次攻击 / 回合结束」为止，取这一段里的伤害、治疗、数值变更事件的目标。
 *
 * **不要在 `CardDied` 停**：`ON_DEATH`（例如爆裂）的伤害发在 `CardDied` 之后，
 * 在那里截断会把爆炸的伤害目标整段漏掉。
 */
export function targetsOf(context: EffectContext): TargetRef[] {
  const { events, index } = context;
  const targets: TargetRef[] = [];

  for (let i = index + 1; i < events.length; i += 1) {
    const next = events[i];
    if (!next) {
      break;
    }
    if (
      next.type === 'SkillTriggered' ||
      next.type === 'AttackDeclared' ||
      next.type === 'TurnEnded' ||
      next.type === 'BattleEnded'
    ) {
      break;
    }
    if (
      next.type === 'DamageApplied' ||
      next.type === 'Healed' ||
      next.type === 'StatChanged'
    ) {
      targets.push({ instanceId: next.instanceId, side: next.side });
    } else if (next.type === 'PlayerHpChanged') {
      targets.push({ instanceId: PLAYER_SENTINEL, side: next.side });
    }
  }

  // 同一个目标被打了两次（例如技能 + 余波）时只画一次
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.instanceId)) {
      return false;
    }
    seen.add(target.instanceId);
    return true;
  });
}

/** 一个被技能影响到的对象。本体用 `@player` 表示，因此需要带上它属于哪一方。 */
export interface TargetRef {
  readonly instanceId: string;
  readonly side: SideId;
}

function pointFor(target: TargetRef, context: EffectContext): Point {
  if (target.instanceId === PLAYER_SENTINEL) {
    return context.playerAnchor(target.side);
  }
  return impactPointOf(context.worldPointOf(target.instanceId));
}

/**
 * 映射表。
 *
 * 返回 `null` 表示「这个事件不播特效」——它仍然会占一个 beat、
 * 仍然会推进显示状态，只是画面上没有东西。
 */
export function effectRequestFor(
  event: BattleEvent,
  context: EffectContext,
): EffectPlayRequest | null {
  switch (event.type) {
    case 'SkillTriggered': {
      const template = event.family ? FAMILY_TO_EFFECT[event.family] : undefined;
      if (!template) {
        return null;
      }
      const from = castPointOf(context.worldPointOf(event.instanceId), event.side);
      // 打自己身上的技能（治疗、祝福）不该朝别处飞，所以把自身排除掉
      const targets = targetsOf(context).filter(
        (target) => target.instanceId !== event.instanceId,
      );
      const points = targets.map((target) => pointFor(target, context));
      const [first, ...rest] = points;
      return {
        template,
        from,
        // 没有可辨认的目标时落在自己身上：宁可原地起手，也不要朝世界原点乱飞
        to: first ?? from,
        extraTargets: rest,
        intensity: event.param ?? 1,
      };
    }

    case 'AttackDeclared': {
      const from = castPointOf(context.worldPointOf(event.attackerId), event.side);
      return {
        template: 'normalAttack',
        from,
        to: event.targetInstanceId
          ? impactPointOf(context.worldPointOf(event.targetInstanceId))
          : context.playerAnchor(oppositeOf(event.side)),
        intensity: 1,
      };
    }

    case 'PlayerHpChanged': {
      // 通常紧跟在自己那一方的攻击或技能之后（那一下已经播过了），只在没有前导时补一个
      const previous = context.events[context.index - 1];
      const alreadyPlayed =
        previous !== undefined &&
        (previous.type === 'AttackDeclared' || previous.type === 'SkillTriggered');
      if (alreadyPlayed) {
        return null;
      }
      return {
        template: 'normalAttack',
        from: context.playerAnchor(oppositeOf(event.side)),
        to: context.playerAnchor(event.side),
        intensity: 1,
      };
    }

    case 'Healed': {
      const point = impactPointOf(context.worldPointOf(event.instanceId));
      return { template: 'heal', from: point, to: point, intensity: 1 };
    }

    case 'StatChanged': {
      const point = impactPointOf(context.worldPointOf(event.instanceId));
      return {
        template: event.to >= event.from ? 'buff' : 'debuff',
        from: point,
        to: point,
        intensity: 1,
      };
    }

    case 'CardPlayed': {
      // 从手牌位飞向准备槽。此刻显示状态还没搬这张牌，所以起手点仍是手牌位。
      return {
        template: 'flow',
        from: impactPointOf(context.worldPointOf(event.instanceId)),
        to: impactPointOf(context.slotPointOf(event.side, 'prep', event.prepSlot)),
        intensity: 1,
      };
    }

    case 'CardDeployed': {
      return {
        template: 'flow',
        from: impactPointOf(context.worldPointOf(event.instanceId)),
        to: impactPointOf(context.slotPointOf(event.side, 'battle', event.battleSlot)),
        intensity: 1,
      };
    }

    case 'CardDied': {
      const point = impactPointOf(context.worldPointOf(event.instanceId));
      return { template: 'status', from: point, to: point, intensity: 1 };
    }

    default:
      return null;
  }
}

/**
 * 事件类型 → 中文日志。
 *
 * HUD 的日志条既给玩家看，也是「命中画面与数值变化一致」这条验收
 * 在浏览器用例里可读的证据。不产生日志的事件返回 `null`。
 */
export function logLineFor(event: BattleEvent, nameOf: (id: string) => string): string | null {
  switch (event.type) {
    case 'CardPlayed':
      return `${nameOf(event.instanceId)} 进入准备区`;
    case 'CardDeployed':
      return `${nameOf(event.instanceId)} 上场`;
    case 'SkillTriggered':
      return `${nameOf(event.instanceId)} 触发 ${event.raw}`;
    case 'AttackDeclared':
      return `${nameOf(event.attackerId)} 发起攻击`;
    case 'DamageApplied':
      return `${nameOf(event.instanceId)} 受到 ${event.amount} 点伤害（${event.hpBefore} → ${event.hpAfter}）`;
    case 'Healed':
      return `${nameOf(event.instanceId)} 回复 ${event.amount} 点生命（${event.hpBefore} → ${event.hpAfter}）`;
    case 'StatChanged':
      return `${nameOf(event.instanceId)} 攻击力 ${event.from} → ${event.to}`;
    case 'PlayerHpChanged':
      return `${event.side === 'player' ? '我方' : '敌方'}本体 ${event.hpBefore} → ${event.hpAfter}`;
    case 'CardDied':
      return `${nameOf(event.instanceId)} 阵亡`;
    case 'TurnEnded':
      return event.nextSide === 'player' ? '轮到我方' : '轮到敌方';
    case 'BattleEnded':
      return event.outcome.kind === 'win'
        ? `${event.outcome.winner === 'player' ? '我方' : '敌方'}获胜`
        : '平局';
    case 'CloneCreated':
      return `${nameOf(event.instanceId)} 分身出现`;
    case 'CardDrawn':
      return `${nameOf(event.instanceId)} 抽到手中`;
    default:
      return null;
  }
}
