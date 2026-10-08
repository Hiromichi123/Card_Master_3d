/**
 * 演出导演。
 *
 * 把一次 `Resolution`（引擎**已经算完**的事件与 patch）翻译成一串按时序播放的
 * 「beat」，并在播放过程中推进显示状态（PLAN 第 4.1 节的三层结构里中间那层）。
 *
 * 三条纪律：
 *
 * 1. **显式状态只在 beat 的 `onComplete` 里变**。`Timeline.skipToEnd()` 会给
 *    每个未完成的步骤补发 `onUpdate(1)` 与 `onComplete`，所以「跳过」自动等价于
 *    「正常播完」——这不是额外机制，而是把状态变更放在唯一的那个回调里得到的性质。
 * 2. **世界坐标在 `onStart` 里解析**。`onStart` 跑在本步 `onComplete` 之前、
 *    上一步之后，此刻的显示状态正是这张卡「还在原处」的那一帧。
 *    在构建期一次性解析是错的：同一次结算里 `CardPlayed` 之后紧跟 `CardDeployed`，
 *    构建期看到的还都是手牌位。
 * 3. **不读 `resolution.finalState`**（只在取消与开发期断言时用）。
 *    目标与数值全部来自事件与 patch，演出层无从自行决定。
 *
 * 不 import three / React。
 */

import type {
  BattleEvent,
  BattleState,
  DisplayPatch,
  Resolution,
} from '../../domain/battle/types';
import type { SideId } from '../../domain/cards/types';
import { Timeline } from '../anim/Timeline';
import { ATTACK_OUT_SECONDS, hpLossValues, hpStepSeconds } from '../anim/combatMotion';
import type { SlotZone } from '../battle/layout';
import { deathBlastIndex } from './eventEffects';
import { BOMBARD_HIT_SECONDS, DEATH_BOMBARD_HIT_SECONDS, RANGED_HIT_SECONDS } from '../effects/artilleryTiming';
import { SPEED_SCALE, type PresentationSpeed } from '../../state/settingsStore';
// 只 import 类型：编不过时也不会把 DOM/WebAudio 拖进 node 测试网
import type { SoundCue } from '../../services/audio/cues';
import { FAMILY_TO_EFFECT } from '../effects/familyMap';
import { statusAppliedHit, statusTriggeredHit } from '../effects/attackStatusTiming';
import { slashTiming, usesSlash } from '../effects/slashTiming';
import {
  DEFAULT_BEAT,
  EMPHASIS_SECONDS,
  EVENT_BEAT,
  PROXY_EXIT_SECONDS,
  SETTLE_BEAT,
} from './constants';
import {
  adoptDisplay,
  applyEventToDisplay,
  applyPatchesToDisplay,
  clearEmphasis,
  displayFromState,
  projectDisplay,
  type DisplayState,
} from './displayState';
import {
  effectRequestFor,
  logLineFor,
  type EffectContext,
  type EffectPlayRequest,
  type Point,
} from './eventEffects';

export interface Beat {
  readonly duration: number;
  readonly onStart?: (() => void) | undefined;
  readonly onComplete?: (() => void) | undefined;
}

/** 导演需要外部提供的东西。注入而不是内建，是为了让它能在 node 里被完整测试。 */
export interface DirectorDeps {
  /** 显示状态。导演直接改它——会话持有同一个对象。 */
  readonly display: DisplayState;
  /** 通知 React 重新读快照。 */
  readonly publish: () => void;
  /** 播一个特效。场景里接到 `effectDirector.play`。 */
  readonly play: (request: EffectPlayRequest) => void;
  /**
   * 把正在播的特效立刻收掉。接到 `effectDirector.skipAll`。
   *
   * 跳过时会一次性补发所有剩余 beat 的 `onStart`，于是特效请求也一次性全部发出——
   * 不收掉就是「跳过的那一刻所有技能同时炸开」。它们的完成回调会照常跑完，
   * 所以收掉不影响任何规则状态。
   */
  readonly skipEffects: () => void;
  /**
   * 表现层音效出口。缺省（undefined）等于静音——node 测试不必提供它。
   *
   * **必须走注入**：`AudioEngine` 碰 `AudioContext`，而本文件与 `session.ts`
   * 都刻意「不 import three / React / DOM」，整局要能在 node 里跑完。
   */
  readonly sound?: ((cue: SoundCue) => void) | undefined;
  readonly log: (line: string) => void;
  readonly worldPointOf: (instanceId: string) => Point;
  readonly cardFacePointOf?: ((instanceId: string) => Point) | undefined;
  readonly slotPointOf: (side: SideId, zone: SlotZone, slotIndex: number) => Point;
  /** 某一方的牌堆 / 弃牌堆在桌上的位置。抽牌与还魂的起点是这里。 */
  readonly pilePointOf: (side: SideId, kind: 'deck' | 'discard') => Point;
  readonly playerAnchor: (side: SideId) => Point;
  readonly nameOf: (instanceId: string) => string;
  readonly speed: () => PresentationSpeed;
  /** 该次演出播完了。**不要在这里同步开启下一次演出**，见 `needsAdvance` 的注释。 */
  readonly onFinished: (finalState: BattleState) => void;
  /** 开发期自检：显示状态是否与权威状态一致。生产构建里是空实现。 */
  readonly checkConsistency?: ((display: DisplayState, finalState: BattleState) => void) | undefined;
}

/**
 * 这张牌从哪儿来。
 *
 * 只在**卡片在画面上凭空出现**时才需要：从牌堆抽到手、被还魂从弃牌堆捞回来。
 * 其余的移动（出牌、部署、顺位整理）牌本来就在画面上，渲染层从它当前的位置
 * 接着飞就行，不需要提示。
 *
 * **必须在 `onComplete` 里算**，不能提前：`worldPointOf` 读的是显示状态，
 * 而这一步之前它还是移动前的位置——那正是我们想要的「起点」。
 */
function spawnForEvent(
  event: BattleEvent,
  deps: DirectorDeps,
): { instanceId: string; point: Point } | null {
  switch (event.type) {
    case 'CooldownCardGranted':
    case 'CardDrawn':
      return { instanceId: event.instanceId, point: deps.pilePointOf(event.side, 'deck') };
    case 'CardPlayed':
    case 'CardDeployed':
    case 'CloneCreated':
      return { instanceId: event.instanceId, point: deps.worldPointOf(event.instanceId) };
    case 'CardSummoned': return { instanceId: event.instanceId, point: deps.worldPointOf(event.sourceInstanceId) };
    case 'CardMoved':
      if (event.from === 'discard') {
        return { instanceId: event.instanceId, point: deps.pilePointOf(event.side, 'discard') };
      }
      if (event.from === 'deck') {
        return { instanceId: event.instanceId, point: deps.pilePointOf(event.side, 'deck') };
      }
      return { instanceId: event.instanceId, point: deps.worldPointOf(event.instanceId) };
    default:
      return null;
  }
}

/** 事件里有没有会改动 HP/ATK 的？有的话后面接一个高亮 beat。 */
function touchesStats(event: BattleEvent): boolean {
  if (event.type === 'StatChanged' && event.cause === 'berserk') return false;
  return (
    event.type === 'DamageApplied' ||
    event.type === 'Healed' ||
    event.type === 'StatChanged' ||
    event.type === 'PlayerHpChanged'
  );
}

function groupPatches(patches: readonly DisplayPatch[]): Map<number, DisplayPatch[]> {
  const bySeq = new Map<number, DisplayPatch[]>();
  for (const patch of patches) {
    const list = bySeq.get(patch.atEventSeq);
    if (list) {
      list.push(patch);
    } else {
      bySeq.set(patch.atEventSeq, [patch]);
    }
  }
  return bySeq;
}

/**
 * 把一次结算展开成 beat 序列。
 *
 * 纯函数：只读 `resolution` 与 `deps` 的坐标查询，不产生副作用。
 * 导出是为了让测试能直接对着它断言（例如「一次 CardDied 恰好产出
 * 推代理、等代理退场、丢代理」）。
 */
export function buildBeats(resolution: Resolution, deps: DirectorDeps): Beat[] {
  const beats: Beat[] = [];
  const patchesAt = groupPatches(resolution.patches);
  const events = resolution.events;
  const pendingDeathProxies = new Map<string, Set<string>>();

  events.forEach((event, index) => {
    const patches = patchesAt.get(event.seq) ?? [];
    const blast = event.type === 'CardDied' && deathBlastIndex(events, index, event.instanceId) >= 0;
    const previous = events[index - 1];
    const fatal = event.type === 'DamageApplied' && (event.source === 'instantDeath' || event.source === 'unyielding');
    const consumption = event.type === 'DamageApplied' && event.source === 'selfInflicted'
      && previous?.type === 'SkillTriggered' && previous.instanceId === event.instanceId && previous.family === 'selfDestruct';
    const immediateDeath = event.type === 'CardDied' && previous?.type === 'DamageApplied' && previous.source === 'instantDeath' && event.collapsedInstanceIds.includes(previous.instanceId);
    const slashTemplate = (event.type === 'SkillTriggered' || event.type === 'SpellReflected') && event.family
      ? FAMILY_TO_EFFECT[event.family] : undefined;
    const slashHit = slashTemplate && usesSlash(slashTemplate) ? slashTiming(slashTemplate).hit : undefined;
    const duration = consumption || fatal || blast || immediateDeath ? 0
      : slashHit !== undefined ? slashHit
      : event.type === 'AttackStatusApplied' ? (event.animate === false ? 0 : statusAppliedHit(event.kind))
      : event.type === 'AttackStatusTriggered' ? statusTriggeredHit(event.kind)
      : ['ConcealmentUsed', 'VanguardIntercepted', 'DiscardDevoured'].includes(event.type) || event.type === 'AttackStatusExpired' || event.type === 'FlightChanged' || (event.type === 'StatChanged' && event.cause === 'berserk') ? 0
      : event.type === 'UnyieldingChanged' ? 0
      : event.type === 'LifeTransferred' ? 0.42
      : event.type === 'FormationShuffled' ? 0.3
      : event.type === 'AttackDeclared' ? (event.attackKind && event.attackKind !== 'siege' ? RANGED_HIT_SECONDS : ATTACK_OUT_SECONDS)
      : event.type === 'SkillTriggered' && ['concealment', 'firstStrike', 'vanguard', 'devour', 'masterpiece', 'foxSpiritSummon', 'antiAir', 'groupGround', 'siege', 'berserk', 'severeFrost', 'burning', 'venom', 'bleeding', 'grievousWound', 'splash', 'groupDelay', 'ranged', 'directDamage', 'groupPhysicalDamage', 'selfDestruct', 'sacrifice', 'unyielding'].includes(event.family ?? '') ? 0
      : event.type === 'SkillTriggered' && ['piercing', 'groupPiercing'].includes(event.family ?? '') ? RANGED_HIT_SECONDS
      : event.type === 'SkillTriggered' && event.family === 'poisonCloud' ? .42
      : event.type === 'SkillTriggered' && event.family === 'grantDodge' ? 0.3
      : ((event.type === 'SkillTriggered' || event.type === 'SpellReflected') && ['explodeOnDeath', 'alignedDeathBlast'].includes(event.family ?? '')) ? DEATH_BOMBARD_HIT_SECONDS
      : (event.type === 'SkillTriggered' || event.type === 'SpellReflected') && ['bombard', 'groupBombard'].includes(event.family ?? '') ? BOMBARD_HIT_SECONDS
      : event.type === 'SpellReflected' && ['severeFrost', 'burning', 'venom', 'bleeding', 'grievousWound', 'groupDelay'].includes(event.family) ? 0
      : event.type === 'SpellReflected' ? (event.family === 'lightning' || event.family === 'groupLightning' ? 0.26 : 0.42)
      : event.type === 'SkillTriggered' && event.family === 'counter' ? ATTACK_OUT_SECONDS
      : EVENT_BEAT[event.type] ?? DEFAULT_BEAT;

    const beat: Beat = {
      duration,
      onStart: () => {
        // 只在表现层：不读 finalState、不改 display，胜负与数值都不经过这里
        if (event.type === 'CardDied') {
          deps.sound?.('death');
        }
        // 坐标在这一刻解析：显示状态还没被本步改动，正是「出手前」的那一帧
        const context: EffectContext = {
          worldPointOf: deps.worldPointOf,
          cardFacePointOf: deps.cardFacePointOf,
          slotPointOf: deps.slotPointOf,
          playerAnchor: deps.playerAnchor,
          events,
          index,
        };
        const request = effectRequestFor(event, context);
        if (request) {
          deps.play({ ...request, durationScale: SPEED_SCALE[deps.speed()] });
        }
      },
      onComplete: () => {
        // **命中节点**：数值只在这里变，因此不会提前显示最终 HP
        applyPatchesToDisplay(deps.display, patches);
        // 结构变化
        applyEventToDisplay(deps.display, event);
        // 记下这张牌从哪儿来：渲染层靠它决定「从哪飞过来」
        const spawn = spawnForEvent(event, deps);
        if (spawn) {
          deps.display.spawns[spawn.instanceId] = spawn.point;
        }

        const line = logLineFor(event, deps.nameOf);
        if (line) {
          deps.log(line);
        }
        deps.publish();
      },
    };

    const hpLoss = !consumption && !fatal && (event.type === 'DamageApplied' || event.type === 'PlayerHpChanged')
      ? hpLossValues(event.hpBefore, event.hpAfter) : [];
    if (hpLoss.length === 0) {
      beats.push(beat);
    } else {
      const hpPatches = patches.filter((patch) => patch.kind === 'setHp');
      const before = event.type === 'DamageApplied' || event.type === 'PlayerHpChanged' ? event.hpBefore : 0;
      beats.push({ duration: 0, onStart: beat.onStart, onComplete: () => {
        // Start the one brightness pulse while the first number is still visible.
        applyPatchesToDisplay(deps.display, hpPatches.map((patch) => ({ ...patch, value: before })));
        deps.publish();
      } });
      hpLoss.forEach((value, stepIndex) => {
        beats.push({ duration: hpStepSeconds(hpLoss.length), onComplete: () => {
          // 「命中」在**第一个数字落地**那一刻响一次，不是每步都响
          if (stepIndex === 0) {
            deps.sound?.('hit');
          }
          applyPatchesToDisplay(deps.display, hpPatches.map((patch) => ({ ...patch, value })));
          if (stepIndex === hpLoss.length - 1) beat.onComplete?.();
          else deps.publish();
        } });
      });
    }

    if (touchesStats(event) && !consumption && !fatal) {
      beats.push({
        duration: EMPHASIS_SECONDS,
        onComplete: () => {
          clearEmphasis(deps.display);
          deps.publish();
        },
      });
    }

    if (event.type === 'CardDied') {
      /*
        离场代理的**生命周期由导演决定**，不是等代理自己的动画播完。
        这里只接一个普通的等待步骤，跳过会被补发、取消会整批清掉——
        「取消演出不依赖动画回调」就是靠这一点成立的。
      */
      const ids = new Set(event.collapsedInstanceIds);
      if (blast) {
        // Start death artillery while the source location still exists; keep its
        // proxy through the hit instead of clearing it before ON_DEATH executes.
        pendingDeathProxies.set(event.instanceId, ids);
      } else beats.push({
        duration: PROXY_EXIT_SECONDS,
        onComplete: () => {
          deps.display.proxies = deps.display.proxies.filter(
            (proxy) => !ids.has(proxy.instanceId),
          );
          deps.publish();
        },
      });
    }
    if (event.type === 'CardMoved' && event.from === 'battle') {
      const ids = pendingDeathProxies.get(event.instanceId);
      if (ids) {
        beats.push({ duration: 0, onComplete: () => {
          deps.display.proxies = deps.display.proxies.filter((proxy) => !ids.has(proxy.instanceId));
          deps.publish();
        } });
        pendingDeathProxies.delete(event.instanceId);
      }
    }
  });

  // 收尾停顿：让人看清最终局面再放开输入
  beats.push({ duration: SETTLE_BEAT });

  beats.push({
    duration: 0,
    onComplete: () => {
      deps.checkConsistency?.(deps.display, resolution.finalState);
      deps.onFinished(resolution.finalState);
    },
  });

  return beats;
}

export class PresentationDirector {
  private timeline: Timeline | null = null;
  private finalState: BattleState | null = null;

  constructor(private readonly deps: DirectorDeps) {}

  get isPerforming(): boolean {
    return this.timeline !== null && !this.timeline.isFinished;
  }

  /** 播出一次结算。 */
  perform(resolution: Resolution): void {
    this.finalState = resolution.finalState;
    this.start(buildBeats(resolution, this.deps));
  }

  /**
   * 一段与规则无关的停顿（AI 的「思考」时间）。
   *
   * 用同一套时间轴，所以快速档会压缩它、跳过档会跳过它——
   * 它属于演出，不该因为快进就改变对局。
   */
  performWait(seconds: number, then: () => void): void {
    this.start([{ duration: seconds }, { duration: 0, onComplete: then }]);
  }

  private start(beats: readonly Beat[]): void {
    let timeline: Timeline;
    timeline = new Timeline(() => {
      // 同一帧里有可能已经有人启动了下一场演出；只有自己还是当前那一条时才清空，
      // 否则会把刚建好的新时间轴一起抹掉
      if (this.timeline === timeline) {
        this.timeline = null;
      }
    });
    for (const beat of beats) {
      // 只在真的有回调时才带上这两个字段：`exactOptionalPropertyTypes` 下
      // 「缺省」与「显式传 undefined」不是一回事
      timeline.add({
        duration: beat.duration,
        ...(beat.onStart ? { onStart: beat.onStart } : {}),
        ...(beat.onComplete ? { onComplete: beat.onComplete } : {}),
      });
    }
    this.timeline = timeline;
  }

  /** 丢掉当前演出，但**不动**显示状态。用于开新一局。 */
  reset(): void {
    this.timeline = null;
    this.finalState = null;
  }

  tick(delta: number): void {
    const timeline = this.timeline;
    if (!timeline || timeline.isFinished) {
      return;
    }
    const speed = this.deps.speed();
    if (speed === 'skip') {
      // 注意：不是把 delta 乘 0.05 之类的系数——那样跳过仍然要花时间。
      // 直接补完剩余步骤。
      this.skip();
      return;
    }
    /*
      `SPEED_SCALE` 是**演出时长的倍数**（实验台的 `durationScale` 就是这么用的），
      不是播放速度的倍数。要更快就得把每帧推进的时间**除以**它：
      乘 0.45 会让快速档反而比普通档慢一倍多——这一条踩过。
    */
    const durationScale = SPEED_SCALE[speed];
    timeline.update(Math.min(delta, 0.05) / durationScale);
  }

  /** 立刻补完当前演出。 */
  skip(): void {
    const timeline = this.timeline;
    if (!timeline || timeline.isFinished) {
      return;
    }
    timeline.skipToEnd();
    this.deps.skipEffects();
  }

  /**
   * 取消当前演出并把显示状态直接对齐到权威状态。
   *
   * 没有任何东西被 await，所以这条路径不依赖任何动画回调——
   * 切场景、背景暂停都走这里。
   */
  cancel(): void {
    if (this.finalState) {
      adoptDisplay(this.deps.display, displayFromState(this.finalState));
      this.finalState = null;
    }
    this.timeline = null;
    this.deps.skipEffects();
    this.deps.publish();
  }

  /** 当前显示状态与权威状态是否一致。给开发期断言与测试用。 */
  static isConsistent(display: DisplayState, finalState: BattleState): boolean {
    return projectDisplay(display) === projectDisplay(displayFromState(finalState));
  }
}
