import { expect, test, type Locator, type Page } from '@playwright/test';

import { collectProblems, expectPersisted, openWithFreshSave, readProfile } from './helpers';

/**
 * 迷宫第一层的浏览器验证。
 *
 * 覆盖：进入地图 → 走一格（两次点击确认）→ 位置与探索记录落盘 → 楼层商店购买 →
 * 战斗节点开打 → 结算落盘 → 返回地图。
 *
 * 节点从 DOM 里**按属性找**（`data-reachable` / `data-node-type`），不写死 id：
 * 地图是种子生成的，改了生成规则整张图就变了，写死 id 的用例会一起碎。
 * 数值断言一律读 IndexedDB 的落盘值。
 */

const DAY = '20240101';
/** 演示存档：新号 5000 金币（`STARTING_CURRENCIES`）。 */
const START_GOLD = 5000;

/** 当前这一页 → 主菜单 → 选择对战模式 → 活动模式 → 活动大厅 → 迷宫挑战。 */
async function goToMaze(page: Page): Promise<void> {
  await page.locator('.app-nav').getByRole('button', { name: '主菜单', exact: true }).click();
  await page.locator('.menu__columns').getByRole('button', { name: '进入战斗', exact: true }).click();
  await expect(page.locator('.menu__title')).toHaveText('选择对战模式');
  await page.locator('.menu__columns').getByRole('button', { name: '活动模式', exact: true }).click();
  await expect(page.locator('.menu__title')).toHaveText('限时活动模式');
  // 按标题点，不按位置——活动大厅会加卡，位置会变
  await page.locator('.feature', { hasText: '迷宫挑战' }).click();
  await expect(page.locator('.maze__title')).toHaveText('迷宫挑战·第一层');
}

/** 开一个干净存档再进迷宫。 */
async function openMaze(page: Page): Promise<void> {
  await openWithFreshSave(page);
  await page.goto(`/?day=${DAY}`);
  await goToMaze(page);
}

/** 一步能到的节点里，挑一个**走上去没有副作用**的（战斗节点会直接开打）。 */
function quietNeighbor(page: Page): Locator {
  return page
    .locator('.maze__tile[data-reachable="true"][data-node-type="supply"]')
    .or(page.locator('.maze__tile[data-reachable="true"][data-node-type="entry"]'))
    .first();
}

/** 一步能到的战斗节点。 */
function combatNeighbor(page: Page): Locator {
  return page
    .locator('.maze__tile[data-reachable="true"][data-node-type="normal"]')
    .or(page.locator('.maze__tile[data-reachable="true"][data-node-type="elite"]'))
    .or(page.locator('.maze__tile[data-reachable="true"][data-node-type="boss"]'))
    .first();
}

async function nodeIdOf(tile: Locator): Promise<number> {
  return Number(await tile.getAttribute('data-node-id'));
}

test('进入迷宫：地图、图例与初始 run 落盘', async ({ page }) => {
  const problems = collectProblems(page);
  await openMaze(page);

  // 旧版是 50–60 个节点的随机地图；这里连节点方块一起数
  const tiles = await page.locator('.maze__tile').count();
  expect(tiles).toBeGreaterThanOrEqual(50);
  expect(tiles).toBeLessThanOrEqual(60);

  // 入口是当前所在（旧版用一颗光球标位置，方块本身不换样式）
  await expect(page.locator('.maze__tile[data-current="true"]')).toHaveCount(1);
  expect(await nodeIdOf(page.locator('.maze__tile[data-current="true"]'))).toBe(0);

  await expect(page.locator('.maze__legend li')).toHaveText([
    '入口',
    '普通敌人',
    '精英敌人',
    '楼层Boss',
    '商店补给',
  ]);
  await expect(page.locator('.maze__foot')).toContainText('已探索 1 /');

  // 第一次进来就把 run 写下来（位置在入口，只探索了入口）
  await expectPersisted(page, (profile) => profile.mazeRun?.playerNodeId, 0);
  await expectPersisted(page, (profile) => profile.mazeRun?.version, 1);

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('走一格：点两次才出发，位置与探索记录落盘', async ({ page }) => {
  const problems = collectProblems(page);
  await openMaze(page);

  const target = quietNeighbor(page);
  test.skip((await target.count()) === 0, '这一版的地图上入口没有非战斗邻居');
  const targetId = await nodeIdOf(target);

  // 第一次点：只把它选中，右侧出详情
  await target.click();
  await expect(page.locator('.maze__detail')).toHaveAttribute('data-node-id', String(targetId));
  await expect(page.locator('.maze__detail-sub')).toHaveText(`节点 #${targetId}`);
  await expect(page.locator('.maze__detail-list').first()).toBeVisible();
  // 还没出发
  await expectPersisted(page, (profile) => profile.mazeRun?.playerNodeId, 0);

  // 再点同一个节点：出发（450ms 的移动动画）
  await target.click();
  await expectPersisted(page, (profile) => profile.mazeRun?.playerNodeId, targetId);
  await expectPersisted(
    page,
    (profile) => profile.mazeRun?.exploredNodeIds.includes(targetId) ?? false,
    true,
  );
  await expectPersisted(page, (profile) => profile.mazeRun?.exploredNodeIds.length, 2);

  /*
    刷新后还在这一格。
    路由**不在 URL 里**（`App` 就是个 useSyncExternalStore + useState 的状态机），
    所以刷新会回主菜单——再走一遍导航，位置只能从落盘值恢复。
  */
  await page.reload();
  await goToMaze(page);
  expect(await nodeIdOf(page.locator('.maze__tile[data-current="true"]'))).toBe(targetId);
  await expect(page.locator('.maze__foot')).toContainText('已探索 2 /');

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('走到补给节点：开楼层商店，买了扣钱、售罄落在这个节点', async ({ page }) => {
  const problems = collectProblems(page);
  await openMaze(page);

  const supply = page.locator('.maze__tile[data-reachable="true"][data-node-type="supply"]').first();
  test.skip((await supply.count()) === 0, '这一版的地图上入口没有相邻的补给节点');
  const nodeId = await nodeIdOf(supply);

  await supply.click();
  await supply.click();
  // 到达补给节点直接开货架（旧版是切到 floor_shop 那块屏）
  await expect(page.locator('.maze__shop')).toHaveAttribute('data-shop-node', String(nodeId));
  const items = page.locator('.maze__shop-item');
  expect(await items.count()).toBeGreaterThan(0);

  /*
    买第一件收金币的（活动位收水晶，新号没有）。
    **按钮的 locator 必须钉在这一件商品上**：买完它自己就变成「已售罄」、
    不再是「金字按钮」，用 `hasText: '金币'` 现找会飘到下一件没买的商品上。
  */
  const firstGold = items.filter({ has: page.locator('.maze__shop-buy', { hasText: '金币' }) }).first();
  const entryId = await firstGold.getAttribute('data-entry-id');
  // 买到哪一件就认哪一件：按 entryId 钉住，别再按「按钮上写着金币」找
  const item = page.locator(`.maze__shop-item[data-entry-id="${entryId}"]`);
  const buy = item.locator('.maze__shop-buy');
  const price = Number(((await buy.textContent()) ?? '').replace(/[^0-9]/g, ''));

  await buy.click();
  await expect(buy).toHaveText('已售罄');
  await expectPersisted(page, (profile) => profile.currencies.gold, START_GOLD - price);
  await expectPersisted(
    page,
    (profile) => profile.mazeRun?.shopByNode[String(nodeId)]?.soldOut.includes(entryId ?? '') ?? false,
    true,
  );
  // 售罄只落在这个节点，不写每日货架
  await expectPersisted(page, (profile) => profile.shop.soldOut.length, 0);

  // 关掉面板回到地图
  await page.locator('.maze__shop-close').click();
  await expect(page.locator('.maze__detail')).toBeVisible();

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('战斗节点：到达就开打，结算落盘，返回地图', async ({ page }) => {
  const problems = collectProblems(page);
  await openMaze(page);

  const combat = combatNeighbor(page);
  test.skip((await combat.count()) === 0, '这一版的地图上入口没有相邻的战斗节点');
  const nodeId = await nodeIdOf(combat);

  await combat.click();
  await combat.click();
  await expectPersisted(page, (profile) => profile.mazeRun?.playerNodeId, nodeId);

  // 进入战斗屏（敌牌组是现生成的，没有中间文件）
  await expect(page.locator('.overlay__title')).toBeVisible({ timeout: 20_000 });
  // 演出档在开局菜单的「战斗设置」里（2026-10-07 起不再挂在全局抬头）
  await page.locator('.battle-settings').getByRole('button', { name: '跳过', exact: true }).click();
  await page.locator('.overlay__toggle input[type=checkbox]').check();
  await page.locator('.overlay').getByRole('button', { name: '开始对局' }).click();
  await expect(page.getByTestId('settlement')).toBeVisible({ timeout: 90_000 });

  const after = await readProfile(page);
  // 这一局已经结算过一次（输赢都算一次：败北也记经验）
  expect(after?.settledBattleIds).toHaveLength(1);
  expect(after?.settledBattleIds[0]).toContain(`:n${nodeId}`);
  // 迷宫不碰战役进度
  expect(after?.campaign.clearedStages).toEqual([]);
  // 位置留在这一格（回来时地图就停在这里）
  expect(after?.mazeRun?.playerNodeId).toBe(nodeId);

  // 按钮上的文案是「返回地图」而不是战役那套
  await page.locator('.overlay').getByRole('button', { name: '返回地图' }).click();
  await expect(page.locator('.maze__title')).toHaveText('迷宫挑战·第一层');
  expect(await nodeIdOf(page.locator('.maze__tile[data-current="true"]'))).toBe(nodeId);

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('清空探索记录：换一轮（version + 1），位置回到入口', async ({ page }) => {
  const problems = collectProblems(page);
  await openMaze(page);

  const target = quietNeighbor(page);
  test.skip((await target.count()) === 0, '这一版的地图上入口没有非战斗邻居');
  const targetId = await nodeIdOf(target);
  await target.click();
  await target.click();
  await expectPersisted(page, (profile) => profile.mazeRun?.playerNodeId, targetId);

  await page.locator('.maze__reset').click();
  await expectPersisted(page, (profile) => profile.mazeRun?.version, 2);
  await expectPersisted(page, (profile) => profile.mazeRun?.playerNodeId, 0);
  await expectPersisted(page, (profile) => profile.mazeRun?.exploredNodeIds.length, 1);
  await expect(page.locator('.maze__foot')).toContainText('已探索 1 /');

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});
