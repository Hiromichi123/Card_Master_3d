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
 * 所以连续翻页的用例必须等舞台回落到没有 `--out` / `--in` 类，
 * 否则第二次点击会落在动画中间、什么也不发生（这个用例第一版就是这么挂的）。
 */
async function settleFlip(page: Page): Promise<void> {
  await expect(page.locator('.showcase__stage')).toHaveClass('showcase__stage');
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
    **卡片必须是舞台的直接子元素。** `perspective` 只作用于直接子元素，
    中间夹一层就会改掉所有卡的投影——上一版为了做飞行动画给卡片包了一层，
    结果其他卡的倾斜幅度全变了。这条断言把这个结构约束钉住。
  */
  expect(await card.evaluate((el) => el.parentElement?.className)).toBe('showcase__stage');

  /*
    **介绍栏的配色必须跟着数据走。**
    名称用该稀有度的代表色，和筛选条上那个小圆点同一个来源（`rarities.json`）——
    写死一个颜色就断了这条链，换个稀有度就错。
    字体要求宋体加粗：宋体没有真粗体，浏览器合成加粗即可。
  */
  const chipColor = await page
    .locator('.chip--on .chip__dot')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const name = showcase.locator('.showcase__name');
  await expect(name).toHaveCSS('color', chipColor);
  const nameStyle = await name.evaluate((el) => {
    const style = getComputedStyle(el);
    return { family: style.fontFamily, weight: style.fontWeight };
  });
  expect(nameStyle.family).toContain('SimSun');
  expect(Number(nameStyle.weight)).toBeGreaterThanOrEqual(700);

  // 攻/血/冷却与战斗卡面徽标同一份配色（`statColors.ts`）：红 / 绿 / 蓝
  const statColors = await showcase
    .locator('.showcase__stats li b')
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color));
  expect(statColors).toEqual(['rgb(255, 45, 45)', 'rgb(18, 194, 74)', 'rgb(43, 108, 255)']);

  /*
    **左右翻页。**
    断的是**轨迹**而不是「点下去名字变了」——后者在动画被删掉之后照样会通过。
    做法是在翻页之前开始逐帧采样舞台的实际矩阵：出场的卡位移必须是**负**的
    （向左移动）、同时缩小；入场的卡位移必须是**正**的（从右侧对称出现）、
    并放大回原尺寸。逐帧采集不会像截图那样漏掉一闪而过的中间态。
  */
  await expect(showcase.locator('.showcase__counter')).toHaveText('1 / 12');
  await page.evaluate(() => {
    const stage = document.querySelector('.showcase__stage');
    const samples: { cls: string; x: number; scale: number }[] = [];
    (window as unknown as { __track?: unknown }).__track = samples;
    const deadline = performance.now() + 900;
    const tick = (): void => {
      if (!stage) {
        return;
      }
      const raw = getComputedStyle(stage).transform;
      const parts = raw === 'none' ? null : raw.match(/-?\d+(?:\.\d+)?/g);
      samples.push({
        cls: stage.className,
        x: parts ? Number(parts[4] ?? 0) : 0,
        scale: parts ? Number(parts[0] ?? 1) : 1,
      });
      if (performance.now() < deadline) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });

  const next = showcase.getByRole('button', { name: '下一张' });
  const prev = showcase.getByRole('button', { name: '上一张' });

  // 下一张：飞到第 2 张
  await next.click();
  await expect(showcase.locator('.showcase__counter')).toHaveText('2 / 12');
  await expect(showcase.locator('.showcase__name')).toHaveText(secondName ?? '');
  await page.waitForTimeout(500);

  const track = await page.evaluate(
    () => (window as unknown as { __track?: { cls: string; x: number; scale: number }[] }).__track ?? [],
  );
  const outs = track.filter((s) => s.cls.includes('showcase__stage--out'));
  const ins = track.filter((s) => s.cls.includes('showcase__stage--in'));
  expect(outs.length, '飞出阶段一帧都没采到').toBeGreaterThan(0);
  expect(ins.length, '飞入阶段一帧都没采到').toBeGreaterThan(0);
  // 旧卡：向左走（位移为负）、同时缩小
  expect(Math.min(...outs.map((s) => s.x))).toBeLessThan(-20);
  expect(Math.min(...outs.map((s) => s.scale))).toBeLessThan(0.95);
  // 新卡：从右侧进来（位移为正），并且是一路放大回原尺寸
  expect(Math.max(...ins.map((s) => s.x))).toBeGreaterThan(20);
  expect(Math.max(...ins.map((s) => s.scale))).toBeGreaterThan(0.99);
  // 收尾回到正中且是原尺寸
  const last = track[track.length - 1];
  expect(last?.cls).toBe('showcase__stage');
  expect(last?.x).toBe(0);
  expect(last?.scale).toBe(1);

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
      .poll(async () =>
        card.evaluate((el) => parseFloat(el.style.getPropertyValue('--foil-tilt-y'))),
      )
      .toBeGreaterThan(5);
    // 光斑跟着指针走
    await expect
      .poll(async () => card.evaluate((el) => el.style.getPropertyValue('--foil-glare-x')))
      .not.toBe('50.00%');
  }

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});
