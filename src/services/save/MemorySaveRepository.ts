import type { ProfileState } from '../../domain/progression/types';
import type { SaveRepository } from './SaveRepository';

/**
 * 内存实现。
 *
 * 两个身份：单测里的替身，以及**生产环境的回退**——浏览器隐私模式、
 * 或者 IndexedDB 的 `open` 挂住时，就用它。
 *
 * 刻意让它同时承担这两个角色：回退路径会被每一条单测跑到，
 * 不会变成一段没人验证过的死代码。
 */
export class MemorySaveRepository implements SaveRepository {
  readonly kind = 'memory' as const;

  private value: ProfileState | null = null;

  /** 测试用：数一数到底提交了几次。十连必须只有 1 次。 */
  commitCount = 0;

  constructor(initial: ProfileState | null = null) {
    this.value = initial;
  }

  load(): Promise<ProfileState | null> {
    return Promise.resolve(this.value);
  }

  commit(next: ProfileState): Promise<void> {
    this.commitCount += 1;
    this.value = next;
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.value = null;
    return Promise.resolve();
  }

  close(): void {
    // 内存实现没有可关的东西
  }

  /** 测试用：直接看一眼现在存的是什么。 */
  peek(): ProfileState | null {
    return this.value;
  }
}
