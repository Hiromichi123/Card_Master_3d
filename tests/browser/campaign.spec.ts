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

test('世界地图列出四章（含尚无内容的第四章）', async ({ page }) => {
  const problems = collectProblems(page);
  await openCampaign(page);

  await expect(page.locator('.campaign__subtitle')).toHaveText('点击章节进入关卡');

  /*
    第 4 章「月之都」在 `stages.json` 里一关都没有，但**旧版 `WORLD_CHAPTERS` 就列着它**
    （海报与地图背景在旧项目里同样不存在，画的是占位块）。要对齐旧版的版面就得列出来。
  */
  const chapters = await page
    .locator('.campaign__poster-name')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
  expect(chapters).toEqual(['人界', '魔域', '神宫', '月之都']);

  await expect(page.locator('.campaign__foot')).toContainText('已通关 0 / 12 关');

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('战役版面按旧版的几何排：海报中心、尺寸与详情栏位置', async ({ page }) => {
  const problems = collectProblems(page);
  await openCampaign(page);

  /*
    旧版 `world_map_scene.py`：海报 540×360，**中心** x = 15% + 60%·i/(n-1)、y = 60%；
    详情栏 (70%, 18%, 26%×68%)；返回按钮 (4%, 86%, 240×72)。
    这里按设计框（`.menu__stage`）量真实几何——百分比换算全在 CSS 里，
    只有量出来才能证明它真的落在旧版那几个点上。
  */
  const world = await page.evaluate(() => {
    const stage = document.querySelector('.menu__stage')!.getBoundingClientRect();
    const ui = stage.width / 2880;
    const posters = [...document.querySelectorAll('.campaign__poster')].map((node) => {
      const r = node.getBoundingClientRect();
      return {
        centerX: (r.left + r.width / 2 - stage.left) / stage.width,
        centerY: (r.top + r.height / 2 - stage.top) / stage.height,
        width: r.width / ui,
        height: r.height / ui,
      };
    });
    const detail = document.querySelector('.campaign__detail')!.getBoundingClientRect();
    return {
      ui,
      posters,
      detail: {
        left: (detail.left - stage.left) / stage.width,
        top: (detail.top - stage.top) / stage.height,
        width: detail.width / stage.width,
        height: detail.height / stage.height,
      },
    };
  });

  expect(world.posters).toHaveLength(4);
  world.posters.forEach((poster, index) => {
    // 中心 x 从 15% 等分到 75%（四章：15 / 35 / 55 / 75）
    expect(poster.centerX, `第 ${index + 1} 张海报的横坐标不对`).toBeCloseTo(0.15 + 0.6 * (index / 3), 2);
    expect(poster.centerY, '海报不在 60% 高度上').toBeCloseTo(0.6, 2);
    // 540×360 设计单位
    expect(Math.round(poster.width)).toBe(540);
    expect(Math.round(poster.height)).toBe(360);
  });
  expect(world.detail.left).toBeCloseTo(0.7, 2);
  expect(world.detail.top).toBeCloseTo(0.18, 2);
  expect(world.detail.width).toBeCloseTo(0.26, 2);
  expect(world.detail.height).toBeCloseTo(0.68, 2);

  // 世界地图的标题 100 号字、副标题 40 号字
  const worldFonts = await page.evaluate(() => {
    const stage = document.querySelector('.menu__stage')!.getBoundingClientRect();
    const ui = stage.width / 2880;
    return {
      title: parseFloat(getComputedStyle(document.querySelector('.campaign__title')!).fontSize) / ui,
      subtitle: parseFloat(getComputedStyle(document.querySelector('.campaign__subtitle')!).fontSize) / ui,
      back: parseFloat(getComputedStyle(document.querySelector('.campaign__back')!).fontSize) / ui,
    };
  });
  expect(Math.round(worldFonts.title)).toBe(100);
  expect(Math.round(worldFonts.subtitle)).toBe(40);
  expect(Math.round(worldFonts.back)).toBe(42);

  // 进章节地图：标题变小变靠上、详情栏换成 (72%, 24%)；四关排成 2×2 栅格
  await page.locator('.campaign__poster').first().click();
  await expect(page.locator('.campaign__title')).toHaveText('人界');

  const chapterView = await page.evaluate(() => {
    const stage = document.querySelector('.menu__stage')!.getBoundingClientRect();
    const ui = stage.width / 2880;
    const title = document.querySelector('.campaign__title')!;
    const subtitle = document.querySelector('.campaign__subtitle')!;
    return {
      // 字号换算成设计单位，直接与旧版的 72 / 32 对
      titleFont: parseFloat(getComputedStyle(title).fontSize) / ui,
      subtitleFont: parseFloat(getComputedStyle(subtitle).fontSize) / ui,
      detailLeft: (document.querySelector('.campaign__detail')!.getBoundingClientRect().left - stage.left) / stage.width,
      detailWidth: document.querySelector('.campaign__detail')!.getBoundingClientRect().width / stage.width,
      posters: [...document.querySelectorAll('.campaign__poster')].map((node) => {
        const r = node.getBoundingClientRect();
        return {
          centerX: (r.left + r.width / 2 - stage.left) / stage.width,
          centerY: (r.top + r.height / 2 - stage.top) / stage.height,
        };
      }),
    };
  });

  // 章节地图的标题 72 号字、副标题 32 号字（世界地图是 100 / 40）
  expect(Math.round(chapterView.titleFont)).toBe(72);
  expect(Math.round(chapterView.subtitleFont)).toBe(32);
  expect(chapterView.detailLeft).toBeCloseTo(0.72, 2);
  expect(chapterView.detailWidth).toBeCloseTo(0.24, 2);

  /*
    章节地图的栅格：columns = min(4, ceil(4/2)) = 2、rows = 2，
    x = 7% + 62%·((col+0.5)/2) → 22.5% / 53.5%，y = 35% / 65%。
  */
  expect(chapterView.posters).toHaveLength(4);
  const expected = [
    { x: 0.225, y: 0.35 },
    { x: 0.535, y: 0.35 },
    { x: 0.225, y: 0.65 },
    { x: 0.535, y: 0.65 },
  ];
  chapterView.posters.forEach((poster, index) => {
    expect(poster.centerX, `第 ${index + 1} 关的横坐标不对`).toBeCloseTo(expected[index]!.x, 2);
    expect(poster.centerY, `第 ${index + 1} 关的纵坐标不对`).toBeCloseTo(expected[index]!.y, 2);
  });

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('第四章点进去是空地图，并说明它本来就没有内容', async ({ page }) => {
  const problems = collectProblems(page);
  await openCampaign(page);

  // 第四章的海报没有图（旧项目里也没有），画的是占位块
  const moon = page.locator('.campaign__poster').nth(3);
  await moon.hover();
  await expect(page.locator('.campaign__detail-title')).toHaveText('月之都');
  await expect(page.locator('.campaign__detail')).toContainText('还没有关卡');
  // 空章节不能进——「进入章节」按钮是禁用的
  await expect(page.locator('.campaign__detail .btn')).toBeDisabled();

  // 但仍然可以点进去看那张空地图（旧版也是点得进去的）
  await moon.click();
  await expect(page.locator('.campaign__title')).toHaveText('月之都');
  await expect(page.locator('.campaign__poster')).toHaveCount(0);
  await expect(page.locator('.campaign__foot')).toContainText('选择一个关卡开始作战');

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
