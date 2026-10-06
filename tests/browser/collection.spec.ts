import { expect, test, type Page } from '@playwright/test';

/**
 * 图鉴的浏览器验证。
 *
 * 单测覆盖的是派生统计与筛选规则；这里验证的是**它真的把 247 张图摆出来了**，
 * 而且图不是裂的——那两件事类型检查、构建、单测全都不报。
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

/**
 * 点导航栏上的页签。
 *
 * **必须限定在 `.app-nav` 里**：主菜单的入口按钮（「卡牌图鉴」）也含「图鉴」
 * 两个字，而 `getByRole` 的 name 是子串匹配，直接按名字找会同时命中两个，
 * 报 strict mode violation。
 */
async function clickNav(page: Page, label: string): Promise<void> {
  await page.locator('.app-nav').getByRole('button', { name: label }).click();
}

/** 开一个干净的存档（旧存档会带着上一轮的库存，图鉴数量就对不上了）。 */
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

test('图鉴展示全部卡牌，且卡面真的加载出来了', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);

  await openWithFreshSave(page);
  await clickNav(page, '图鉴');

  // 演示存档开号即拥有全部有效卡（247 张，另外 9 张数据不完整的不入库）
  await expect(page.locator('.collection__lead')).toContainText('247');
  await expect(page.locator('.tile')).toHaveCount(247, { timeout: 30_000 });

  /*
    **卡面必须真的加载出来。**
    `cardFaceUrl` 给了 URL 不代表文件在——真 404 的话图鉴是一片裂图，
    而类型检查、构建、单测全都不会报。所以这里查 `naturalWidth`。
    `loading="lazy"` 意味着只有视口附近的图会加载，所以抽前几张查即可。
  */
  const sampleWidths = () =>
    page
      .locator('.tile img.tile__art')
      .evaluateAll((nodes) =>
        nodes.slice(0, 8).map((node) => (node as HTMLImageElement).naturalWidth),
      );
  // **轮询而不是直接断言**：247 张缩略图是异步解码的，并行跑时前几张
  // 可能还没 decode 完。直接断言等于赌时序，迟早随机失败。
  await expect
    .poll(async () => {
      const widths = await sampleWidths();
      return widths.length > 0 && widths.every((width) => width > 0);
    }, { timeout: 30_000 })
    .toBe(true);

  // 兜底底板一张都不该出现——全部卡都有图
  await expect(page.locator('.tile--fallback')).toHaveCount(0);

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('按稀有度筛选，并且能打开一张卡的详情', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);

  await openWithFreshSave(page);
  await clickNav(page, '图鉴');
  await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 });

  // 导入报告里 SSS 是 12 张
  await page.getByRole('button', { name: /^SSS/ }).click();
  await expect(page.locator('.tile')).toHaveCount(12);
  await expect(page.getByRole('button', { name: /^SSS/ })).toHaveClass(/chip--on/);

  // 点开第一张：详情面板要出内容，且有中文卡名
  await page.locator('.tile').first().click();
  const panel = page.locator('.detail');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.detail__name')).toHaveText(/[一-鿿]/);
  await expect(panel).toContainText('SSS');

  /*
    关掉面板。**直接按类名点，不要先试 `getByRole('button', {name:'✕'})`**：
    那个匹配不上时 Playwright 会一直等到测试超时才放弃（默认没有动作超时），
    `catch` 根本没机会跑——表现成「测试超时」而不是「选择器不对」。
  */
  await panel.locator('.detail__close').click();
  await expect(panel).toBeHidden();

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});
