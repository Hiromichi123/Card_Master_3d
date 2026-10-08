/**
 * 存档的状态机。
 *
 * **刻意是一个类 + `useSyncExternalStore`，不是 zustand。** 四个理由：
 *
 * 1. 它要在 React 之外被读写——启动加载发生在前几次渲染之间，
 *    结算由 effect 触发，toast 上的「重试」按钮也要直接调回来；
 * 2. 路由切换会**卸载**屏幕（`App.tsx` 是挂载/卸载而不是堆叠），
 *    身份必须活在模块级，否则每次切页都重新读一遍存档；
 * 3. `getSnapshot` 必须返回缓存对象（`useSyncExternalStore` 用 `Object.is` 比较），
 *    这一点 `BattleSession` 已经踩过并解决了，照抄它的 `publish()` 模式；
 * 4. 「每个屏幕读同一份内存快照」要的就是一个对象；
 *    按字段订阅反而会在 256 键的库存表上产生逐字段的重渲染抖动。
 *
 * 运行期低频 UI 状态（设置、toast）继续用 zustand——那是它擅长的。
 */

import {
  applyEconomyTransaction,
  type ApplyOutcome,
} from '../domain/progression/economy';
import { dayKeyOf, type Clock } from '../domain/progression/clock';
import { activeDeckOf, createInitialProfile, withActiveDeck, withDeck, withMazeRun, withSettings, withoutDeck } from '../domain/progression/profile';
import type { Planned } from '../domain/progression/plan';
import type {
  Deck,
  MazeRunState,
  ProfileState,
  SettingsState,
} from '../domain/progression/types';
import type { SaveRepository, StorageKind } from '../services/save/SaveRepository';
import {
  detectSaveFormat,
  looksLikeProfile,
  normalizeProfile,
  parseSaveJson,
  planLegacyImport,
  type ImportFailureReason,
  type ImportFile,
  type ImportPreview,
  type ImportResult,
  type LegacyPlan,
  type NormalizeContext,
  type SaveFormat,
} from '../domain/progression/saveTransfer';

/**
 * 一次导入的解析结果。
 *
 * 分成「已成形的新版候选」与「旧版增量计划」两支：前者整份替换，
 * 后者经 `applyEconomyTransaction` 合并。**解析在队列内部完成**，
 * 读到的「当前存档」才是最新那一份。
 */
type ImportPlan =
  | { readonly ok: false; readonly preview: ImportPreview }
  | {
      readonly ok: true;
      readonly kind: 'profile';
      readonly preview: ImportPreview;
      readonly profile: ProfileState;
      readonly detected: SaveFormat;
    }
  | {
      readonly ok: true;
      readonly kind: 'legacy';
      readonly preview: ImportPreview;
      readonly legacy: LegacyPlan;
      readonly detected: SaveFormat;
    };

export type SaveStatus = 'loading' | 'ready' | 'error';

export type EconomicResult<TView> =
  | { readonly ok: true; readonly view: TView; readonly revision: number }
  | { readonly ok: false; readonly reason: 'rejected' | 'saveFailed'; readonly message: string };

export interface ProfileSnapshot {
  readonly status: SaveStatus;
  readonly storage: StorageKind;
  /** 打不开 IndexedDB 时的原因；非空时界面要挂常驻横幅。 */
  readonly fallbackReason: string | null;
  /** 只在 `ready` 之后非 null。**整体缓存**，不要每次新建。 */
  readonly profile: ProfileState | null;
  readonly error: string | null;
  /** 有经济事务在飞。界面据此禁用按钮并显示「处理中」。 */
  readonly busy: boolean;
  /** 最近一次成功事务带回来的视图，供结算页/抽卡页读取。 */
  readonly lastResult: unknown;
}

export interface ProfileStoreDeps {
  readonly repository: SaveRepository;
  readonly clock: Clock;
  /** 抽卡/礼包的随机种子。测试注入固定值。 */
  readonly seedSource: () => number;
  readonly contentVersion: string;
  /** 起始卡组。新号直接能玩靠它。 */
  readonly starterCardIds: readonly string[];
  /** 开号时一并放进库存的卡。不给就只拥有起始卡组那几张。 */
  readonly ownedCardIds?: readonly string[] | undefined;
  /**
   * 当前卡库认识的 cardId。导入时用来判断库存/卡组里的项是否真的存在。
   * 可选：不给就跳过「认不认识」这层校验（测试构造时不必准备一份卡库）。
   */
  readonly knownCardIds?: ReadonlySet<string> | undefined;
  readonly fallbackReason?: string | null;
  /** 失败/拒绝时的提示出口。 */
  readonly onNotice?: (message: string, tone: 'info' | 'error') => void;
  readonly debounceMs?: number;
}

/** 会话级幂等：同一 `operationId` 重复提交不得重复生效。不落盘，理由见类注释。 */
const APPLIED_OPERATION_LIMIT = 256;

export class ProfileStore {
  private snapshot: ProfileSnapshot;
  private profile: ProfileState | null = null;
  private loadPromise: Promise<void> | null = null;

  private queue: Promise<unknown> = Promise.resolve();
  private pendingSettings: Partial<SettingsState> | null = null;
  private pendingDeck: Deck | null = null;
  private pendingDeleteDeckId: string | null = null;
  private pendingActiveDeckId: string | null | undefined;
  /** `undefined` = 没有待写的迷宫状态（区别于「要写 null」）。 */
  private pendingMazeRun: MazeRunState | null | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private opSeq = 0;
  private readonly appliedOperationIds: string[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: ProfileStoreDeps) {
    this.snapshot = {
      status: 'loading',
      storage: deps.repository.kind,
      fallbackReason: deps.fallbackReason ?? null,
      profile: null,
      error: null,
      busy: false,
      lastResult: null,
    };
  }

  // --- 订阅 ---------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ProfileSnapshot => this.snapshot;

  private publish(patch: Partial<ProfileSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  // --- 加载 ---------------------------------------------------------------

  /**
   * 加载。**幂等**：`main.tsx` 用了 `<StrictMode>`，effect 会跑两次，
   * 第二次必须复用第一次的 promise，而不是再开一个数据库连接。
   */
  load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadOnce();
    }
    return this.loadPromise;
  }

  private async loadOnce(): Promise<void> {
    try {
      const stored = await this.deps.repository.load();
      const profile =
        stored ??
        createInitialProfile({
          contentVersion: this.deps.contentVersion,
          dayKey: dayKeyOf(this.deps.clock()),
          starterCardIds: this.deps.starterCardIds,
          ownedCardIds: this.deps.ownedCardIds,
          now: this.deps.clock(),
        });
      this.profile = profile;
      // 新号**不立刻写盘**：玩家还没做任何事。
      // 第一次真正的写入由第一个动作触发，这样「存档到底写成功过没有」是可见的。
      this.publish({ status: 'ready', profile, error: null });
    } catch (error) {
      this.publish({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --- 事务 ---------------------------------------------------------------

  /**
   * 「今天」的日键（`YYYYMMDD`）。
   *
   * 走**存档自己那个时钟**，不是 `new Date()`——开发期的 `?day=YYYYMMDD`
   * 覆盖的是这个时钟，商店的每日货架要跟着它走，否则浏览器用例
   * 会在「今天恰好是什么货架」上随机失败（`clock.ts` 开头记着这条）。
   */
  todayKey(): string {
    return dayKeyOf(this.deps.clock());
  }

  nextOperationId(): string {
    this.opSeq += 1;
    return `op-${this.opSeq}-${this.deps.seedSource().toString(36)}`;
  }

  /**
   * 提交一次经济事务。
   *
   * **悲观，不乐观**：没有任何一条路径能在 `repository.commit` 成功之前
   * 把新状态发布出去。这就是「保存失败时界面不得确认」的结构性保证——
   * 不是靠纪律，是根本没写那条路。
   */
  async commitEconomic<TView>(
    plan: (profile: ProfileState) => Planned<TView>,
  ): Promise<EconomicResult<TView>> {
    if (this.snapshot.busy) {
      return { ok: false, reason: 'rejected', message: '上一个操作还在处理中' };
    }
    const profile = this.profile;
    if (!profile) {
      return { ok: false, reason: 'rejected', message: '存档还没加载完' };
    }

    // 有排队中的设置/卡组写入就先放出去，否则它会一直压在这次事务后面
    this.flushDebounced();
    this.publish({ busy: true });

    try {
      const result = await this.enqueue(async (): Promise<EconomicResult<TView>> => {
        const current = this.profile;
        if (!current) {
          return { ok: false, reason: 'rejected', message: '存档还没加载完' };
        }
        const planned = plan(current);
        if ('rejected' in planned) {
          return { ok: false, reason: 'rejected', message: planned.rejected };
        }
        if (this.appliedOperationIds.includes(planned.transaction.operationId)) {
          return { ok: false, reason: 'rejected', message: '这一步已经处理过了' };
        }

        const outcome: ApplyOutcome = applyEconomyTransaction(current, planned.transaction);
        if (!outcome.applied) {
          return {
            ok: false,
            reason: 'rejected',
            message: REJECT_TEXT[outcome.reason ?? 'insufficientFunds'] ?? '这一步无法完成',
          };
        }

        await this.deps.repository.commit(outcome.profile);
        this.rememberOperation(planned.transaction.operationId);
        this.profile = outcome.profile;
        this.publish({ profile: outcome.profile, lastResult: planned.view });
        return { ok: true, view: planned.view, revision: outcome.profile.revision };
      });

      if (!result.ok) {
        this.deps.onNotice?.(result.message, 'info');
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // **不 publish 任何新状态**：快照仍是提交前那一份
      this.deps.onNotice?.(`保存失败：${message}`, 'error');
      return { ok: false, reason: 'saveFailed', message };
    } finally {
      this.publish({ busy: false });
    }
  }

  /** 读最近一次成功事务的视图（结算页/抽卡页用）。 */
  get lastResult(): unknown {
    return this.snapshot.lastResult;
  }

  // --- 设置与卡组（防抖，合并保存）----------------------------------------

  updateSettings(patch: Partial<SettingsState>): void {
    this.pendingSettings = { ...(this.pendingSettings ?? {}), ...patch };
    this.scheduleDebounce();
  }

  saveDeck(deck: Deck): void {
    this.pendingDeck = deck;
    this.scheduleDebounce();
  }

  /**
   * 写迷宫 run 状态（走到哪 / 探索了哪些 / 每个节点的商店）。
   *
   * 与 `saveDeck` 同一条防抖合并队列：迷宫移动是低频操作，
   * 丢了最坏回到上一次落盘的位置——不值得为它开一条悲观事务。
   * 与结算不打架是既有机制保证的：`commitEconomic` 开头会 `flushDebounced()`，
   * 待写的 run 先入队，结算读到的就是新位置。
   */
  saveMazeRun(run: MazeRunState | null): void {
    this.pendingMazeRun = run;
    this.scheduleDebounce();
  }

  deleteDeck(deckId: string): void {
    this.pendingDeleteDeckId = deckId;
    this.scheduleDebounce();
  }

  setActiveDeck(deckId: string | null): void {
    this.pendingActiveDeckId = deckId;
    this.scheduleDebounce();
  }

  private scheduleDebounce(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushDebounced();
    }, this.deps.debounceMs ?? 300);
  }

  /**
   * 把排队中的合并写入推出去。
   *
   * **排队的是补丁，不是快照**——在队列内部才去读当前 profile。
   * 否则一次晚到的设置写入会把已经更新过的货币值写回旧的，
   * 这正是这一层最怕的那类交错。
   */
  private flushDebounced(): void {
    const settings = this.pendingSettings;
    const deck = this.pendingDeck;
    const deleteId = this.pendingDeleteDeckId;
    const activeId = this.pendingActiveDeckId;
    const mazeRun = this.pendingMazeRun;
    this.pendingSettings = null;
    this.pendingDeck = null;
    this.pendingDeleteDeckId = null;
    this.pendingActiveDeckId = undefined;
    this.pendingMazeRun = undefined;

    if (settings) {
      void this.enqueue(() => this.persist((p) => withSettings(p, settings)));
    }
    if (deck) {
      void this.enqueue(() => this.persist((p) => withDeck(p, deck)));
    }
    if (deleteId) {
      void this.enqueue(() => this.persist((p) => withoutDeck(p, deleteId)));
    }
    if (activeId !== undefined) {
      void this.enqueue(() => this.persist((p) => withActiveDeck(p, activeId)));
    }
    if (mazeRun !== undefined) {
      void this.enqueue(() => this.persist((p) => withMazeRun(p, mazeRun)));
    }
  }

  /** 等所有排队中的写入落盘。离开设置/组卡页时调用，**不挂 `beforeunload`**。 */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flushDebounced();
    await this.queue;
  }

  private async persist(mutate: (profile: ProfileState) => ProfileState): Promise<void> {
    const current = this.profile;
    if (!current) {
      return;
    }
    const next = mutate(current);
    if (next === current) {
      return;
    }
    try {
      await this.deps.repository.commit(next);
      this.profile = next;
      this.publish({ profile: next });
    } catch (error) {
      this.deps.onNotice?.(
        `保存失败：${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
    }
  }

  // --- 队列 ---------------------------------------------------------------

  /**
   * 单条 FIFO 队列。
   *
   * **前一个失败不得卡死队列**，所以接的是 `then(work, work)`：
   * 成功与失败都继续往下跑。写操作之间因此永远不会交错，
   * 也不会有「旧写入盖掉新状态」。
   */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private rememberOperation(operationId: string): void {
    this.appliedOperationIds.push(operationId);
    if (this.appliedOperationIds.length > APPLIED_OPERATION_LIMIT) {
      this.appliedOperationIds.shift();
    }
  }

  // --- 其它 ---------------------------------------------------------------

  getRepository(): SaveRepository {
    return this.deps.repository;
  }

  getActiveDeck(): Deck | null {
    return this.profile ? activeDeckOf(this.profile) : null;
  }

  // --- 导入导出 -----------------------------------------------------------

  /**
   * 导出当前存档为 JSON 文本（带缩进，两份存档可以直接 diff）。
   *
   * **不用 `repository.load()`**：那是磁盘读，会落后于防抖通道里还没落盘的
   * 设置/卡组补丁（刚把音量调了就导出，盘上还是旧的），而且可能 reject。
   * 先 `flush()` 把队列推平，再读内存里那一份——它永远不旧于磁盘
   * （`commitEconomic` 与 `persist` 都只在 commit 成功后才赋值）。
   *
   * 不加外层包装：导出的就是 IndexedDB 里那一条记录本身，`schemaVersion`
   * 已在其中，于是「导出 → 导入 → 再导出」逐字节幂等。
   */
  async exportProfile(): Promise<string | null> {
    await this.flush();
    const profile = this.profile;
    return profile ? JSON.stringify(profile, null, 2) : null;
  }

  /** 只解析、只校验，不写盘、不碰快照。给导入预览用。 */
  previewImport(files: readonly ImportFile[]): ImportPreview {
    return this.importPlan(files).preview;
  }

  /**
   * 解析 + 校验 + 悲观提交。**任何失败都不改动原存档**（内存与磁盘都保持原样）。
   *
   * 走 `repository.commit`（整份一次 `put`，本身原子），**不开新事务通道**：
   * 新增一条写入路径只会多一处可能与 `persist` / `commitEconomic` 交错的地方。
   * 必须排在**同一条队列**上，否则一次在飞的事务可能被导入覆盖。
   */
  async importProfile(files: readonly ImportFile[]): Promise<ImportResult> {
    if (this.snapshot.busy) {
      return { ok: false, reason: 'busy', message: '上一个操作还在处理中' };
    }
    if (!this.profile) {
      return { ok: false, reason: 'invalidShape', message: '存档还没加载完' };
    }
    // 待写的设置/卡组先出去，别被导入覆盖，也别一直压在它后面
    this.flushDebounced();
    this.publish({ busy: true });

    try {
      const result = await this.enqueue(async (): Promise<ImportResult> => {
        const current = this.profile;
        if (!current) {
          return { ok: false, reason: 'invalidShape', message: '存档还没加载完' };
        }
        const plan = this.importPlan(files);
        if (!plan.ok) {
          return {
            ok: false,
            reason: plan.preview.reason ?? 'invalidShape',
            message: plan.preview.message,
          };
        }

        if (plan.kind === 'profile') {
          const committed = await this.replaceProfile(plan.profile);
          if (!committed) {
            return { ok: false, reason: 'saveFailed', message: '写盘失败，原存档未改动。' };
          }
          return { ok: true, format: 'profile', revision: plan.profile.revision };
        }

        // 旧版：货币 + 卡牌是**一次原子写**（形状正好是经济事务）
        const outcome = applyEconomyTransaction(current, {
          operationId: this.nextOperationId(),
          ...plan.legacy.transaction,
        });
        if (!outcome.applied) {
          return {
            ok: false,
            reason: 'invalidShape',
            message: REJECT_TEXT[outcome.reason ?? 'insufficientFunds'] ?? '这一步无法完成',
          };
        }
        const committed = await this.replaceProfile(outcome.profile);
        if (!committed) {
          return { ok: false, reason: 'saveFailed', message: '写盘失败，原存档未改动。' };
        }
        // 卡组单独一笔（防抖通道）：不扩 EconomyTransaction，界面已注明
        if (plan.legacy.deck) {
          this.saveDeck(plan.legacy.deck);
        }
        return { ok: true, format: plan.detected, revision: outcome.profile.revision };
      });

      if (!result.ok) {
        this.deps.onNotice?.(result.message, 'error');
      }
      return result;
    } finally {
      this.publish({ busy: false });
    }
  }

  /** 整份替换。**成功才赋值** `this.profile`——与 `persist` 同一纪律，但把成败交出去。 */
  private async replaceProfile(next: ProfileState): Promise<boolean> {
    try {
      await this.deps.repository.commit(next);
    } catch (error) {
      this.deps.onNotice?.(
        `导入失败：${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
      return false;
    }
    this.profile = next;
    // 换了一份存档，会话级的幂等账本必须清掉
    this.appliedOperationIds.length = 0;
    this.publish({ profile: next, lastResult: null });
    return true;
  }

  private normalizeContext(): NormalizeContext {
    return {
      knownCardIds: this.deps.knownCardIds ?? new Set<string>(),
      contentVersion: this.deps.contentVersion,
      dayKey: dayKeyOf(this.deps.clock()),
      now: this.deps.clock(),
    };
  }

  private importPlan(files: readonly ImportFile[]): ImportPlan {
    const fail = (reason: ImportFailureReason, message: string): ImportPlan => ({
      ok: false,
      preview: {
        ok: false,
        format: 'unknown',
        message,
        reason,
        profile: null,
        legacy: [],
        issues: [],
        warnings: [],
        summary: [],
      },
    });

    if (files.length === 0) {
      return fail('unknownFormat', '没有选择文件。');
    }

    // 1) 逐份解析 + 判形
    const parsed: { readonly format: SaveFormat; readonly raw: unknown }[] = [];
    const warnings: string[] = [];
    for (const file of files) {
      const result = parseSaveJson(file.text);
      if (!result.ok) {
        return fail('invalidJson', `${file.name}：${result.message}`);
      }
      const format = detectSaveFormat(result.raw);
      if (format === 'unknown') {
        if (looksLikeProfile(result.raw)) {
          return fail(
            'invalidShape',
            `${file.name}：有 inventory / currencies，但没有合法的 schemaVersion，读不了。`,
          );
        }
        return fail(
          'unknownFormat',
          `${file.name}：认不出这是什么（既不是新版存档，也不是旧版的 inventory / profile / deck）。`,
        );
      }
      parsed.push({ format, raw: result.raw });
    }

    // 2) 一次只认一种格式：新版是整份替换、旧版是增量合并，混在一起没有原子语义
    const formats = new Set(parsed.map((entry) => entry.format));
    if (formats.size > 1) {
      return fail(
        'mixedFormats',
        '一次只能导入一种格式：新版存档是整份替换、旧版是增量合并，混在一次里没有原子语义。请分开导入。',
      );
    }
    const format = parsed[0]!.format;

    if (format === 'profile') {
      if (parsed.length > 1) {
        warnings.push(`选择了 ${parsed.length} 份新版存档，只用了第一份，其余忽略。`);
      }
      const normalized = normalizeProfile(parsed[0]!.raw, this.normalizeContext());
      if (!normalized.ok) {
        return fail(normalized.reason, normalized.message);
      }
      const totals = Object.values(normalized.profile.inventory).reduce((sum, n) => sum + n, 0);
      const summary = [
        `整份替换：${Object.keys(normalized.profile.inventory).length} 种 / ${totals} 张卡`,
        `${normalized.profile.currencies.gold} 金币、${normalized.profile.currencies.crystal} 水晶`,
        `${normalized.profile.decks.length} 套卡组`,
      ];
      return {
        ok: true,
        kind: 'profile',
        profile: normalized.profile,
        detected: 'profile',
        preview: {
          ok: true,
          format: 'profile',
          message: '这是一份新版存档。导入会整份替换当前存档（货币、库存、卡组、设置全部覆盖）。',
          profile: normalized.profile,
          legacy: [],
          issues: normalized.issues,
          warnings: [...warnings, ...normalized.warnings],
          summary,
        },
      };
    }

    // 3) 旧版：三份预览 + 一笔增量事务
    const legacy = planLegacyImport(
      parsed.map((entry) => ({ format: entry.format, raw: entry.raw })),
      { knownCardIds: this.deps.knownCardIds ?? new Set<string>() },
    );
    const issues: string[] = [];
    for (const preview of legacy.previews) {
      if (preview.unknown.length > 0) {
        issues.push(`${preview.sourcePath}：有 ${preview.unknown.length} 项认不出来（见下方明细）。`);
      }
    }
    return {
      ok: true,
      kind: 'legacy',
      detected: format,
      legacy,
      preview: {
        ok: true,
        format,
        message: '这是旧版存档。导入会把认出来的卡与货币**并进**当前存档，不覆盖已有的东西。',
        profile: null,
        legacy: legacy.previews,
        issues,
        warnings,
        summary: legacy.summary.length > 0 ? legacy.summary : ['没有可导入的内容。'],
      },
    };
  }

  /** 测试与「重置存档」用。 */
  async resetProfile(): Promise<void> {
    await this.deps.repository.clear();
    const fresh = createInitialProfile({
      contentVersion: this.deps.contentVersion,
      dayKey: dayKeyOf(this.deps.clock()),
      starterCardIds: this.deps.starterCardIds,
      ownedCardIds: this.deps.ownedCardIds,
      now: this.deps.clock(),
    });
    this.profile = fresh;
    await this.deps.repository.commit(fresh);
    this.publish({ profile: fresh, lastResult: null });
  }

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.listeners.clear();
  }
}

const REJECT_TEXT: Record<ApplyOutcome['reason'] & string, string> = {
  insufficientFunds: '余额不足',
  insufficientCards: '卡牌不够',
  alreadySettled: '这一局已经结算过了',
};
