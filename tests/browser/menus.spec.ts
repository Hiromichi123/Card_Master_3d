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

  // 标题「限时活动模式」+ 一行副标题 + 左侧滚轮（2026-10-08 取代原来的三张特性卡）
  await expect(page.locator('.menu__title')).toHaveText('限时活动模式');
  await expect(page.locator('.menu__subtitle')).toContainText('限时玩法与合作挑战');
  const modes = await page
    .locator('.activity-wheel__option .wheel__name')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
  expect(modes).toEqual(['迷宫挑战', '深渊挑战', '协力突袭', '天梯赛', '极难挑战']);
  // 只有迷宫做完了：它的轮盘项不带「未开放」标记
  await expect(page.locator('.activity-wheel__option').first().locator('.activity-wheel__soon')).toHaveCount(0);
  await expect(page.locator('.activity-detail__title')).toContainText('迷宫挑战');

  // 右侧三项按钮
  const entries = await page
    .locator('.menu__entry-label')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
  expect(entries).toEqual(['前往单人战役', '活动商店', '返回主菜单']);

  // **活动商店是这一层里的入口**，不是主菜单直接进的
  await menuEntry(page, '活动商店').click();
  await expect(page.locator('.shop__title')).toHaveText('活动商店');
  await expect(page.locator('.shop__shelf-row').first()).toBeVisible();

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('未开放的入口点了给提示，不是死按钮', async ({ page }) => {
  const problems = collectProblems(page);
  await openHub(page);

  // Fusion is implemented; only intentionally unavailable online entries show a notice.
  await menuEntry(page, '进入战斗').click();
  await expect(page.locator('.menu__title')).toHaveText('选择对战模式');
  await menuEntry(page, '局域网 卡组对战').click();
  /*
    PLAN 第 6 节：不提供冒充联机的入口，所以这里只给解释、不开房间。
    按文字筛，避免其它提示尚未消失时产生多项匹配。
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

test('目录切换只交叉淡化背景，没有全屏黑场', async ({ page }) => {
  await openHub(page);
  await menuEntry(page, '进入战斗').click();
  await expect(page.locator('.menu__title')).toHaveText('选择对战模式');
  await expect(page.locator('.fade')).toHaveCount(0);
  await expect(page.locator('[data-background-layer="base"]')).toBeVisible();
});

test('融合入口打开工坊，Draft 与迷宫入口已移除', async ({ page }) => {
  await openHub(page);
  await expect(page.locator('.menu__entry').filter({ hasText: 'Draft' })).toHaveCount(0);
  await expect(page.locator('.menu__entry').filter({ hasText: '迷宫' })).toHaveCount(0);
  await menuEntry(page, '融合').click();
  await expect(page.getByRole('region', { name: '融合工坊' })).toBeVisible();
  await expect(page.getByRole('button', { name: '消耗 5 张并融合' })).toBeDisabled();
  await expect(page.getByRole('region', { name: '收藏材料' })).toBeVisible();
});

test('抬头可以手动收起，收起的这一下真的把高度让给画面', async ({ page }) => {
  await openHub(page);

  const nav = page.locator('.app-nav');
  const main = page.locator('.app-main');
  const expandedHeight = (await main.boundingBox())?.height ?? 0;

  await page.getByRole('button', { name: '收起导航' }).click();
  await expect(nav).toHaveClass(/app-nav--collapsed/);
  // 页签整排在 DOM 里消失，而不是只是被盖住
  await expect(page.locator('.app-nav__tab')).toHaveCount(0);
  // 高度是**量出来的**：从 46 收到 28，让出 18
  const collapsedHeight = (await main.boundingBox())?.height ?? 0;
  expect(collapsedHeight - expandedHeight).toBe(18);

  await page.getByRole('button', { name: '展开导航' }).click();
  await expect(nav).not.toHaveClass(/app-nav--collapsed/);
  await expect(page.locator('.app-nav__tab').first()).toBeVisible();
  expect((await main.boundingBox())?.height ?? 0).toBe(expandedHeight);
});

test('主菜单的玩家状态是一块面板：头像 + 等级 + 经验 + 资源', async ({ page }) => {
  await openHub(page);

  const player = page.locator('.player');
  await expect(player).toBeVisible();

  // 默认头像真的解码出来了（原项目 `assets/ui/avatar.jpg`，不是占位方块）
  const avatar = player.locator('.player__avatar img');
  await expect(avatar).toBeVisible();
  expect(
    await avatar.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    '默认头像没有加载出来',
  ).toBeGreaterThan(0);

  // 等级压在头像上，经验数值写在条内
  await expect(player.locator('.player__level')).toContainText('Lv ');
  await expect(player.locator('.player__xp-value')).toContainText('/');

  // 三样资源都在同一块面板里（等级与资源不再各画各的）
  await expect(player.locator('.currency__item')).toHaveCount(3);

  // 旧的「当前出战：…」那行已经拿掉了
  await expect(page.locator('.menu__deck')).toHaveCount(0);
  // 旧的那条独立 XP 细条也不该再出现（它在主菜单里显示成 12px，与面板不搭）
  await expect(page.locator('.level')).toHaveCount(0);
});
