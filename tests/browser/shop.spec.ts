import { expect, test, type Page } from '@playwright/test';

import {
  clickNav,
  collectProblems,
  openWithFreshSave,
  readProfile,
  totalCards,
} from './helpers';

/**
 * 商店的浏览器验证。
 *
 * 沿用在抽卡那边立的三条规矩：
 * 数值读 **IndexedDB 的落盘值**、文案从**领域常量**来、
 * 断言不依赖帧率。另外这里多一条：**货架必须可复现**——
 * `?day=` 把「今天」钉死，同一天两次打开的货架必须一模一样，
 * 换一天必须不一样（那是「每日刷新」这句话的全部内容）。
 */

const DAY = '20240101';

/**
 * 进商店。
 *
 * **两个入口的路径不一样**：常规商店在主菜单二级列上直接进；
 * 活动商店在**活动大厅**里（旧版 `activity_scene.py` 的「活动商店」按钮），
 * 要先过「活动入口 → 活动大厅」这一层——它不在主菜单上。
 */
async function openShop(page: Page, kind: 'normal' | 'activity' = 'normal'): Promise<void> {
  await openWithFreshSave(page);
  await page.goto(`/?day=${DAY}`);
  await clickNav(page, '主菜单');
  if (kind === 'activity') {
    await menuEntry(page, '活动入口').click();
    await expect(page.locator('.menu__title')).toHaveText('限时活动模式');
    await menuEntry(page, '活动商店').click();
  } else {
    await menuEntry(page, '商店').click();
  }
  await expect(page.locator('.shop__shelf-row').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * 主菜单上的某个入口。
 *
 * 限定在 `.menu__columns` 里：导航栏的页签与主菜单的入口会重名
 * （「商店」两边都有），直接按名字找会命中两个。
 */
function menuEntry(page: Page, label: string) {
  return page.locator('.menu__columns').getByRole('button', { name: label, exact: true });
}

/**
 * 某一排货架。
 *
 * 按 `aria-label` 找：新版版面照旧版，每排的标签是一行文字（不是标题元素），
 * 用 `aria-label` 既给读屏也给用例一个稳定的抓手。
 */
function shelf(page: Page, label: string) {
  return page.locator(`.shop__shelf[aria-label="${label}"]`);
}



/**
 * 新号的起始条件：5000 金币（`STARTING_CURRENCIES`），
 * 以及「开号即拥有全部 247 张有效卡、每张各 1 张」。
 *
 * 用常量当基准而不是读盘：**新档是「用到才写」的**，
 * 在第一次成功改动之前 IndexedDB 里根本没有记录，
 * 读出来是 `undefined`、当成 0 的话，减出来的数会是负数。
 */
const START_GOLD = 5000;
const DEMO_UNIQUE_CARDS = 247;

/**
 * 一排里第一件**金币价且买得起**的商品。
 *
 * 预算用常量而不是读盘：**新档是「用到才写」的**，
 * 在第一次成功改动之前 IndexedDB 里根本没有记录，读出来是 `undefined`、
 * 当成 0 的话就什么都买不起了（第一版就是这样，报「没有买得起的卡」）。
 */
async function firstAffordable(page: Page, label: string, budget = START_GOLD): Promise<number> {
  const items = shelf(page, label).locator('.shop__item');
  const count = await items.count();
  for (let index = 0; index < count; index += 1) {
    const price = await items.nth(index).locator('.shop__price-btn').textContent();
    const amount = Number.parseInt(price ?? '0', 10);
    if ((price ?? '').includes('金币') && amount <= budget) {
      return index;
    }
  }
  return -1;
}

test('货架：四排齐全、同一天可复现、换一天就换一批', async ({ page }) => {
  const problems = collectProblems(page);
  await openShop(page);

  /*
    常规商店照旧版 `shop_scene.py`：左栏三排「神话 / 传承 / 探索」，
    右栏「特典卡包」+ 两张行情图；标题是「星辰商店」。
  */
  await expect(shelf(page, '神话')).toBeVisible();
  await expect(shelf(page, '传承')).toBeVisible();
  await expect(shelf(page, '探索')).toBeVisible();
  await expect(page.locator('.shop__title')).toHaveText('星辰商店');
  await expect(page.locator('.shop__panel-label')).toHaveText(['特典卡包', '市场行情']);
  await expect(page.locator('.chart__title')).toHaveText([
    '成交价走势 (SSS-D)',
    '汇率波动 (金币/水晶/徽章)',
  ]);
  await expect(page.locator('.shop__return')).toBeVisible();

  const readShelf = async (): Promise<string> =>
    page.evaluate(() =>
      [...document.querySelectorAll('.shop__item')]
        .map((item) => (item as HTMLElement).dataset['entryId'] ?? '')
        .join('|'),
    );

  const today = await readShelf();
  expect(today.length).toBeGreaterThan(0);

  // 重新打开同一天：货架一模一样（`?day=` 固定，种子也就固定）
  await page.reload();
  await clickNav(page, '主菜单');
  await menuEntry(page, '商店').click();
  await expect(page.locator('.shop__shelf-row').first()).toBeVisible();
  expect(await readShelf()).toBe(today);

  // 换一天：整批换掉（「每日刷新」就是这一句）
  await page.goto('/?day=20240102');
  await clickNav(page, '主菜单');
  await menuEntry(page, '商店').click();
  await expect(page.locator('.shop__shelf-row').first()).toBeVisible();
  const tomorrow = await readShelf();
  expect(tomorrow).not.toBe(today);
  // 售罄标识里带日键，所以两天的标识不可能相交
  expect(tomorrow.split('|')[0]?.startsWith('20240102')).toBe(true);

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('买卡：扣钱与发货是同一笔事务，且标记售罄', async ({ page }) => {
  const problems = collectProblems(page);
  await openShop(page);

  const index = await firstAffordable(page, '探索');
  expect(index, '探索货架里没有买得起的卡').toBeGreaterThanOrEqual(0);

  const item = shelf(page, '探索').locator('.shop__item').nth(index);
  const priceText = await item.locator('.shop__price-btn').textContent();
  const price = Number.parseInt(priceText ?? '0', 10);
  const entryId = await item.evaluate((node) => (node as HTMLElement).dataset['entryId'] ?? '');
  await item.locator('.shop__price-btn').click();
  await expect(item.locator('.shop__soldout')).toBeVisible({ timeout: 15_000 });

  /*
    **读盘**：一笔事务里同时扣钱、发货、标售罄。
    旧版 `knownIssues[0]` 就是「只扣钱不发货」，这条断言直接盯着那个缺陷。
  */
  const after = await readProfile(page);
  expect(after?.currencies.gold).toBe(START_GOLD - price);
  expect(totalCards(after)).toBe(DEMO_UNIQUE_CARDS + 1);
  expect(after?.shop.soldOut).toContain(entryId);

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('买不起：一分钱不扣、盘上不留记录、给一句提示', async ({ page }) => {
  const problems = collectProblems(page);
  await openShop(page);

  // 新号 5000 金币 / 300 水晶；「神话」排第一件是 551 水晶的 SSS，买不起
  const first = shelf(page, '神话').locator('.shop__item').first();
  const priceText = await first.locator('.shop__price-btn').textContent();
  expect(priceText, '这条用例假设神话排第一件是水晶价').toContain('水晶');

  await first.locator('.shop__price-btn').click();
  await expect(page.locator('.shop__error')).toContainText('余额不足');
  await expect(first.locator('.shop__soldout')).toHaveCount(0);

  /*
    被拒的购买**不该产生任何落盘**：新档在第一次成功改动之前盘上本来就是空的，
    所以「读出来是 undefined」就是最强的断言——拒绝发生在写盘之前。
  */
  expect(await readProfile(page)).toBeUndefined();

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('活动入口进的是活动商店，货架与常规不同', async ({ page }) => {
  const problems = collectProblems(page);
  await openShop(page, 'activity');

  await expect(page.locator('.shop__title')).toHaveText('活动商店');
  // 活动货架的三排与常规完全不同（`shops.json` 的 activityShop.shelves）
  await expect(shelf(page, '活动精选')).toBeVisible();
  await expect(shelf(page, '稀有兑换')).toBeVisible();
  await expect(shelf(page, '常规兑换')).toBeVisible();
  // 活动商店没有礼包（配置里就没有 packs），但有一个徽章计数与一张汇率图
  await expect(page.locator('.shop__item--pack')).toHaveCount(0);
  await expect(page.getByTestId('badge-counter')).toBeVisible();
  await expect(page.locator('.chart__title')).toHaveText(['徽章兑换汇率走势']);

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('活动商店用徽章计价，新号买不起（徽章来自活动，还没做）', async ({ page }) => {
  const problems = collectProblems(page);
  await openShop(page, 'activity');

  /*
    **活动商店的价格是徽章**。这里盯住两件事：
    1. 价格表在 `shops.json` 里是**裸数字**，数据层补上了货币——
       没补的话这里会显示「undefined」；
    2. 新号徽章为 0，所以点购买应当被拒、且**盘上不留记录**。
  */
  const first = page.locator('.shop__item').first();
  await expect(first.locator('.shop__price-btn')).toContainText('徽章');
  await expect(first.locator('.shop__price-btn')).not.toContainText('undefined');

  await first.locator('.shop__price-btn').click();
  await expect(page.locator('.shop__error')).toContainText('余额不足');
  expect(await readProfile(page)).toBeUndefined();

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('货架卡位居中、间隔平均，右侧卡包显示卡背', async ({ page }) => {
  const problems = collectProblems(page);
  await openShop(page);

  /*
    旧版 `_draw_card_offer` 的排法：`space = max(16, (rect.width - 总宽) / (张数 + 1))`，
    首尾也各留一个 space —— 也就是 CSS 的 `space-evenly`。
    这里量的是**真几何**：左边距、右边距、卡与卡的间隔，三者必须一致（居中 + 平均）。
  */
  const measured = await page.locator('.shop__shelf-row').first().evaluate((el) => {
    const row = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const items = [...el.querySelectorAll('.shop__item')]
      .map((node) => node.getBoundingClientRect())
      .sort((a, b) => a.left - b.left);
    if (items.length < 2) {
      return null;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const inner: number[] = [];
    for (let i = 1; i < items.length; i += 1) {
      inner.push(items[i]!.left - items[i - 1]!.right);
    }
    return {
      count: items.length,
      left: first.left - (row.left + parseFloat(style.paddingLeft)),
      right: row.right - parseFloat(style.paddingRight) - last.right,
      inner,
    };
  });

  expect(measured, '第一排货架上不足两张卡，量不出间隔').not.toBeNull();
  if (measured) {
    expect(measured.count).toBeGreaterThan(1);
    // 居中：左、右两个边距相等
    expect(Math.abs(measured.left - measured.right), '卡位不居中').toBeLessThanOrEqual(2);
    // 平均：每个卡间间隔都等于那个边距
    for (const gap of measured.inner) {
      expect(Math.abs(gap - measured.left), `卡间间隔与边距不一致：${JSON.stringify(measured)}`).toBeLessThanOrEqual(2);
    }
  }

  // 卡包装的就是一叠卡：牌位上必须有卡背图，而且真的解码出来了（不是 404 的占位框）
  const packs = page.locator('.shop__pack-body');
  await expect(packs.first()).toBeVisible();
  const backCount = await packs.locator('.shop__pack-back').count();
  expect(backCount).toBe(await packs.count());
  const decoded = await packs.first().locator('.shop__pack-back').evaluate(
    (node) => (node as HTMLImageElement).naturalWidth,
  );
  expect(decoded, '卡背图没有加载出来').toBeGreaterThan(0);

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});
