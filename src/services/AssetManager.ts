import {
  DataTexture,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  type LoadingManager,
} from 'three';

/**
 * 纹理资源管理器（施工清单 P1「AssetManager 基础」）。
 *
 * 解决的问题来自旧版核查（`docs/LEGACY_AUDIT.md` 第 5 节）：
 * 旧版有全局字典无上限、多场景各自缓存、同一张图按尺寸反复缓存。
 * 这里把约定固定下来：
 *
 * - **URL 去重**：同一个 URL 的并发请求合并成同一个 Promise，只下载一次；
 * - **引用计数**：`acquire`/`release` 成对使用，计数不为 0 的纹理绝不被回收
 *   （不能销毁仍被其它场景或卡牌引用的贴图）；
 * - **预算 + LRU**：超过 `maxEntries` 时，从计数为 0 的纹理里淘汰最久未用的，
 *   并真正 `dispose()`，而不是只把 URL 从表里删掉却留下 GPU 资源；
 * - **失败占位**：加载失败的 URL 记下来，返回占位纹理，避免整场景崩掉，
 *   同时把失败列表暴露给调试页（P7 要给出可操作提示）。
 *
 * 所有权约定：`Texture` 由本管理器持有并负责 `dispose`，
 * 调用方只拿到只读引用，**不得**自行 dispose，也不得修改 `dispose` 行为。
 */

export type TextureTier = 'thumbnail' | 'battle' | 'detail';

interface Entry {
  readonly url: string;
  /** 已经解析好的纹理；尚未加载完时为 null。 */
  texture: Texture | null;
  /** 加载中的 Promise，用于合并并发请求。 */
  pending: Promise<Texture> | null;
  /** 引用计数，>0 时不可回收。 */
  refCount: number;
  /** 最近一次被使用的时间戳，用于 LRU。 */
  lastUsedAt: number;
  /** 加载失败的原因；非 null 表示这是一条失败记录。 */
  failure: string | null;
}

export interface AssetManagerStats {
  readonly entries: number;
  readonly ready: number;
  readonly pending: number;
  readonly resident: number;
  readonly failures: readonly { url: string; reason: string }[];
  readonly evictions: number;
  readonly duplicateHits: number;
}

const DEFAULT_MAX_ENTRIES = 320;

export class AssetManager {
  private readonly entries = new Map<string, Entry>();
  private readonly loader: TextureLoader;
  private readonly maxEntries: number;
  private evictions = 0;
  private duplicateHits = 0;
  private placeholder: Texture | null = null;

  constructor(options?: { manager?: LoadingManager; maxEntries?: number }) {
    this.loader = new TextureLoader(options?.manager);
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * 申请一个纹理。返回的引用必须由调用方在不再使用时 `release`。
   *
   * 并发调用同一 URL 会共享同一次加载（`duplicateHits` 记录合并次数）。
   */
  acquire(url: string): Promise<Texture> {
    const existing = this.entries.get(url);

    if (existing) {
      existing.refCount += 1;
      existing.lastUsedAt = performance.now();
      if (existing.texture) {
        return Promise.resolve(existing.texture);
      }
      if (existing.pending) {
        this.duplicateHits += 1;
        return existing.pending;
      }
      // 之前失败过的 URL：直接返回占位，不再重试，避免每帧重试拖死渲染
      return Promise.resolve(this.getPlaceholder());
    }

    const entry: Entry = {
      url,
      texture: null,
      pending: null,
      refCount: 1,
      lastUsedAt: performance.now(),
      failure: null,
    };
    this.entries.set(url, entry);

    entry.pending = this.loader
      .loadAsync(url)
      .then((texture) => {
        // 卡面是颜色贴图，必须按 sRGB 解释，否则整体偏暗
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 4;
        entry.texture = texture;
        entry.pending = null;
        this.evictIfNeeded();
        return texture;
      })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        entry.failure = reason;
        entry.pending = null;
        console.warn(`[AssetManager] 纹理加载失败：${url}（${reason}）`);
        // 失败也要给出可用对象，否则调用方要到处判空
        const fallback = this.getPlaceholder();
        entry.texture = fallback;
        return fallback;
      });

    return entry.pending;
  }

  /** 释放一次引用。计数归零后允许被 LRU 淘汰（不立即 dispose）。 */
  release(url: string): void {
    const entry = this.entries.get(url);
    if (!entry) {
      return;
    }
    entry.refCount = Math.max(0, entry.refCount - 1);
    entry.lastUsedAt = performance.now();
  }

  /**
   * 占位纹理：加载失败或尚未就绪时使用。所有失败共用一个实例。
   *
   * 必须用 `DataTexture`。手动 new 一个 `Texture` 再塞 `image = {data,...}`
   * 不是合法的纹理源，three 上传时会得到一张白色贴图——
   * 结果是「加载失败」表现为「整张卡面变白」，比直接报错更难查。
   */
  private getPlaceholder(): Texture {
    if (!this.placeholder) {
      // 4×4 洋红/黑格，肉眼一眼能看出是占位而不是正常贴图
      const size = 4;
      const data = new Uint8Array(size * size * 4);
      for (let i = 0; i < size * size; i += 1) {
        const magenta = (Math.floor(i / size) + (i % size)) % 2 === 0;
        data[i * 4 + 0] = magenta ? 255 : 32;
        data[i * 4 + 1] = magenta ? 0 : 32;
        data[i * 4 + 2] = magenta ? 200 : 32;
        data[i * 4 + 3] = 255;
      }
      const texture = new DataTexture(data, size, size, RGBAFormat);
      texture.colorSpace = SRGBColorSpace;
      texture.needsUpdate = true;
      this.placeholder = texture;
    }
    return this.placeholder;
  }

  /**
   * 超过预算时淘汰。
   *
   * 只回收 `refCount === 0` 的条目，并且**真正的 `dispose()`**——
   * 只删表项会让 GPU 上的纹理泄漏（这是旧版没有的问题，但很容易在新版写出来）。
   */
  private evictIfNeeded(): void {
    const resident = [...this.entries.values()].filter(
      (entry) => entry.texture !== null,
    );
    if (resident.length <= this.maxEntries) {
      return;
    }

    const candidates = resident
      .filter((entry) => entry.refCount === 0 && entry.texture !== this.placeholder)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);

    let over = resident.length - this.maxEntries;
    for (const entry of candidates) {
      if (over <= 0) {
        break;
      }
      entry.texture?.dispose();
      this.entries.delete(entry.url);
      this.evictions += 1;
      over -= 1;
    }
  }

  /** 释放全部资源。仅在确定没有任何场景在使用时调用。 */
  disposeAll(): void {
    for (const entry of this.entries.values()) {
      if (entry.texture && entry.texture !== this.placeholder) {
        entry.texture.dispose();
      }
    }
    this.entries.clear();
    this.placeholder?.dispose();
    this.placeholder = null;
  }

  stats(): AssetManagerStats {
    let ready = 0;
    let pending = 0;
    let resident = 0;
    const failures: { url: string; reason: string }[] = [];

    for (const entry of this.entries.values()) {
      if (entry.texture) {
        ready += 1;
        resident += 1;
      }
      if (entry.pending) {
        pending += 1;
      }
      if (entry.failure) {
        failures.push({ url: entry.url, reason: entry.failure });
      }
    }

    return {
      entries: this.entries.size,
      ready,
      pending,
      resident,
      failures,
      evictions: this.evictions,
      duplicateHits: this.duplicateHits,
    };
  }
}

/**
 * 全局实例。
 *
 * 单例是有意的：预算是全局的，多个管理器各管一份缓存就退回了旧版的老问题。
 * 场景只 acquire/release，不持有管理器生命周期。
 */
export const assetManager = new AssetManager();
