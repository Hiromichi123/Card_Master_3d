/**
 * 一局战斗的状态机。
 *
 * **刻意不是 React state，也不是 zustand。** 两个理由：
 *
 * 1. `BattleScene` 在切到「数据自检」时会卸载。状态机若活在 `useState` 里，
 *    会连权威状态和输入锁一起死掉。而 `applyCommand` 是同步返回终态的，
 *    所以放在类里，切场景最多丢**演出**，永远丢不掉**规则**
 *    （PLAN 第 4.1 节：背景暂停、切换场景都不依赖动画回调完成结算）。
 * 2. 导演要从 Canvas 内的 `useFrame` 拿 `tick(delta)`，HUD 要从 Canvas 外重渲染。
 *    一个类实例是唯一能同时接住这两边、又不必再造一个状态容器的东西。
 *
 * 不 import three / React / DOM——整局可以在 node 里跑完并断言，
 * 这正是 P3 里风险最集中的部分。
 */

import { cardById } from '../../data';
import { chooseCommand } from '../../domain/battle/ai';
import { applyCommand, createBattle, hasLegalPlay } from '../../domain/battle/engine';
import { createRng, type Rng } from '../../domain/battle/rng';
import type {
  BattleConfig,
  BattleOutcome,
  BattlePhase,
  BattleState,
  Command,
} from '../../domain/battle/types';
import type { SideId } from '../../domain/cards/types';
import type { PresentationSpeed } from '../../state/settingsStore';
import type { SlotZone } from '../battle/layout';
import { handPointOf, slotPosition } from '../battle/placements';
import { pilePosition, BATTLE_CARD_SCALE, CARD_SIZE } from '../battle/layout';
import { FLYING_CARD_LIFT } from '../anim/combatMotion';
import { AI_THINK_SECONDS } from './constants';
import { PresentationDirector } from './director';
import {
  adoptDisplay,
  displayFromState,
  syncIdentities,
  type DisplayState,
} from './displayState';
import { impactPointOf, playerAnchorPoint, type EffectPlayRequest, type Point } from './eventEffects';
import { AI_SEED_MIX, type DefinitionTable } from './demoBattle';

export type SessionMode = 'menu' | 'battle' | 'result';

/**
 * 演出层要用的特效能力。
 *
 * 注入而不是直接 import `effectDirector`：那个模块 import three，
 * 而这张表让会话本身保持无依赖，能在 node 里整局跑完。
 */
export interface SessionEffects {
  readonly play: (request: EffectPlayRequest) => void;
  readonly skipAll: () => void;
}

/** 界面读的东西。**必须整体缓存**——`useSyncExternalStore` 用 `Object.is` 比较。 */
export interface BattleSnapshot {
  readonly mode: SessionMode;
  readonly display: DisplayState;
  /** 现在能不能操作。演出期间是 false，这是输入的**唯一闸门**。 */
  readonly inputOpen: boolean;
  readonly phase: BattlePhase;
  readonly turnNumber: number;
  readonly currentSide: SideId;
  readonly cardsPlayedThisTurn: number;
  readonly cardLimit: number;
  /** 本体生命上限。血量条按它取比例。 */
  readonly baseHp: number;
  /**
   * 玩家这回合还有没有合法的出牌。
   *
   * 读的是**权威**状态而不是显示状态——合法性是规则问题，
   * 不能因为演出还没播完就给出不同的答案。
   */
  readonly playerHasLegalPlay: boolean;
  readonly outcome: BattleOutcome | null;
  readonly selectedInstanceId: string | null;
  readonly playablePrepSlots: readonly number[];
  /** 最近几条演出日志。 */
  readonly log: readonly string[];
  readonly autoPlayer: boolean;
  /** 第几局。开新局会 +1，用来重播开场的发牌动画。 */
  readonly runId: number;
  readonly localMultiplayer: boolean;
  readonly autoEnemy: boolean;
  readonly currentHasLegalPlay: boolean;
}

export interface SessionControl {
  readonly localMultiplayer?: boolean | undefined;
  readonly autoEnemy?: boolean | undefined;
}

const LOG_LIMIT = 6;

export class BattleSession {
  private state: BattleState;
  private display: DisplayState;
  private readonly director: PresentationDirector;

  private mode: SessionMode = 'menu';
  private inputOpen = false;
  private selectedInstanceId: string | null = null;
  private autoPlayer = false;
  private autoEnemy = true;
  private readonly localMultiplayer: boolean;
  private runId = 0;
  private readonly log: string[] = [];
  private readonly listeners = new Set<() => void>();

  /**
   * 演出播完之后**不能**在同一帧里同步开启下一次演出。
   *
   * `Timeline.update()` 的最后一行就调 `onDone`，而 `onDone` 会走到这里；
   * 若在那里直接开下一场，就成了在 `update` 内部重入。
   * 置一个标志、由下一帧的 `tick` 顶部处理。
   */
  private needsAdvance = false;
  /** 同理：AI 的那一手也要等这一帧的时间轴更新彻底走完再发。 */
  private pendingAiAction = false;

  private aiRng: Rng;
  private snapshot: BattleSnapshot;

  constructor(
    private readonly config: BattleConfig,
    private readonly definitions: DefinitionTable,
    private readonly speed: () => PresentationSpeed,
    private readonly effects: SessionEffects,
    control: SessionControl = {},
  ) {
    this.localMultiplayer = control.localMultiplayer ?? false;
    this.autoEnemy = control.autoEnemy ?? true;
    this.state = createBattle(config, definitions);
    this.display = displayFromState(this.state);
    this.aiRng = createRng(this.config.seed ^ AI_SEED_MIX);

    this.snapshot = this.buildSnapshot();

    this.director = new PresentationDirector({
      display: this.display,
      publish: () => this.publish(),
      play: (request) => this.effects.play(request),
      skipEffects: () => this.effects.skipAll(),
      log: (line) => this.pushLog(line),
      worldPointOf: (instanceId) => this.worldPointOf(instanceId),
      cardFacePointOf: (instanceId) => {
        const point = this.worldPointOf(instanceId);
        const identity = this.display.instances[instanceId];
        const definition = identity ? cardById.get(identity.definitionId) : undefined;
        const lift = definition?.rawTraits.includes('飞行') ? FLYING_CARD_LIFT : 0;
        return [point[0], point[1] + lift + CARD_SIZE.thickness * BATTLE_CARD_SCALE + 0.025, point[2]];
      },
      slotPointOf: (side, zone, slotIndex) => this.slotPointOf(side, zone, slotIndex),
      pilePointOf: (side, kind) => pilePosition(side, kind),
      playerAnchor: (side) => playerAnchorPoint(side),
      nameOf: (instanceId) => this.nameOf(instanceId),
      speed: () => this.speed(),
      onFinished: () => {
        this.needsAdvance = true;
      },
      checkConsistency: DEV
        ? (display, finalState) => {
            if (!PresentationDirector.isConsistent(display, finalState)) {
              console.error('[P3] 显示状态与权威状态不一致：演出漏掉了某个 patch');
            }
          }
        : undefined,
    });
  }

  // --- 订阅 ---------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * 返回**缓存**的快照对象。
   *
   * 每次调用都新建一个字面量会让 `useSyncExternalStore` 判定「一直在变」，
   * 直接进入无限重渲染。只在 `publish()` 里重建。
   */
  getSnapshot = (): BattleSnapshot => this.snapshot;

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private buildSnapshot(): BattleSnapshot {
    const rules = this.state.rules;
    return {
      mode: this.mode,
      display: this.display,
      inputOpen: this.inputOpen,
      phase: this.state.phase,
      turnNumber: this.state.turnNumber,
      currentSide: this.state.currentSide,
      cardsPlayedThisTurn: this.state.cardsPlayedThisTurn,
      cardLimit: rules.cardsPerTurn,
      baseHp: rules.baseHp,
      playerHasLegalPlay: hasLegalPlay(this.state, 'player'),
      outcome: this.state.outcome,
      selectedInstanceId: this.selectedInstanceId,
      playablePrepSlots: this.playablePrepSlots(),
      log: this.log,
      autoPlayer: this.autoPlayer,
      localMultiplayer: this.localMultiplayer,
      autoEnemy: this.autoEnemy,
      currentHasLegalPlay: hasLegalPlay(this.state, this.state.currentSide),
      runId: this.runId,
    };
  }

  /** 权威状态。合法性判定与测试用。 */
  get authoritative(): BattleState {
    return this.state;
  }

  /**
   * 此刻有没有演出在播。
   *
   * 它变成 false 的那一刻，就是「显示状态应该已经追平权威状态」的检查点——
   * 自动演示时玩家不参与，`inputOpen` 一直是 false，只有这个信号可用。
   */
  get isPerforming(): boolean {
    return this.director.isPerforming;
  }

  // --- 模式 ---------------------------------------------------------------

  /** 开一局（也是「再来一局」）。 */
  start(): void {
    this.director.reset();
    this.state = createBattle(this.config, this.definitions);
    // 注意是**灌进同一个显示状态对象**：导演在构造时就按引用拿住了它
    adoptDisplay(this.display, displayFromState(this.state));
    /*
      开局手牌给一个起点：各自牌堆。开场的发牌动画是装饰性的，
      但它让手牌从牌堆飞进手里，两者叠在一起才读得出「牌是一张张发下来的」。
    */
    for (const side of ['player', 'enemy'] as const) {
      const pile = pilePosition(side, 'deck');
      for (const instanceId of this.display.zones[side].hand) {
        this.display.spawns[instanceId] = pile;
      }
    }
    this.runId += 1;
    this.aiRng = createRng(this.config.seed ^ AI_SEED_MIX);
    this.mode = 'battle';
    this.inputOpen = false;
    this.selectedInstanceId = null;
    this.needsAdvance = false;
    this.pendingAiAction = false;
    this.log.length = 0;

    if (this.isHumanTurn()) {
      this.inputOpen = true;
      this.publish();
    } else {
      this.advance();
    }
  }

  toMenu(): void {
    this.mode = 'menu';
    this.inputOpen = false;
    this.director.cancel();
    this.publish();
  }

  setAutoPlayer(on: boolean): void {
    this.autoPlayer = on;
    if (this.mode === 'battle' && !this.director.isPerforming) {
      this.selectedInstanceId = null;
      this.pendingAiAction = false;
      this.advance();
    }
    this.publish();
  }

  setAutoEnemy(on: boolean): void {
    if (!this.localMultiplayer) return;
    this.autoEnemy = on;
    if (this.state.currentSide === 'enemy') {
      this.selectedInstanceId = null;
      if (this.mode === 'battle' && !this.director.isPerforming) {
        this.pendingAiAction = false;
        this.advance();
      }
    }
    this.publish();
  }

  private isHumanTurn(): boolean {
    return this.state.currentSide === 'player'
      ? !this.autoPlayer
      : this.localMultiplayer && !this.autoEnemy;
  }

  // --- 输入 ---------------------------------------------------------------

  /**
   * 选中一张手牌准备打出。
   *
   * 只有**手牌**能被选中：点场上的卡只是看详情，不该进入「选牌出牌」的状态。
   * 点别处一律视为取消选中。
   */
  select(instanceId: string | null): void {
    const selectable =
      instanceId !== null && this.canAct() && this.state.cardsPlayedThisTurn < this.state.rules.cardsPerTurn && this.display.zones[this.state.currentSide].hand.includes(instanceId)
        ? instanceId
        : null;
    if (this.selectedInstanceId === selectable) {
      return;
    }
    this.selectedInstanceId = selectable;
    this.publish();
  }

  /** 把手牌放到准备槽。 */
  playSelectedAt(prepSlot: number): void {
    if (!this.canAct() || this.selectedInstanceId === null) {
      return;
    }
    const instanceId = this.selectedInstanceId;
    this.selectedInstanceId = null;
    this.submit({ kind: 'playCard', side: this.state.currentSide, instanceId, prepSlot });
  }

  endTurn(): void {
    if (!this.canAct()) {
      return;
    }
    this.selectedInstanceId = null;
    this.submit({ kind: 'endTurn', side: this.state.currentSide });
  }

  /** 手动跳过当前演出。 */
  skipPerformance(): void {
    this.director.skip();
  }

  private canAct(): boolean {
    return this.mode === 'battle' && this.inputOpen && this.isHumanTurn();
  }

  // --- 推进 ---------------------------------------------------------------

  /** 交给某个命令，开始演出。 */
  private submit(command: Command): void {
    const resolution = applyCommand(this.state, command);
    if (!resolution.accepted) {
      this.pushLog(`这一步不被允许（${resolution.rejection ?? '未知原因'}）`);
      this.publish();
      return;
    }
    this.state = resolution.finalState;
    // 分身/复活会凭空造出实例，先把身份补上，后面解析世界坐标才找得到它们
    syncIdentities(this.display, this.state);
    this.inputOpen = false;
    this.director.perform(resolution);
    this.publish();
  }

  /** 演出播完之后：开下一个输入，或者让 AI 走。 */
  private advance(): void {
    if (this.state.outcome) {
      this.mode = 'result';
      this.inputOpen = false;
      this.publish();
      return;
    }

    if (!this.isHumanTurn()) {
      this.inputOpen = false;
      this.publish();
      /*
        AI 的「思考」时间属于演出，所以它走同一套时间轴：
        快速档会压缩它、跳过档会跳掉它，但两者都不改变规则。
        回调里**不直接提交命令**——那会在时间轴自己的 update 里再开一场演出。
        只置一个标志，由 tick 的末尾发出去。
      */
      this.director.performWait(AI_THINK_SECONDS, () => {
        this.pendingAiAction = true;
      });
      return;
    }

    this.inputOpen = true;
    this.publish();
  }

  /** 由 Canvas 内的 `useFrame` 每帧调用。 */
  tick(delta: number): void {
    if (this.needsAdvance) {
      this.needsAdvance = false;
      this.advance();
    }

    this.director.tick(delta);

    // 时间轴已经整个更新完，现在再开新演出才是安全的
    if (this.pendingAiAction) {
      this.pendingAiAction = false;
      // The upper AI can be disabled during its wait without submitting a stale action.
      if (this.isHumanTurn()) this.advance();
      else this.submit(chooseCommand(this.state, this.aiRng));
    }
  }

  /** 切场景或卸载时调用。不等待任何动画。 */
  dispose(): void {
    this.director.cancel();
    this.listeners.clear();
  }

  // --- 给导演用的查询 -----------------------------------------------------

  private worldPointOf(instanceId: string): Point {
    for (const side of ['player', 'enemy'] as const) {
      const zones = this.display.zones[side];
      const battleIndex = zones.battle.indexOf(instanceId);
      if (battleIndex >= 0) {
        return slotPosition(side, 'battle', battleIndex);
      }
      const prepIndex = zones.prep.indexOf(instanceId);
      if (prepIndex >= 0) {
        return slotPosition(side, 'prep', prepIndex);
      }
      const handIndex = zones.hand.indexOf(instanceId);
      if (handIndex >= 0) {
        return handPointOf(handIndex, zones.hand.length, side);
      }
    }
    // 已经离场、但代理还在画面上：用代理记下的槽位，弹体才不会追向空槽
    const proxy = this.display.proxies.find((entry) => entry.instanceId === instanceId);
    if (proxy) {
      return impactPointOf(slotPosition(proxy.side, 'battle', proxy.slotIndex));
    }
    return [0, 0, 0];
  }

  private slotPointOf(side: SideId, zone: SlotZone, slotIndex: number): Point {
    return slotPosition(side, zone, slotIndex);
  }

  private nameOf(instanceId: string): string {
    const identity = this.display.instances[instanceId];
    if (!identity) {
      return instanceId;
    }
    return cardById.get(identity.definitionId)?.name ?? identity.definitionId;
  }

  private playablePrepSlots(): readonly number[] {
    if (!this.canAct() || this.selectedInstanceId === null || this.state.cardsPlayedThisTurn >= this.state.rules.cardsPerTurn || !hasLegalPlay(this.state, this.state.currentSide)) {
      return [];
    }
    const slots: number[] = [];
    this.display.zones[this.state.currentSide].prep.forEach((occupant, index) => {
      if (occupant === null) {
        slots.push(index);
      }
    });
    return slots;
  }

  private pushLog(line: string): void {
    this.log.push(line);
    if (this.log.length > LOG_LIMIT) {
      this.log.splice(0, this.log.length - LOG_LIMIT);
    }
  }
}

/** 构建期标志。生产构建里关掉开发期自检。 */
const DEV: boolean = import.meta.env.DEV;
