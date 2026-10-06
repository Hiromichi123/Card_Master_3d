import type { ProfileState } from '../../domain/progression/types';
import type { SaveRepository } from './SaveRepository';

/**
 * 一个「写不进去」的存档实现，只给测试与开发期开关用。
 *
 * 「保存失败时界面不得确认」是这个阶段最硬的一条约束，但它**没法在正常环境里复现**——
 * 没有它就只能靠读代码相信。有了这个实现，浏览器用例就能真的把写入打回去，
 * 断言货币没变、没起演出、弹了失败提示。
 */
export class FailingSaveRepository implements SaveRepository {
  readonly kind: 'indexeddb' | 'memory';

  constructor(private readonly inner: SaveRepository) {
    this.kind = inner.kind;
  }

  load(): Promise<ProfileState | null> {
    return this.inner.load();
  }

  commit(): Promise<void> {
    return Promise.reject(new Error('（测试）存档写入被拒绝'));
  }

  clear(): Promise<void> {
    return this.inner.clear();
  }

  close(): void {
    this.inner.close();
  }
}
