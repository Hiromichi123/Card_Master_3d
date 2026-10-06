import { expect, test, type Page } from '@playwright/test';

import { clickNav, collectProblems, openWithFreshSave } from './helpers';

/**
 * 三个菜单的浏览器验证：主菜单 → 选择对战模式 / 限时活动模式。
 *
 * 断的是**结构与可达性**（旧版 `menu.py` / `battle_menu.py` / `activity_scene.py`）：
 * 每个菜单该有几项、标题是什么、点了会去哪。
 * 版式（设计空间的比例）由截图与 `docs/validation/P5.md` 记的实测数字把关——
 * 那是像素位置，写进用例只会变脆。
 */

/** 主菜单上的入口（限定在入口区：导航栏可能重名）。 */
function menuEntry(page: Page, label: string) {
  return page.locator('.menu__columns').getByRole('button', { name: label, exact: true });
}

async function openHub(page: Page): Promise<void> {
  await openWithFreshSave(page);
  await expect(page.locator('.menu__title')).toHaveText('Card Master 3D', { timeout: 30_000 });
}

test('主菜单「进入战斗」进的是选择对战模式（不是直接进战役）', async ({ page }) => {
  const problems = collectProblems(page);
  await openHub(page);

  await menuEntry(page, '进入战斗').click();
  await expect(page.locator('.menu__title')).toHaveText('选择对战模式');

  // 旧版 `battle_menu.py` 的六项，顺序一致
  const labels = await page
    .locator('.menu__entry')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
  expect(labels).toEqual([
    '单人战役',
    '活动模式',
    '局域网 卡组对战',
    '局域网 任选对战',
    '本地 任选对战（双人）',
    '返回主菜单',
  ]);

  /*
    **标签不折行**：旧版是渲染一行字面、超出就溢出。
    用 CSS 默认换行的话「局域网 卡组对战」会折成两行、第二行压在下一个按钮上
    （实测过），所以这里断言每个标签只占一行。
  */
  const lineCounts = await page.locator('.menu__entry').evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().height)),
  );
  expect(new Set(lineCounts).size, '同一列按钮的高度必须一致（都只有一行）').toBe(1);

  // 按钮长度固定：六个按钮宽度完全一致
  const widths = await page
    .locator('.menu__entry')
    .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().width)));
  expect(new Set(widths).size).toBe(1);

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('「活动模式」进的是活动大厅，活动商店在它里面', async ({ page }) => {
  const problems = collectProblems(page);
  await openHub(page);

  await menuEntry(page, '进入战斗').click();
  await expect(page.locator('.menu__title')).toHaveText('选择对战模式');
  await menuEntry(page, '活动模式').click();

  // 旧版 `activity_scene.py`：标题「限时活动模式」+ 一行副标题 + 左侧三张特性卡
  await expect(page.locator('.menu__title')).toHaveText('限时活动模式');
  await expect(page.locator('.menu__subtitle')).toContainText('限时玩法与合作挑战');
  const features = await page
    .locator('.feature__title')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
  expect(features).toEqual(['迷宫挑战', '深渊挑战（未开放）', '协力突袭（未开放）']);

  // 右侧三项按钮
  const entries = await page
    .locator('.menu__entry-label')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
  expect(entries).toEqual(['前往单人战役', '活动商店', '返回主菜单']);

  // **活动商店是这一层里的入口**，不是主菜单直接进的
  await menuEntry(page, '活动商店').click();
  await expect(page.locator('.screen__title')).toHaveText('活动商店');
  await expect(page.locator('.shop__row').first()).toBeVisible();

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('未开放的入口点了给提示，不是死按钮', async ({ page }) => {
  const problems = collectProblems(page);
  await openHub(page);

  /*
    旧版对未实现入口的做法是「点了弹一句提示」（`_show_feature_notice`）。
    这里**不能按精确名字找**：这三个入口带着「待开发」徽标，
    可访问名是「融合 待开发」，`exact: true` 匹配不上。
  */
  await page.locator('.menu__entry').filter({ hasText: '融合' }).click();
  await expect(page.locator('.toast')).toContainText('融合');

  await menuEntry(page, '进入战斗').click();
  await expect(page.locator('.menu__title')).toHaveText('选择对战模式');
  await menuEntry(page, '局域网 卡组对战').click();
  /*
    PLAN 第 6 节：不提供冒充联机的入口，所以这里只给解释、不开房间。
    **按文字筛**：上一条「融合」的提示还在屏幕上（toast 有存活时间），
    只按 `.toast` 找会同时命中两条（strict mode violation）。
  */
  await expect(page.locator('.toast').filter({ hasText: '局域网' })).toContainText('PLAN 第 6 节');

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('返回主菜单回到主菜单，而不是导航栏切换', async ({ page }) => {
  await openHub(page);
  await menuEntry(page, '活动入口').click();
  await expect(page.locator('.menu__title')).toHaveText('限时活动模式');
  await menuEntry(page, '返回主菜单').click();
  await expect(page.locator('.menu__title')).toHaveText('Card Master 3D');
  // 导航栏仍然停在「主菜单」页签
  await expect(page.locator('.app-nav__tab--active')).toHaveText('主菜单');
  await clickNav(page, '主菜单');
});
