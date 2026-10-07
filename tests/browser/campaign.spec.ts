import { expect, test, type Page } from '@playwright/test';

import { collectProblems, openWithFreshSave, readProfile, totalCards } from './helpers';

/**
 * 单人战役的浏览器验证。
 *
 * 走一遍**完整的循环**：世界地图 → 章节地图 → 选关出战 → 打完 → 结算落盘 → 回地图。
 * 数值一律读 IndexedDB 的落盘值；奖励文案读结果面板上的结算明细，
 * 两边必须对得上（「界面显示的奖励」与「真发下去的奖励」是同一件事）。
 *
 * 对局本身用**跳过 + 自动演示**跑完（`battleSlice.spec.ts` 也是这么做的）——
 * 正常速度跑一局是分钟级，用例等不起。
 */

const DAY = '20240101';

/** 新号：5000 金币、247 张卡（`STARTING_CURRENCIES` 与演示存档）。 */
const START_GOLD = 5000;
const DEMO_UNIQUE_CARDS = 247;
/** 1-1 古海要塞的奖励（`stages.json`）。 */
const STAGE_1_1_GOLD = 300;
const STAGE_1_1_XP = 100;

async function openCampaign(page: Page): Promise<void> {
  await openWithFreshSave(page);
  await page.goto(`/?day=${DAY}`);
  await page.locator('.menu__columns').getByRole('button', { name: '进入战斗', exact: true }).click();
  await expect(page.locator('.menu__title')).toHaveText('选择对战模式');
  await page.locator('.menu__columns').getByRole('button', { name: '单人战役', exact: true }).click();
  await expect(page.locator('.campaign__title')).toHaveText('世界地图');
}

/**
 * 进第一章 → 选第一关。
 *
 * **选中靠悬停、进入靠点击**（旧版就是这么分的）：章节地图上点一张海报是直接开打，
 * 所以这里用 `hover` 选中、再点详情栏的「出战」。
 */
async function pickFirstStage(page: Page): Promise<void> {
  await page.locator('.campaign__poster').first().click();
  await expect(page.locator('.campaign__title')).toHaveText('人界');
  await page.locator('.campaign__poster').first().hover();
  await expect(page.locator('.campaign__detail-title')).toContainText('1-1');
}

/** 打完这一局（跳过 + 自动演示），等结果面板上的结算明细。 */
async function fightToTheEnd(page: Page): Promise<void> {
  await page.locator('.campaign__detail .btn').click();
  await expect(page.locator('.overlay__title')).toBeVisible({ timeout: 20_000 });
  // 演出档在开局菜单的「战斗设置」里（2026-10-07 起不再挂在全局抬头）
  await page.locator('.battle-settings').getByRole('button', { name: '跳过', exact: true }).click();
  await page.locator('.overlay__toggle input[type=checkbox]').check();
  await page.locator('.overlay').getByRole('button', { name: '开始对局' }).click();
  await expect(page.getByTestId('settlement')).toBeVisible({ timeout: 90_000 });
}

test('世界地图：只列有内容的章节，空章节不上地图', async ({ page }) => {
  const problems = collectProblems(page);
  await openCampaign(page);

  await expect(page.locator('.campaign__subtitle')).toHaveText('点击章节进入关卡');

  /*
    `stages.json` 里有第 4 章「月之都」，但它一关都没有（`emptyChapters` 里另记着）。
    列出来只会让人点进一个空地图，所以过滤掉——清单对这条的要求是「不构造新内容」。
  */
  const chapters = await page
    .locator('.campaign__poster-name')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
  expect(chapters).toEqual(['人界', '魔域', '神宫']);

  await expect(page.locator('.campaign__foot')).toHaveText('已通关 0 / 12 关');

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('章节地图列出四关，右侧详情给出奖励与敌方牌组', async ({ page }) => {
  const problems = collectProblems(page);
  await openCampaign(page);
  await page.locator('.campaign__poster').first().click();

  await expect(page.locator('.campaign__title')).toHaveText('人界');
  await expect(page.locator('.campaign__subtitle')).toContainText('ESC 返回世界地图');
  await expect(page.locator('.campaign__poster-name')).toHaveText([
    '1-1 古海要塞',
    '1-2 幻想森林',
    '1-3 冬城废墟',
    '1-4 史诗一战',
  ]);

  // 悬停第一关：详情里是这一关的奖励（来自 `stages.json`，不是界面上写死的）
  await page.locator('.campaign__poster').first().hover();
  await expect(page.locator('.campaign__detail-title')).toHaveText('1-1 古海要塞');
  await expect(page.locator('.campaign__detail-list')).toContainText('金币 300');
  await expect(page.locator('.campaign__detail-list')).toContainText('经验 100');
  await expect(page.locator('.campaign__detail-line')).toContainText('敌方牌组 8 张');

  // 空手/没有出战卡组时才该被拦——这里正常，按钮可用
  await expect(page.locator('.campaign__detail .btn')).toBeEnabled();

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('打完一关：奖励落盘、通关记录写进去，且只结算一次', async ({ page }) => {
  const problems = collectProblems(page);
  await openCampaign(page);
  await pickFirstStage(page);
  await fightToTheEnd(page);

  /*
    结算明细上写的就是**已经落盘的那一份**——`App` 在进入结果态时提交了事务，
    拿到视图才传给结果面板。所以这里断言的三件事必须互相一致：
    面板上的数字、存档里的货币、存档里的通关记录。
  */
  const lines = await page.locator('.settlement__line').allTextContents();
  expect(lines).toContain(`金币 +${STAGE_1_1_GOLD}`);
  expect(lines).toContain(`经验 +${STAGE_1_1_XP}`);

  const after = await readProfile(page);
  expect(after?.currencies.gold).toBe(START_GOLD + STAGE_1_1_GOLD);
  expect(after?.campaign.clearedStages).toEqual(['1-1']);
  // 同一局只结算一次：`battleId` 进了事务，重放会被存档层按 id 挡掉
  expect(after?.settledBattleIds).toHaveLength(1);
  // 这一局没掉卡（掉落是概率的，掉了总数就 +1）
  const cards = totalCards(after);
  expect(cards === DEMO_UNIQUE_CARDS || cards === DEMO_UNIQUE_CARDS + 1).toBe(true);

  // 「返回战役」回到章节地图，并且那一关盖上了「已通关」
  await page.locator('.overlay').getByRole('button', { name: '返回战役' }).click();
  await expect(page.locator('.campaign__title')).toHaveText('世界地图');
  await page.locator('.campaign__poster').first().click();
  await expect(page.locator('.campaign__poster-done').first()).toHaveText('已通关');

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('开战菜单显示的是这一关，不是我方演示牌组', async ({ page }) => {
  await openCampaign(page);
  await pickFirstStage(page);
  await page.locator('.campaign__detail .btn').click();

  // 标题是关卡名（早先这里写死「演示战斗」），牌组是玩家当前的出战卡组（12 张）
  await expect(page.locator('.overlay__title')).toHaveText('古海要塞');
  await expect(page.locator('.overlay__deck-title')).toContainText('我方牌组 · 12 张');
});
