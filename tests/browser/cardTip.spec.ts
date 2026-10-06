import { expect, test, type Page } from '@playwright/test';

import { clickNav, collectProblems, openWithFreshSave } from './helpers';

/**
 * 悬停卡牌详情的**全局**验证。
 *
 * 这一条特意跨三块屏跑：图鉴、商店、组卡（含**禁用态**）。
 * 它守的是一个全局机制（`CardTipHost` 的事件委托 + `[data-card-id]`），
 * 而不是某个界面自己接的悬停回调——早先组卡页就是自己接的，
 * 结果「卡组一满、每张收藏卡都 `disabled`、而禁用的按钮不派发鼠标事件」，
 * 整块屏都弹不出详情。
 */

async function readTip(page: Page): Promise<string | null> {
  const tip = page.locator('.cardtip');
  if ((await tip.count()) === 0) {
    return null;
  }
  return (await tip.locator('.cardtip__name').textContent())?.trim() ?? null;
}

/** 框必须整个落在视口里（贴在下方的卡上时最容易溢出）。 */
async function expectInsideViewport(page: Page): Promise<void> {
  const box = await page.locator('.cardtip').boundingBox();
  const viewport = page.viewportSize() ?? { width: 1920, height: 1080 };
  expect(box).not.toBeNull();
  if (box) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
}

test('悬停详情在图鉴、商店、组卡里都生效（含禁用态）', async ({ page }) => {
  const problems = collectProblems(page);
  await openWithFreshSave(page);

  // 图鉴：小卡格
  await clickNav(page, '图鉴');
  await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.tile').nth(3).hover();
  await expect(page.locator('.cardtip')).toBeVisible();
  expect(await readTip(page)).not.toBe('');
  await expectInsideViewport(page);
  // 移开收起
  await page.locator('.screen__title').hover();
  await expect(page.locator('.cardtip')).toHaveCount(0);

  // 商店：货位上的卡
  await clickNav(page, '商店');
  await expect(page.locator('.shop__item').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.shop__item').first().hover();
  await expect(page.locator('.cardtip')).toBeVisible();
  await expectInsideViewport(page);

  /*
    组卡：**卡组初始是满的，收藏里每一张都是 `disabled`**。
    浏览器不给禁用的按钮派发鼠标事件，所以这一格的事件落在外面那层
    带 `data-card-id` 的包装上——这条断言正是那个坑的回归。
  */
  await clickNav(page, '配置');
  await expect(page.locator('.deckedit__wrap').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.deckedit__wrap').first().hover();
  await expect(page.locator('.cardtip')).toBeVisible();
  await expectInsideViewport(page);

  // 槽位里的卡也一样（同一个机制，没有单独接）
  await page.locator('.deckedit__grid .tile').first().hover();
  await expect(page.locator('.cardtip')).toBeVisible();

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});
