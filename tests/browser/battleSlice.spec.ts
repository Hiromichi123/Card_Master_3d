import { expect, test, type Page } from '@playwright/test';

/**
 * P3：首个可玩战斗切片。
 *
 * 这一组是清单里「从菜单至胜负可完整试玩」与「比较普通/快速/跳过得到的
 * 最终规则状态与结果」的浏览器侧证据——单元测试证的是模型，
 * 这里证的是它在真实 WebGL 页面里也成立。
 */

/** 收集控制台错误。与既有两个 spec 同一套写法。 */
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

async function gotoBattle(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '战斗场景' }).click();
  await expect(page.getByRole('button', { name: '开始对局' })).toBeVisible();
}

/** 起一局并开自动演示，一路跑到胜负页。返回判定、比分与耗时。 */
async function autoPlayToResult(page: Page): Promise<{
  verdict: string;
  score: string;
  reason: string;
}> {
  const start = page.getByRole('button', { name: '开始对局' });
  if (await start.isVisible().catch(() => false)) {
    await page.getByLabel(/自动演示/).check();
    await start.click();
  }

  await expect(page.locator('.overlay__title')).toBeVisible({ timeout: 240_000 });
  return {
    verdict: await page.locator('.overlay__title').innerText(),
    score: await page.locator('.overlay__score').innerText(),
    reason: await page.locator('.overlay__reason').innerText(),
  };
}

async function backToMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: '返回菜单' }).click();
  await expect(page.getByRole('button', { name: '开始对局' })).toBeVisible();
}

/** 手牌与准备区在画布里的相对位置（按画布高度取比例，避免写死像素）。 */
function pointAt(box: { x: number; y: number; width: number; height: number }, ratio: number) {
  return { x: box.x + box.width / 2, y: box.y + box.height * ratio };
}

/**
 * 点画布上的某个位置，直到它生效。
 *
 * 3D 场景的命中检测是位置相关的，而画布里的东西会随取景与帧率微动；
 * 这个用例还要和一条两分钟的用例并行跑，GPU 争用时首次点击可能落空。
 * 重试几次比把等待时间调大更稳，也不会掩盖「点了完全没反应」的真问题。
 */
async function clickUntil(
  page: Page,
  at: { x: number; y: number },
  settled: () => Promise<boolean>,
  tries = 5,
): Promise<void> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(300);
    if (await settled()) {
      return;
    }
  }
  throw new Error(`点了 ${tries} 次都没有生效：${JSON.stringify(at)}`);
}

test('出牌与结束回合：HUD 的数值与日志确实跟着变', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);

  await gotoBattle(page);
  await page.getByRole('button', { name: '开始对局' }).click();

  // 开局的提示与按钮状态：旧版规则要求必须先出一张牌才能结束回合
  await expect(page.locator('.hud__hint')).toContainText('必须先出一张牌');
  await expect(page.getByRole('button', { name: '结束回合' })).toBeDisabled();

  const box = await page.locator('canvas').boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const hintText = () => page.locator('.hud__hint').innerText();

  // 点一张手牌。**选中态的提示文案要和未选中态区分开**：
  // 未选中的提示里也含「准备区槽位」四个字，拿它当判据会一直通过。
  const hand = pointAt(box, 0.86);
  await clickUntil(page, hand, async () => (await hintText()) === '点击高亮的准备区槽位放置');

  // 取消选中：点桌面上一处空位（敌方那半边的棋盘），提示回到初始态
  const empty = pointAt(box, 0.32);
  await clickUntil(
    page,
    empty,
    async () => (await hintText()).startsWith('本回合必须先出一张牌'),
  );

  // 再选一次，然后真的出牌
  await clickUntil(page, hand, async () => (await hintText()) === '点击高亮的准备区槽位放置');
  const prep = pointAt(box, 0.71);
  await clickUntil(
    page,
    prep,
    async () => (await page.locator('.hud__log').innerText()).includes('进入准备区'),
  );

  // 出牌之后手牌少一张
  await expect(page.locator('.hud__side').nth(1)).toContainText('手牌 2');

  // 出过牌之后才允许结束回合
  const endTurn = page.getByRole('button', { name: '结束回合' });
  await expect(endTurn).toBeEnabled({ timeout: 30_000 });

  /*
    这一步同时是**演出驱动真的在跑**的探针。
    EffectComposer 会让声明在它之后的兄弟组件 useFrame 订阅失效，
    症状正是「点了按钮画面永远不动、且零报错」——所以必须验证回合真的推进了。
  */
  await endTurn.click();
  await expect(page.locator('.hud__turn')).toContainText('第 2 回合', { timeout: 60_000 });

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('普通与跳过得到完全相同的胜负与最终生命', async ({ page }) => {
  // 正常速度跑完整局约两分钟，跳过不到一秒
  test.setTimeout(400_000);
  const problems = collectProblems(page);

  await gotoBattle(page);
  const normal = await autoPlayToResult(page);
  await backToMenu(page);

  // 切到跳过档，用同一个固定种子再跑一遍
  await page.getByRole('button', { name: '跳过', exact: true }).click();
  const skipped = await autoPlayToResult(page);

  expect(skipped.verdict).toBe(normal.verdict);
  expect(skipped.score).toBe(normal.score);
  expect(skipped.reason).toBe(normal.reason);
  // 固定种子下必须真的分出了胜负，而不是两边都没打完
  expect(['胜利', '失败', '平局']).toContain(normal.verdict);

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});

test('再来一局回到第 1 回合满血，返回菜单回到菜单', async ({ page }) => {
  test.setTimeout(200_000);
  const problems = collectProblems(page);

  await gotoBattle(page);
  // 用跳过档把流程走快，这里验的是流程不是演出
  await page.getByRole('button', { name: '跳过', exact: true }).click();
  await autoPlayToResult(page);

  await page.getByRole('button', { name: '再来一局' }).click();
  await expect(page.locator('.hud__turn')).toContainText('第 1 回合');
  // 双方本体都回到满血
  await expect(page.locator('.hud__side').first()).toContainText('20 / 20');
  await expect(page.locator('.hud__side').nth(1)).toContainText('20 / 20');

  await page.getByRole('button', { name: '返回菜单' }).click();
  await expect(page.getByRole('button', { name: '开始对局' })).toBeVisible();

  expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
});
