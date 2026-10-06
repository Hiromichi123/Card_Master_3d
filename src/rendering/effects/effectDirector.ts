import { Color, Vector3 } from 'three';

import type { EffectTemplateId } from './templates';

/**
 * 特效请求。由界面或（P3 之后的）演出层发出。
 *
 * 关键区分：**规则结果不在这里决定**。`onHit` 只用来驱动伤害数字、
 * 镜头反馈这类表现，`V-FX-5` 要求演出设置不得改变战斗结果。
 */
export interface EffectRequest {
  /** 唯一实例 id，便于调试与去重。 */
  readonly id: string;
  readonly template: EffectTemplateId;
  /** Presentation-only skill variant, never changes combat rules. */
  readonly family?: string | undefined;
  /** Source card identity for card-body attacks (not a projectile). */
  readonly sourceInstanceId?: string | undefined;
  /** 起点：施法者或攻击方。 */
  readonly from: readonly [number, number, number];
  /** 主目标点。 */
  readonly to: readonly [number, number, number];
  /** 群体效果的额外目标点。 */
  readonly extraTargets?: readonly (readonly [number, number, number])[] | undefined;
  /** 主题色（十六进制字符串）。缺省用模板自带颜色。 */
  readonly color?: string | undefined;
  /** 技能参数 n。影响数量与尺度，不改变效果种类。 */
  readonly intensity?: number | undefined;
  /** 粒子数量倍数。 */
  readonly countScale?: number | undefined;
  /** 时长倍数。 */
  readonly durationScale?: number | undefined;
  /** 命中瞬间的回调，只用于表现。 */
  readonly onHit?: (() => void) | undefined;
}

export type EffectListener = (request: EffectRequest) => void;

/**
 * 特效调度中枢。
 *
 * 场景组件在挂载时订阅，界面通过 `play()` 触发。用单例而不是 React 状态，
 * 是因为特效的触发点会越来越多（出牌、命中、死亡、抽卡、融合），
 * 每次都往组件树里传一遍回调会很快失控。
 *
 * P3 的演出层接入后，这里会由 `PresentationDirector` 按事件序号驱动，
 * 界面直接调用的入口保留给实验台与调试。
 */
class EffectDirector {
  private readonly listeners = new Set<EffectListener>();
  private readonly skippers = new Set<() => void>();
  private counter = 0;

  /**
   * 登记一个监听者（场景挂载时调用）。
   * 返回取消订阅的函数——必须在卸载时调用，否则场景重建会留下重复监听。
   */
  subscribe(listener: EffectListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 登记「立即结束全部正在播放的特效」的能力。
   *
   * 活跃特效的引用只存在于渲染系统的内部状态里，调度中枢够不到，
   * 因此由渲染系统把这个能力注册上来。
   */
  registerSkipper(skipper: () => void): () => void {
    this.skippers.add(skipper);
    return () => {
      this.skippers.delete(skipper);
    };
  }

  /**
   * 立即结束全部特效。
   *
   * 不是「停止渲染」——每个时间轴会补发未完成步骤的完成回调，
   * 使得跳过模式与正常播放的结果一致。
   */
  skipAll(): void {
    for (const skipper of this.skippers) {
      skipper();
    }
  }

  /** 触发一次特效。没有监听者时静默丢弃（例如实验台未打开）。 */
  play(request: Omit<EffectRequest, 'id'> & { id?: string }): string {
    const id = request.id ?? `fx-${(this.counter += 1)}`;
    const full: EffectRequest = { ...request, id };
    for (const listener of this.listeners) {
      listener(full);
    }
    return id;
  }

  /** 当前监听者数量，供调试面板显示。 */
  get listenerCount(): number {
    return this.listeners.size;
  }
}

export const effectDirector = new EffectDirector();

/** 便捷构造函数：把元组转成 Vector3。 */
export function toVector3(value: readonly [number, number, number]): Vector3 {
  return new Vector3(value[0], value[1], value[2]);
}

/** 由十六进制字符串构造颜色，缺省时返回 undefined 交给模板决定。 */
export function parseColor(value: string | undefined): Color | undefined {
  return value ? new Color(value) : undefined;
}
