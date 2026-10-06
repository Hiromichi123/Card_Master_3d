/**
 * 存档的持久化接口。
 *
 * 界面层只认这个接口，不认识 IndexedDB——这样桌面版（文件/原生存储）将来
 * 只要再写一个实现即可，PLAN 第 6 节要求的就是这一点。
 *
 * **整份文档一次写入**，不做增量。存档是一份几 KB 的 JSON（256 个键的库存表、
 * 最多十几个卡组、一串已结算战斗 id），一次 `put` 在 IndexedDB 里本身就是原子的，
 * 没有多仓协调可以出错。
 */

import type { ProfileState } from '../../domain/progression/types';

export type StorageKind = 'indexeddb' | 'memory';

export interface SaveRepository {
  readonly kind: StorageKind;
  /** 读存档。没有存档返回 `null`（不是空对象——「没有」和「空的」是两回事）。 */
  load(): Promise<ProfileState | null>;
  /**
   * 写入。
   *
   * **成功即已落盘，失败必须抛出且磁盘保持旧值。** 调用方靠这一点决定
   * 要不要把新状态交给界面——写在 `oncomplete` 之后 resolve 而不是请求的
   * `onsuccess`，就是因为后者只表示「请求被接受」。
   */
  commit(next: ProfileState): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}
