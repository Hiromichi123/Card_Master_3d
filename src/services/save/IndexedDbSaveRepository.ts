import type { ProfileState } from '../../domain/progression/types';
import type { SaveRepository } from './SaveRepository';

/**
 * IndexedDB 实现。
 *
 * 一个库、一个对象仓、一条记录（键固定为 `current`）。整份存档一次 `put`，
 * 放在一个 `readwrite` 事务里——**这本身就是原子的**，不需要额外的协调。
 *
 * 两处刻意加固，都是因为「打不开」是这个层最可能的死法：
 *
 * 1. `indexedDB.open` 外面套 `try/catch`：Firefox 隐私模式历史上会**同步抛**；
 * 2. 打开过程设 **2 秒超时**：`open` 既不 success 也不 error 时，
 *    浏览器不会主动告诉你，代码会一直挂着，界面永远停在「正在加载」。
 *
 * 任一失败都抛出去，由 `openSaveRepository` 决定回退到内存实现。
 */

const DB_NAME = 'card-master-3d';
const DB_VERSION = 1;
const STORE = 'profile';
const RECORD_KEY = 'current';
const OPEN_TIMEOUT_MS = 2000;

export class SaveOpenError extends Error {}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      // 隐私模式、被策略禁用等：同步抛出，连 request 都拿不到
      reject(new SaveOpenError(`打不开 IndexedDB：${String(error)}`));
      return;
    }

    const timer = setTimeout(() => {
      reject(new SaveOpenError('IndexedDB 打开超时（2 秒内没有任何回调）'));
    }, OPEN_TIMEOUT_MS);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(new SaveOpenError(`IndexedDB 打开失败：${String(request.error)}`));
    };
    request.onblocked = () => {
      clearTimeout(timer);
      reject(new SaveOpenError('IndexedDB 被另一个标签页占用，暂时打不开'));
    };
  });
}

export class IndexedDbSaveRepository implements SaveRepository {
  readonly kind = 'indexeddb' as const;

  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<IndexedDbSaveRepository> {
    if (typeof indexedDB === 'undefined') {
      throw new SaveOpenError('这个环境没有 IndexedDB');
    }
    return new IndexedDbSaveRepository(await openDatabase());
  }

  load(): Promise<ProfileState | null> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(RECORD_KEY);
      request.onsuccess = () => {
        const value = request.result as ProfileState | undefined;
        resolve(value ?? null);
      };
      request.onerror = () => reject(new Error(`读取存档失败：${String(request.error)}`));
    });
  }

  commit(next: ProfileState): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(next, RECORD_KEY);
      // **等事务完成，不是等请求成功**：请求成功只说明「被接受」，
      // 事务完成才说明真的落盘了。
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error(`写入存档被中止：${String(tx.error)}`));
      tx.onerror = () => reject(new Error(`写入存档失败：${String(tx.error)}`));
    });
  }

  clear(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(`清空存档失败：${String(tx.error)}`));
    });
  }

  close(): void {
    this.db.close();
  }
}
