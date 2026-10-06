/**
 * 「一次事务 + 一份给界面看的视图」这个组合。
 *
 * 抽卡、购买、结算都长这样：先算出**要写什么**（`EconomyTransaction`）
 * 与**要给玩家看什么**（`view`），再交给 `ProfileStore` 落盘。
 * 分开的理由是：视图里可能有落盘用不到的东西（比如「这次升了几级」），
 * 而事务里也不该塞展示数据。
 *
 * 拒绝是一个**正常返回值**而不是异常：余额不足、售罄、卡组为空都是可预期的，
 * 调用方要把理由显示给玩家。
 */

import type { EconomyTransaction } from './types';

export interface PlanRejection {
  /** 给玩家看的中文理由。 */
  readonly rejected: string;
}

export interface EconomicPlan<TView> {
  readonly transaction: EconomyTransaction;
  readonly view: TView;
}

export type Planned<TView> = EconomicPlan<TView> | PlanRejection;

export function reject(reason: string): PlanRejection {
  return { rejected: reason };
}

export function isRejection<TView>(value: Planned<TView>): value is PlanRejection {
  return 'rejected' in value;
}
