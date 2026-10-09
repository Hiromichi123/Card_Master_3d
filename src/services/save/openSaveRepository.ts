import { IndexedDbSaveRepository } from './IndexedDbSaveRepository';
import { MemorySaveRepository } from './MemorySaveRepository';
import type { SaveRepository } from './SaveRepository';

export interface OpenedRepository {
  readonly repository: SaveRepository;
  /** 回退到内存时带上原因，界面要**常驻**显示它。 */
  readonly fallbackReason: string | null;
}

/**
 * 打开存档。
 *
 * IndexedDB 打不开就退回内存实现，**并把原因交出去**。
 * 静默不落盘是最坏的失败方式：玩家会以为进度存着，直到某天刷新发现全没了。
 * 所以调用方拿到 `fallbackReason` 之后必须挂一条看得见的横幅，
 * 而不是悄悄降级。登录流程传 requirePersistence=true，失败直接抛出，
 * 避免把打不开的已有账号存档误显示成临时新存档。
 */
export async function openSaveRepository(
  accountId = 'admin',
  requirePersistence = false,
): Promise<OpenedRepository> {
  try {
    return { repository: await IndexedDbSaveRepository.open(accountId), fallbackReason: null };
  } catch (error) {
    if (requirePersistence) {
      throw new Error(`无法打开账号存档：${error instanceof Error ? error.message : String(error)}`);
    }
    return {
      repository: new MemorySaveRepository(),
      fallbackReason: error instanceof Error ? error.message : String(error),
    };
  }
}
