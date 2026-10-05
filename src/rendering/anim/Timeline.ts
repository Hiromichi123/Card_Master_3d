import { clamp01, linear, type Easing } from './easings';

/**
 * 轻量时间轴。
 *
 * 工程里**只允许存在这一套**时间轴（PLAN 第 2 节：避免多套并存）。
 * 它不是 Tween 库，只做三件事：按顺序推进若干「步骤」、把归一化进度交给回调、
 * 以及**能立刻跳到终点**。
 *
 * `skipToEnd()` 是它存在的关键理由之一：施工清单要求跳过模式与正常播放
 * 得到**相同结果**。跳过时不能只把计时器设到末尾，必须补发每一个步骤的
 * `onUpdate(1)` 与 `onComplete`，否则中间状态（例如「贴图换面的那一帧」）会被跳过。
 */

export interface TimelineStep {
  readonly duration: number;
  readonly easing?: Easing;
  /** 步骤开始时调用一次。 */
  readonly onStart?: () => void;
  /** 每帧调用，`t` 是**缓动后**的 [0,1]。 */
  readonly onUpdate?: (t: number) => void;
  /** 步骤完成时调用一次。跳到最后也会补发。 */
  readonly onComplete?: () => void;
}

export class Timeline {
  private readonly steps: TimelineStep[] = [];
  private index = 0;
  private elapsed = 0;
  private started = false;
  private finished = false;
  private onDone: (() => void) | undefined;

  constructor(onDone?: () => void) {
    this.onDone = onDone;
  }

  add(step: TimelineStep): this {
    this.steps.push(step);
    return this;
  }

  /** 串行追加：等待 `delay` 秒。 */
  wait(duration: number): this {
    return this.add({ duration });
  }

  /** 并行追加：与后续步骤同时开始，但时间轴仍按最长者推进。 */
  get duration(): number {
    return this.steps.reduce((sum, step) => sum + step.duration, 0);
  }

  get isFinished(): boolean {
    return this.finished;
  }

  update(delta: number): void {
    if (this.finished) {
      return;
    }

    // 首帧先把第一个步骤的 onStart 发出去
    if (!this.started) {
      this.started = true;
      this.steps[0]?.onStart?.();
    }

    this.elapsed += delta;

    // 一帧内可能跨过多个步骤（掉帧或步骤很短），循环消费
    let guard = 0;
    while (this.index < this.steps.length && guard < 64) {
      guard += 1;
      const step = this.steps[this.index];
      if (!step) {
        break;
      }

      const progress = step.duration <= 0 ? 1 : clamp01(this.elapsed / step.duration);
      const eased = (step.easing ?? linear)(progress);
      step.onUpdate?.(eased);

      if (progress < 1) {
        return;
      }

      // 本步结束
      step.onComplete?.();
      this.elapsed -= step.duration;
      this.index += 1;

      const next = this.steps[this.index];
      if (next) {
        next.onStart?.();
      }
    }

    this.finished = true;
    this.onDone?.();
  }

  /**
   * 立刻结束：补发每个未完成步骤的 `onUpdate(1)` 与 `onComplete`。
   *
   * 这是「跳过演出但结果一致」的实现方式，不是把进度条拖到底。
   */
  skipToEnd(): void {
    if (this.finished) {
      return;
    }

    if (!this.started) {
      this.started = true;
      this.steps[0]?.onStart?.();
    }

    while (this.index < this.steps.length) {
      const step = this.steps[this.index];
      if (!step) {
        break;
      }
      const easing = step.easing ?? linear;
      step.onUpdate?.(easing(1));
      step.onComplete?.();
      this.index += 1;
      this.steps[this.index]?.onStart?.();
    }

    this.elapsed = 0;
    this.finished = true;
    this.onDone?.();
  }

  reset(): void {
    this.index = 0;
    this.elapsed = 0;
    this.started = false;
    this.finished = false;
  }
}
