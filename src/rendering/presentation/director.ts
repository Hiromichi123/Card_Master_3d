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
import type { SlotZone } from '../battle/layout';
import { SPEED_SCALE, type PresentationSpeed } from '../../state/settingsStore';
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
  readonly log: (line: string) => void;
  readonly worldPointOf: (instanceId: string) => Point;
  readonly slotPointOf: (side: SideId, zone: SlotZone, slotIndex: number) => Point;
  readonly playerAnchor: (side: SideId) => Point;
  readonly nameOf: (instanceId: string) => string;
  readonly speed: () => PresentationSpeed;
  /** 该次演出播完了。**不要在这里同步开启下一次演出**，见 `needsAdvance` 的注释。 */
  readonly onFinished: (finalState: BattleState) => void;
  /** 开发期自检：显示状态是否与权威状态一致。生产构建里是空实现。 */
  readonly checkConsistency?: ((display: DisplayState, finalState: BattleState) => void) | undefined;
}

/** 事件里有没有会改动 HP/ATK 的？有的话后面接一个高亮 beat。 */
function touchesStats(event: BattleEvent): boolean {
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

  events.forEach((event, index) => {
    const patches = patchesAt.get(event.seq) ?? [];
    const duration = EVENT_BEAT[event.type] ?? DEFAULT_BEAT;

    beats.push({
      duration,
      onStart: () => {
        // 坐标在这一刻解析：显示状态还没被本步改动，正是「出手前」的那一帧
        const context: EffectContext = {
          worldPointOf: deps.worldPointOf,
          slotPointOf: deps.slotPointOf,
          playerAnchor: deps.playerAnchor,
          events,
          index,
        };
        const request = effectRequestFor(event, context);
        if (request) {
          deps.play(request);
        }
      },
      onComplete: () => {
        // **命中节点**：数值只在这里变，因此不会提前显示最终 HP
        applyPatchesToDisplay(deps.display, patches);
        // 结构变化
        applyEventToDisplay(deps.display, event);

        const line = logLineFor(event, deps.nameOf);
        if (line) {
          deps.log(line);
        }
        deps.publish();
      },
    });

    if (touchesStats(event)) {
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
      beats.push({
        duration: PROXY_EXIT_SECONDS,
        onComplete: () => {
          deps.display.proxies = deps.display.proxies.filter(
            (proxy) => !ids.has(proxy.instanceId),
          );
          deps.publish();
        },
      });
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
