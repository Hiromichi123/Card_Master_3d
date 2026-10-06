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

/**
 * 等翻页动画跑完。
 *
 * **翻页期间再按是被挡掉的**（`CardShowcase` 的 `busyRef`）——两段动画
 * 一共 380ms，中途插进来的点击会让旧卡飞回去，比不响应更难看。
 * 所以连续翻页的用例必须等 swing 层回落到没有 `--out` / `--in` 类，
 * 否则第二次点击会落在动画中间、什么也不发生（这个用例第一版就是这么挂的）。
 */
async function settleFlip(page: Page): Promise<void> {
  await expect(page.locator('.showcase__swing')).toHaveClass('showcase__swing');
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

test('按稀有度筛选，点开后进入展示位', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);

  await openWithFreshSave(page);
  await clickNav(page, '图鉴');
  await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 });

  // 导入报告里 SSS 是 12 张
  await page.getByRole('button', { name: /^SSS/ }).click();
  await expect(page.locator('.tile')).toHaveCount(12);
  await expect(page.getByRole('button', { name: /^SSS/ })).toHaveClass(/chip--on/);

  /*
    点开第一张：进入**展示位**——背景压暗、卡牌放大到屏幕正中。
    网格里的缩略图是纯图片，箔片只在展示位出现（V-HOLO-4）。
  */
  const tiles = page.locator('.tile');
  const secondName = await tiles.nth(1).locator('img').getAttribute('alt');
  const lastName = await tiles.last().locator('img').getAttribute('alt');

  await tiles.first().click();
  const showcase = page.locator('.showcase');
  await expect(showcase).toBeVisible();
  await expect(showcase.locator('.showcase__name')).toHaveText(/[一-鿿]/);

  const card = page.locator('.showcase__card');
  const box = await card.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(300);

  /*
    **检视要真的在动。** 鼠标移开中心之后，写入的自定义属性必须跟着变——
    这是「箔片跟着指针走」唯一可断言的证据（截图比对太脆）。
  */
  if (box) {
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await expect
      .poll(async () => card.evaluate((el) => el.style.getPropertyValue('--foil-bg-x')))
      .not.toBe('50%');
  }

  /*
    **左右翻页。**
    断的是「换卡动画真的跑过」而不是「点下去名字变了」——后者在动画被删掉之后
    照样会通过。做法是在翻页之前挂一个 MutationObserver，把 swing 层的类名变化
    记下来：录制是持续的，不会像逐帧截图那样漏掉一闪而过的中间态。
  */
  await expect(showcase.locator('.showcase__counter')).toHaveText('1 / 12');
  await page.evaluate(() => {
    const swing = document.querySelector('.showcase__swing');
    const seen: string[] = [];
    (window as unknown as { __swing?: string[] }).__swing = seen;
    if (swing) {
      new MutationObserver(() => seen.push(swing.className)).observe(swing, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  });

  const next = showcase.getByRole('button', { name: '下一张' });
  const prev = showcase.getByRole('button', { name: '上一张' });

  // 下一张：飞到第 2 张，且两段动画都留下过痕迹
  await next.click();
  await expect(showcase.locator('.showcase__counter')).toHaveText('2 / 12');
  await expect(showcase.locator('.showcase__name')).toHaveText(secondName ?? '');
  const swings = await page.evaluate(
    () => (window as unknown as { __swing?: string[] }).__swing ?? [],
  );
  expect(swings).toContain('showcase__swing showcase__swing--out');
  expect(swings).toContain('showcase__swing showcase__swing--in');

  // 上一张：回到第 1 张
  await settleFlip(page);
  await prev.click();
  await expect(showcase.locator('.showcase__counter')).toHaveText('1 / 12');

  /*
    **首尾循环**：在第 1 张再按「上一张」应该绕到第 12 张，而不是停在原地
    （停在原地的话按钮点了没反应，在末张按「下一张」同理）。
  */
  await settleFlip(page);
  await prev.click();
  await expect(showcase.locator('.showcase__counter')).toHaveText('12 / 12');
  await expect(showcase.locator('.showcase__name')).toHaveText(lastName ?? '');

  // Esc 关闭
  await page.keyboard.press('Escape');
  await expect(showcase).toBeHidden();

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

/**
 * 没有箔片的卡（D 档，`foilKindForRarity` 里强度为 0）。
 *
 * 这一档曾经**连倾斜都不做**——`useFoilPointer` 是按「有没有箔片」开关的，
 * 于是白卡在展示位里是一张死图片。现在它照样跟着指针倒，
 * 只是叠的是白光而不是彩色箔片。
 */
test('没有箔片的卡也跟随指针，且只叠白色光照', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);

  await openWithFreshSave(page);
  await clickNav(page, '图鉴');
  await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /^D/ }).click();
  const tiles = page.locator('.tile');
  await expect(tiles.first()).toBeVisible({ timeout: 30_000 });
  expect(await tiles.count()).toBeGreaterThan(1);

  await tiles.first().click();
  const showcase = page.locator('.showcase');
  const card = showcase.locator('.showcase__card');
  await expect(card).toBeVisible();

  // 这一档不该有箔片层，取而代之的是白光层
  await expect(card.locator('.foil')).toHaveCount(0);
  await expect(card.locator('.showcase__sheen')).toBeVisible();

  const box = await card.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(300);

  // 移到右上角：倾斜角度要明显非零，而不是停在 0deg
  if (box) {
    await page.mouse.move(box.x + box.width * 0.88, box.y + box.height * 0.18);
    await expect
      .poll(async () => card.evaluate((el) => parseFloat(el.style.getPropertyValue('--foil-tilt-y'))))
      .toBeGreaterThan(5);
    // 光斑跟着指针走
    await expect
      .poll(async () => card.evaluate((el) => el.style.getPropertyValue('--foil-glare-x')))
      .not.toBe('50.00%');
  }

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});
