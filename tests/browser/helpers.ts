import { expect, type Page } from '@playwright/test';

import type { ProfileState } from '../../src/domain/progression/types';

/**
 * 浏览器用例共用的小工具。
 *
 * 抽出来的是**三件与「哪个屏幕」无关**的事：收集控制台/网络错误、
 * 点导航栏、开一个干净存档，以及直接读写 IndexedDB。
 * 屏幕自己的断言留在各自的 spec 里——那些才是用例真正要表达的东西。
 */

/** 控制台报错、未捕获异常、失败请求——三者任一都算问题。 */
export function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`requestfailed: ${request.url()}`));
  return problems;
}

/**
 * 点导航栏上的页签。
 *
 * **必须限定在 `.app-nav` 里**：主菜单的入口按钮也含同样的字样，
 * 而 `getByRole` 的 name 是子串匹配，直接按名字找会同时命中两个。
 */
export async function clickNav(page: Page, label: string): Promise<void> {
  await page.locator('.app-nav').getByRole('button', { name: label, exact: true }).click();
}

/** 开一个干净的存档（旧存档会带着上一轮的库存与货币）。 */
export async function openWithFreshSave(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.deleteDatabase('card-master-3d');
        request.onsuccess = request.onerror = request.onblocked = () => resolve(null);
      }),
  );
  await page.reload();
}

/** 存档库/仓/键的约定见 `IndexedDbSaveRepository`。 */
const DB_NAME = 'card-master-3d';
const STORE = 'profile';
const KEY = 'current';

/**
 * 直接读落盘的存档。
 *
 * 数值类断言一律走这里而不是读界面文本：界面文字对不对是另一回事，
 * 要证明的是「真的存下来了」。没有记录时返回 `undefined`——
 * **新档是「用到才写」的**，刚开的新号盘上可能还是空的。
 */
export async function readProfile(page: Page): Promise<ProfileState | undefined> {
  return page.evaluate(
    ([dbName, store, key]) =>
      new Promise<ProfileState | undefined>((resolve, reject) => {
        const open = indexedDB.open(dbName as string);
        open.onerror = () => reject(new Error('打不开存档库'));
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction(store as string, 'readonly')
            .objectStore(store as string)
            .get(key as string);
          request.onsuccess = () => {
            db.close();
            resolve(request.result as ProfileState | undefined);
          };
          request.onerror = () => reject(new Error('读不到存档记录'));
        };
      }),
    [DB_NAME, STORE, KEY],
  );
}

/** 改一份存档再写回去，用来造用例需要的初始状态。 */
export async function patchProfile(
  page: Page,
  patch: (profile: ProfileState) => ProfileState,
): Promise<void> {
  const current = await readProfile(page);
  if (!current) {
    throw new Error('存档还没落盘——先做一次真实改动，再调 patchProfile');
  }
  const next = patch(current);
  await page.evaluate(
    ([dbName, store, key, profile]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName as string);
        open.onerror = () => reject(new Error('打不开存档库'));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(store as string, 'readwrite');
          tx.objectStore(store as string).put(profile, key as string);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(new Error('写回存档失败'));
        };
      }),
    [DB_NAME, STORE, KEY, next],
  );
  await page.reload();
}

/** 库存里一共有多少张卡（所有条目求和）。 */
export function totalCards(profile: ProfileState | undefined): number {
  if (!profile) {
    return 0;
  }
  return Object.values(profile.inventory).reduce((sum, count) => sum + count, 0);
}

/**
 * 等某一项落盘。
 *
 * 存档写入有两条路径：经济事务是**悲观**的（`commitEconomic` 返回时已经落盘），
 * 设置/卡组是**防抖**的（点完立刻读盘只会读到旧值）。用例统一用这个等待，
 * 免得把「防抖还没到」误判成「没生效」。
 */
export async function expectPersisted<T>(
  page: Page,
  read: (profile: ProfileState) => T,
  expected: T,
): Promise<void> {
  await expect
    .poll(async () => {
      const profile = await readProfile(page);
      return profile ? read(profile) : undefined;
    })
    .toEqual(expected);
}
