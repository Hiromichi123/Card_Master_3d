import { expect, test, type Page } from '@playwright/test';

import { ADD_REJECTION_TEXT, DECK_LIMIT } from '../../src/domain/progression/deck';
import type { ProfileState } from '../../src/domain/progression/types';

/**
 * 配置（组卡）的浏览器验证。
 *
 * 三条规矩，避免断成「看起来对了」：
 *
 * 1. **数值类断言读 IndexedDB 的落盘值**，不读界面文本——界面文字对不对是另一回事，
 *    这里要证明的是「改动真的存下来了」；
 * 2. **文案类断言从领域常量反查**（`ADD_REJECTION_NOTE` 等），不在用例里抄一遍中文；
 * 3. **删卡断的是「按下标删」**：用例先把同一张卡放进卡组三次，再删中间那一个——
 *    这样「按 cardId 过滤」的错误实现会立刻露馅（它会删掉第一张）。
 */

function collectProblems(page: Page): string[] {
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

async function clickNav(page: Page, label: string): Promise<void> {
  await page.locator('.app-nav').getByRole('button', { name: label, exact: true }).click();
}

/** 开一个干净的存档（旧存档会带着上一轮改过的卡组）。 */
async function openWithFreshSave(page: Page): Promise<void> {
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

/** 直接读落盘的存档：断「存下来了」而不是「界面写着」。 */
async function readProfile(page: Page): Promise<ProfileState | undefined> {
  return page.evaluate(
    () =>
      new Promise<ProfileState | undefined>((resolve, reject) => {
        const open = indexedDB.open('card-master-3d');
        open.onerror = () => reject(new Error('打不开存档库'));
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('profile', 'readonly')
            .objectStore('profile')
            .get('current');
          request.onsuccess = () => {
            db.close();
            resolve(request.result as ProfileState | undefined);
          };
          request.onerror = () => reject(new Error('读不到存档记录'));
        };
      }),
  );
}

/**
 * 把存档逼到盘上。
 *
 * **新档是「用到才写」的**（`saveStore.test.ts` 有一条用例专门守着
 * 「无存档时建新且不立刻写盘」）。所以刚开的新号在 IndexedDB 里**还没有记录**，
 * 这时直接改盘上的存档会写出一个残缺对象。做法是先做一次真实改动
 * （移出一张再放回去），让它走一遍界面自己的防抖落盘。
 */
async function ensurePersisted(page: Page): Promise<void> {
  const ids = await slotIds(page);
  const target = ids[0] as string;
  await page.locator(`.deckedit__grid .tile[data-card-id="${target}"]`).click();
  await expect.poll(async () => (await slotIds(page)).filter(Boolean).length).toBe(
    DECK_LIMIT - 1,
  );
  await collectionTile(page, target).click();
  await expect.poll(async () => (await slotIds(page)).filter(Boolean).length).toBe(DECK_LIMIT);
  await expect.poll(async () => (await readProfile(page)) !== undefined).toBe(true);
}

/** 改一份存档再写回去，用来造用例需要的初始状态（例如同一张卡有 3 张）。 */
async function patchProfile(
  page: Page,
  patch: (profile: ProfileState) => ProfileState,
): Promise<void> {
  const current = await readProfile(page);
  if (!current) {
    throw new Error('存档还没落盘——先调 ensurePersisted(page) 再做 patch');
  }
  const next = patch(current);
  await page.evaluate(
    (profile) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('card-master-3d');
        open.onerror = () => reject(new Error('打不开存档库'));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('profile', 'readwrite');
          tx.objectStore('profile').put(profile, 'current');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(new Error('写回存档失败'));
        };
      }),
    next,
  );
  await page.reload();
}

/** 左侧 12 槽的卡 id 顺序，空槽是 null。 */
async function slotIds(page: Page): Promise<(string | null)[]> {
  return page.evaluate(() => {
    const grid = document.querySelector('.deckedit__grid');
    if (!grid) {
      return [];
    }
    return [...grid.children].map((child) =>
      child instanceof HTMLElement ? (child.dataset['cardId'] ?? null) : null,
    );
  });
}

/** 收藏里某张卡的那个格子。 */
function collectionTile(page: Page, cardId: string) {
  return page.locator(`.deckedit__collection .tile[data-card-id="${cardId}"]`);
}

/**
 * 刷新之后回到配置页。
 *
 * **路由不在 URL 里**（`App.tsx` 用的是一个 `useState`，这是刻意的：
 * 屏幕是挂载/卸载式的，没有历史栈）。所以 `page.reload()` 之后一定落在主菜单，
 * 每个「刷新」后面的断言都得先点回配置——忘了这一步的用例会以
 * 「找不到 .deckedit__grid」失败，而那不是界面的问题。
 */
async function reopenDeckEditor(page: Page): Promise<void> {
  await clickNav(page, '配置');
  await expect(page.locator('.deckedit__grid')).toBeVisible({ timeout: 30_000 });
}

async function openDeckEditor(page: Page): Promise<void> {
  await openWithFreshSave(page);
  await reopenDeckEditor(page);
}

test('导航里「配置」在图鉴前面，且不再有「组卡」', async ({ page }) => {
  await page.goto('/');
  const labels = await page.locator('.app-nav__tab').allTextContents();
  const deck = labels.findIndex((label) => label.startsWith('配置'));
  const collection = labels.findIndex((label) => label.startsWith('图鉴'));

  expect(deck, '导航里找不到「配置」').toBeGreaterThanOrEqual(0);
  expect(collection).toBeGreaterThanOrEqual(0);
  expect(deck).toBeLessThan(collection);
  expect(labels.some((label) => label.startsWith('组卡'))).toBe(false);
});

test('点击移出一张、再点回来一张，刷新后顺序不变', async ({ page }) => {
  const problems = collectProblems(page);
  await openDeckEditor(page);

  const before = await slotIds(page);
  expect(before).toHaveLength(DECK_LIMIT);
  expect(before.every((id) => id !== null)).toBe(true);

  /*
    初始卡组是满的：每一张收藏卡都点不动，但**「卡组已满」只提示一次**
    （两百多张卡重复同一个角标只会盖住卡面）。逐卡角标留给
    「已上阵」「不认识的卡」这类每张卡不一样的理由。
  */
  const first = before[0] as string;
  await expect(collectionTile(page, first)).toBeDisabled();
  await expect(page.getByTestId('deck-full')).toContainText(ADD_REJECTION_TEXT.full);
  await expect(collectionTile(page, first).locator('.tile__note')).toHaveCount(0);

  // 移出第一张 → 它的可用张数变成 1，卡片重新可点
  await page.locator(`.deckedit__grid .tile[data-card-id="${first}"]`).click();
  await expect.poll(async () => (await slotIds(page)).length).toBe(DECK_LIMIT);
  const afterRemove = await slotIds(page);
  expect(afterRemove.filter(Boolean)).toHaveLength(DECK_LIMIT - 1);
  // 按下标删：剩下的是原来第 2..12 张，顺序保持
  expect(afterRemove.slice(0, DECK_LIMIT - 1)).toEqual(before.slice(1));

  await expect(collectionTile(page, first)).toBeEnabled();
  await expect(collectionTile(page, first).locator('.tile__badge')).toHaveText('×1');

  // 点回来 → 追加到末尾，仍是 12 张
  await collectionTile(page, first).click();
  await expect.poll(async () => (await slotIds(page)).filter(Boolean).length).toBe(DECK_LIMIT);
  expect(await slotIds(page)).toEqual([...before.slice(1), first]);

  /*
    **切到别的屏幕再回来**：改动仍在。离开配置页会触发 `store.flush()`，
    这一条断的就是那条离场钩子——它是「路由是挂载/卸载式」这个设计的直接红利。
  */
  await clickNav(page, '图鉴');
  await expect(page.locator('.collection__lead')).toBeVisible({ timeout: 30_000 });
  await reopenDeckEditor(page);
  expect(await slotIds(page)).toEqual([...before.slice(1), first]);

  /*
    **落盘**：不点任何保存按钮，等防抖队列自己写完（`saveDeck` 是 300ms 合并写入），
    再硬刷新，卡组顺序仍然一致。

    这里必须**先等盘上的值变了再刷新**：防抖窗口内直接 `Ctrl+R` 会丢掉那一次改动
    （`flush()` 靠组件卸载触发，而整页刷新不会卸载 React 树）。
    这是既有设计的已知边界，不是这次引入的——写在这里免得以后有人
    把这条用例改成「点完立刻刷新」，然后收获一个随机失败的用例。
  */
  await expect
    .poll(async () => (await readProfile(page))?.decks[0]?.cardIds ?? [])
    .toEqual([...before.slice(1), first]);

  await page.reload();
  await reopenDeckEditor(page);
  expect(await slotIds(page)).toEqual([...before.slice(1), first]);
  expect((await readProfile(page))?.decks[0]?.cardIds).toEqual([...before.slice(1), first]);

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('重复卡按下标删：删掉的是点的那一张，不是同名的第一张', async ({ page }) => {
  const problems = collectProblems(page);
  await openDeckEditor(page);

  await ensurePersisted(page);

  // 造出「同一张卡有 3 张可用」：把库存里第一张卡改成 3 份
  const starter = await slotIds(page);
  const target = starter[0] as string;
  await patchProfile(page, (profile) => ({
    ...profile,
    inventory: { ...profile.inventory, [target]: 3 },
  }));
  await reopenDeckEditor(page);

  // 腾出两个位置（移掉原来第 2、3 张），再把目标卡加两次
  const ids = await slotIds(page);
  await page.locator(`.deckedit__grid .tile[data-card-id="${ids[1]}"]`).click();
  await expect.poll(async () => (await slotIds(page)).filter(Boolean).length).toBe(11);
  await page.locator(`.deckedit__grid .tile[data-card-id="${ids[2]}"]`).click();
  await expect.poll(async () => (await slotIds(page)).filter(Boolean).length).toBe(10);

  await collectionTile(page, target).click();
  await expect.poll(async () => (await slotIds(page)).filter(Boolean).length).toBe(11);
  await collectionTile(page, target).click();
  await expect.poll(async () => (await slotIds(page)).filter(Boolean).length).toBe(12);

  const withThree = await slotIds(page);
  expect(withThree.filter((id) => id === target)).toHaveLength(3);
  const lastIndex = withThree.lastIndexOf(target);
  expect(lastIndex).toBe(DECK_LIMIT - 1);

  // 删掉**最后一个** target：若实现是「按 cardId 过滤」，删掉的会是第 0 个
  await page.locator(`.deckedit__grid .tile[data-card-id="${target}"]`).last().click();
  await expect
    .poll(async () => (await slotIds(page)).filter(Boolean).length)
    .toBe(DECK_LIMIT - 1);

  const afterRemove = await slotIds(page);
  expect(afterRemove[0]).toBe(target);
  expect(afterRemove.filter((id) => id === target)).toHaveLength(2);
  expect(afterRemove.filter(Boolean)).toEqual(withThree.filter(Boolean).slice(0, -1));

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('没有出战卡组时可以把它启用', async ({ page }) => {
  const problems = collectProblems(page);
  await openDeckEditor(page);

  await ensurePersisted(page);

  // `activeDeckOf` 为 null：界面不该让人编辑一份没有归属的草稿
  await patchProfile(page, (profile) => ({ ...profile, activeDeckId: null }));
  await clickNav(page, '配置');
  await expect(page.locator('.deckedit__empty-actions')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.deckedit__grid')).toHaveCount(0);

  await page.getByRole('button', { name: /^启用/ }).click();
  await expect(page.locator('.deckedit__grid')).toBeVisible();
  expect(await slotIds(page)).toHaveLength(DECK_LIMIT);
  /*
    「设为出战」走的是防抖写入（`setActiveDeck` 与 `saveDeck` 同一条队列），
    点完立刻读盘只会读到 null——**轮询**等它落盘，别把防抖当成没生效。
  */
  await expect
    .poll(async () => (await readProfile(page))?.activeDeckId ?? null)
    .not.toBeNull();

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});
