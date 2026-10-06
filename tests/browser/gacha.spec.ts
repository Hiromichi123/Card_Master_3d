import { expect, test, type Page } from '@playwright/test';

import {
  clickNav,
  collectProblems,
  expectPersisted,
  openWithFreshSave,
  readProfile,
  totalCards,
} from './helpers';

/**
 * 抽卡的浏览器验证。
 *
 * 三条规矩（与配置页同一套）：
 * 1. **货币与库存读 IndexedDB 的落盘值**，不读界面文本；
 * 2. **概率断的是「算出来的数」**，并且**断言手写文案不出现**——
 *    渲染 `pool.probLabel` 的实现会立刻红；
 * 3. 演出相关的东西等接上 3D 舞台再加，这里先钉住**经济正确性**。
 *
 * 前置用 `?day=20240101` 固定时钟与种子（`profileStore.ts` 的开发期开关），
 * 于是同一个用例每次抽到的是同一批卡。
 */

/**
 * 演示存档的起始条件：`STARTING_CURRENCIES` 的 5000 金币，
 * 以及「开号即拥有全部 247 张有效卡、每张各 1 张」（`profileStore.ts` 的临时便利设定，
 * 图鉴用例也依赖同一个数）。
 *
 * 为什么用常量当基准而不是读盘：**新档是「用到才写」的**——
 * 在第一次真实改动之前 IndexedDB 里根本没有记录，读出来是 `undefined`。
 * 抽卡本身就是那次改动，所以「抽之前的基准」只能来自这两个已知事实。
 */
const START_GOLD = 5000;
const DEMO_UNIQUE_CARDS = 247;
/** 常规池的十连价（`gacha-pools.json`）。 */
const NORMAL_TEN = 4500;
const NORMAL_SINGLE = 500;

async function openGacha(page: Page): Promise<void> {
  await openWithFreshSave(page);
  await page.goto('/?day=20240101');
  await clickNav(page, '抽卡');
  await expect(page.locator('.wheel__stage')).toBeVisible({ timeout: 30_000 });
}

/** 等结果面板出来（十连/单抽都走它）。 */
async function waitForResult(page: Page): Promise<void> {
  await expect(page.getByRole('dialog', { name: '抽卡结果' })).toBeVisible({ timeout: 30_000 });
}

test('轮盘列出八个卡池，概率是现算的而不是配置里那串手写文案', async ({ page }) => {
  const problems = collectProblems(page);
  await openGacha(page);

  // 八个池都在轮盘里（超出可见范围的会被算成 opacity 0，但仍然在 DOM 里）
  await expect(page.locator('.wheel__card')).toHaveCount(8);
  // 默认选中第一个：常规卡池
  await expect(page.locator('.wheel__card--on')).toHaveAttribute('data-pool-id', 'normal');
  await expect(page.locator('.gacha__pool-name')).toHaveText('常规卡池');

  /*
    **这条是整份用例里最值钱的一条。**
    常规池的权重表算出来是 6.3%，而配置里手写的 `probLabel` 是 8.9%
    （导入报告记着这处不一致）。断言 6.3% 出现、8.9% 不出现，
    等于把「界面必须用 `rarePercent` 现算」钉死。
  */
  await expect(page.locator('.gacha__rare')).toContainText('6.3%');
  // 手写的「常规稀有爆率(8.9%)」一个字都不该出现在面板上
  await expect(page.locator('.gacha__panel')).not.toContainText('8.9%');
  await expect(page.locator('.gacha__panel')).not.toContainText('爆率');

  // 每一档的百分比都列出来了，且加起来接近 100%（权重表按表内总和归一化）
  const percents = await page
    .locator('.gacha__prob-value')
    .evaluateAll((nodes) =>
      nodes.map((node) => Number.parseFloat(node.textContent ?? '0')),
    );
  expect(percents.length).toBeGreaterThan(3);
  const sum = percents.reduce((total, value) => total + value, 0);
  expect(sum).toBeGreaterThan(99);
  expect(sum).toBeLessThan(101);

  /*
    切到特别卡池。这里的期望值有个**容易搞错的地方**：
    `gacha-pools.json` 的 `computedRarePercent` 写的是 94，界面上却是 100%。

    原因是那个字段按「100 分制求和」算，而权重表现行规则是「按表内总和归一化」：
    special 表 SSS..A 有权重、B+ 及以下全是 0，总和 94、低稀有度一张都抽不到，
    于是真实的「A 及以上」概率就是 94/94 = 100%。界面显示 100% 才对。

    走键盘而不是点卡片——卡片是斜着排的、还叠在一起，
    让用例去赌命中哪一个不如直接走可聚焦的那条路。
  */
  await page.locator('.wheel__stage').focus();
  await page.keyboard.press('ArrowRight'); // → 活动卡池
  await page.keyboard.press('ArrowRight'); // → 特别卡池
  await expect(page.locator('.wheel__card--on')).toHaveAttribute(
    'data-pool-id',
    'special',
  );
  await expect(page.locator('.gacha__pool-name')).toHaveText('特别卡池');
  await expect(page.locator('.gacha__rare')).toContainText('100.0%');
  await expect(page.locator('.gacha__panel')).not.toContainText('爆率');

  // 吸附：转过去之后正中的那个角度必须是 0（不能停在两格中间）
  await expect(page.locator('.wheel__card--on')).toHaveAttribute('data-angle', '0.00');

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('十连：落盘扣 4500 金币、库存 +10，且面板列的就是落盘的那一批', async ({ page }) => {
  const problems = collectProblems(page);
  await openGacha(page);

  await page.getByTestId('pull-10').click();
  await waitForResult(page);

  /*
    **读盘**：一次十连只写一次盘，货币与库存一起变。
    界面上写着什么是另一回事——这里要证明的是「钱扣了、卡到了、都落盘了」。
  */
  const after = await readProfile(page);
  expect(after?.currencies.gold).toBe(START_GOLD - NORMAL_TEN);
  expect(totalCards(after)).toBe(DEMO_UNIQUE_CARDS + 10);

  // 面板上列出的 10 条，与库存增量逐张对得上（含重复计数）
  const listed = await page
    .locator('.gacha-result__item')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset['cardId'] ?? ''));
  expect(listed).toHaveLength(10);

  /*
    抽之前的库存基准：演示存档里每张卡各有 1 张，所以
    「多出来的部分」就是这次抽到的——超过 1 的那些差值正好构成增量表。
    这也顺带说明为什么十连里抽到重复卡时它会累加（同一张 +3 会显示成 4）。
  */
  const gained = new Map<string, number>();
  for (const [cardId, count] of Object.entries(after?.inventory ?? {})) {
    if (count > 1) {
      gained.set(cardId, count - 1);
    }
  }
  const listedCounts = new Map<string, number>();
  for (const cardId of listed) {
    listedCounts.set(cardId, (listedCounts.get(cardId) ?? 0) + 1);
  }
  expect([...listedCounts.entries()].sort()).toEqual([...gained.entries()].sort());

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('单抽：扣 500、库存 +1', async ({ page }) => {
  const problems = collectProblems(page);
  await openGacha(page);

  await page.getByTestId('pull-1').click();
  await waitForResult(page);

  await expect(page.locator('.gacha-result__item')).toHaveCount(1);
  const after = await readProfile(page);
  expect(after?.currencies.gold).toBe(START_GOLD - NORMAL_SINGLE);
  expect(totalCards(after)).toBe(DEMO_UNIQUE_CARDS + 1);

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('余额不足时被拒，且一分钱不扣', async ({ page }) => {
  const problems = collectProblems(page);
  await openGacha(page);

  // A 级限定卡池的十连要 45000 金币，新号只有 5000
  await page.locator('.wheel__stage').focus();
  for (let i = 0; i < 7; i += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await expect(page.locator('.wheel__card--on')).toHaveAttribute(
    'data-pool-id',
    'A级限定卡池',
  );

  await page.getByTestId('pull-10').click();
  await expect(page.locator('.gacha__error')).toBeVisible();
  // 不弹结果面板：没抽成就不该有演出
  await expect(page.getByRole('dialog', { name: '抽卡结果' })).toHaveCount(0);

  /*
    **被拒的抽卡一点痕迹都不留**：没有结果面板、盘上也仍然没有记录
    （新档在第一次成功改动之前本就为空，被拒就不能产生记录）。
    这条比「钱没少」更硬——它证明拒绝发生在写盘之前。
  */
  expect(await readProfile(page)).toBeUndefined();

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('抽完之后再进抽卡页，不会重复发卡或扣费', async ({ page }) => {
  const problems = collectProblems(page);
  await openGacha(page);

  await page.getByTestId('pull-10').click();
  await waitForResult(page);
  await expectPersisted(page, (profile) => profile.currencies.gold, START_GOLD - NORMAL_TEN);
  const settled = await readProfile(page);
  const settledCards = totalCards(settled);

  /*
    离开再回来：结果面板是**内存态**，重新进页面不该再演一遍、更不该再扣一次费。
    这条挡的是「挂载时自动重放上一次结果」这类实现——那会变成刷卡的漏洞。
  */
  // 先关掉结果面板：它是模态，盖住了导航栏
  await page.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('dialog', { name: '抽卡结果' })).toHaveCount(0);
  await clickNav(page, '图鉴');
  await clickNav(page, '抽卡');
  await expect(page.locator('.wheel__stage')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '抽卡结果' })).toHaveCount(0);

  const after = await readProfile(page);
  expect(after?.currencies.gold).toBe(START_GOLD - NORMAL_TEN);
  expect(totalCards(after)).toBe(settledCards);

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});
