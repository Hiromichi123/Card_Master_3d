/**
 * 应用里的那一份存档实例。
 *
 * 模块级单例：路由切换会卸载屏幕，存档不能跟着一起死。
 * 依赖在这里注入一次——时间、随机种子、数据版本、起始卡组——
 * 于是 `ProfileStore` 本身在单测里可以完全脱离浏览器。
 */

import { cardDatabase, slice } from '../data';
import { fixedClock, parseDayKey, systemClock, type Clock } from '../domain/progression/clock';
import { FailingSaveRepository } from '../services/save/FailingSaveRepository';
import { openSaveRepository } from '../services/save/openSaveRepository';
import type { SaveRepository } from '../services/save/SaveRepository';
import { ProfileStore } from './createProfileStore';
import { pushToast } from './toastStore';

let instance: ProfileStore | null = null;
let opening: Promise<ProfileStore> | null = null;

/** 起始卡组：切片里的演示玩家牌组（12 张，正好是卡组上限）。 */
function starterCardIds(): readonly string[] {
  const deck = slice.decks.find((entry) => entry.id === 'demo-player');
  return deck ? deck.cardIds : slice.cards.slice(0, 12).map((card) => card.cardId);
}

/**
 * 演示存档：开号即拥有全部有效卡。
 *
 * **这是一个临时的便利设定**，按需求加：现在要能在图鉴里浏览全部卡面、
 * 也方便验收组卡与商店。正式的存档应该让玩家从零收集——
 * 改回 `undefined` 就恢复成「只拥有起始卡组」。
 *
 * 只收 `status === 'complete'`：不完整的卡攻防冷却都是 0，放进库存会污染卡池与货架。
 * （2026-10-09 那 9 张 `#yoroi` 已补齐数据、转为 `complete`，因此**从这一版起
 * 也会入库**，图鉴总数从 247 变成 256；`incomplete-cards.json` 那份旧记录已经过期。）
 */
function ownedCardIds(): readonly string[] {
  return cardDatabase.definitions
    .filter((card) => card.status === 'complete')
    .map((card) => card.cardId);
}

/**
 * 开发期的可注入项。
 *
 * - `?day=YYYYMMDD` 固定「今天」，商店/每日刷新的浏览器用例靠它才不是碰运气；
 * - `?failsave=1` 让写入必定失败，用来验证「保存失败不得确认」。
 *
 * 两者都只在 DEV 下生效，生产构建里读到的永远是 `null`。
 */
function devDayOverride(): Date | null {
  if (!import.meta.env.DEV || typeof location === 'undefined') {
    return null;
  }
  const raw = new URLSearchParams(location.search).get('day');
  return raw ? parseDayKey(raw) : null;
}

function devFailSave(): boolean {
  if (!import.meta.env.DEV || typeof location === 'undefined') {
    return false;
  }
  return new URLSearchParams(location.search).get('failsave') === '1';
}

function makeClock(): Clock {
  const fixed = devDayOverride();
  return fixed ? fixedClock(fixed) : systemClock;
}

/** 随机种子。开发期固定，浏览器用例的抽卡结果才是可复现的。 */
function makeSeedSource(): () => number {
  const fixed = devDayOverride();
  if (fixed) {
    return () => fixed.getTime() % 2_147_483_647;
  }
  let counter = 0;
  return () => {
    counter += 1;
    return (Date.now() ^ (counter * 0x9e3779b1)) >>> 0;
  };
}

async function build(): Promise<ProfileStore> {
  const opened = await openSaveRepository();
  let repository: SaveRepository = opened.repository;
  if (devFailSave()) {
    repository = new FailingSaveRepository(repository);
  }
  return new ProfileStore({
    repository,
    clock: makeClock(),
    seedSource: makeSeedSource(),
    contentVersion: cardDatabase.contentVersion,
    starterCardIds: starterCardIds(),
    ownedCardIds: ownedCardIds(),
    // 导入时用来自查「这份存档里的 cardId 在当前卡库里还在不在」
    knownCardIds: new Set(cardDatabase.definitions.map((card) => card.cardId)),
    fallbackReason: opened.fallbackReason,
    onNotice: pushToast,
  });
}

/**
 * 取（必要时创建）应用级的存档实例。
 *
 * 并发调用共享同一个 promise——`<StrictMode>` 会让 effect 跑两次，
 * 第二次必须复用第一次的结果，而不是再开一个数据库连接。
 */
export function getProfileStore(): Promise<ProfileStore> {
  if (instance) {
    return Promise.resolve(instance);
  }
  if (!opening) {
    opening = build().then((store) => {
      instance = store;
      return store;
    });
  }
  return opening;
}
