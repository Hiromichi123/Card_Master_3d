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
  // 主界面 →「演示战斗」。P5 之后战斗不再是导航栏上的页签
  await page.goto('/');
  await page.getByRole('button', { name: '演示战斗' }).click();
  await expect(page.getByRole('button', { name: '开始对局' })).toBeVisible();
}

/** 起一局并开自动演示，一路跑到胜负页。返回判定、比分与原因。 */
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

/**
 * 画布里按比例取的一个点。用比例而不是像素，换视口尺寸时不用改。
 *
 * `xRatio` 可以偏开中线：手牌是**浮在准备行前面**的，
 * 中间几个准备槽会被手牌挡住，只有两端的槽能直接点到。
 */
function pointAt(
  box: { x: number; y: number; width: number; height: number },
  ratio: number,
  xRatio = 0.5,
): { x: number; y: number } {
  return { x: box.x + box.width * xRatio, y: box.y + box.height * ratio };
}

/**
 * 依次尝试几个候选位置，直到其中一次点击生效。
 *
 * 两个原因让它必须容错：
 *
 * 1. 3D 场景的命中检测是位置相关的，而画布里的东西会随取景微动——
 *    布局调一次（比如把手牌挪到盘外），写死的比例就全废了。
 * 2. 这个用例还要和一条两分钟的用例并行跑，GPU 争用时首次点击也可能落空。
 *
 * 重试比把等待时间调大更稳，也不会掩盖「点了完全没反应」的真问题：
 * 所有候选都试过还是没反应，用例就失败。
 */
async function clickOneOf(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  ratios: readonly number[],
  settled: () => Promise<boolean>,
): Promise<void> {
  for (const ratio of ratios) {
    const at = pointAt(box, ratio);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(350);
    if (await settled()) {
      return;
    }
  }
  throw new Error(`这些比例都没点中：${ratios.join(', ')}`);
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
  const selected = async () => (await hintText()) === '点击高亮的准备区槽位放置';

  // 手牌在画布下方（盘外、悬空），准备行在它上面一行
  const HAND_RATIOS = [0.84, 0.86, 0.82, 0.88, 0.8] as const;
  // 先试两端（不会被手牌挡住），再试中间
  const PREP_SPOTS = [
    [0.76, 0.34],
    [0.76, 0.66],
    [0.74, 0.34],
    [0.78, 0.66],
    [0.72, 0.34],
    [0.8, 0.66],
    [0.78, 0.5],
    [0.74, 0.5],
  ] as const;

  /*
    点一张手牌。**选中态的提示文案要和未选中态区分开**：
    未选中的提示里也含「准备区槽位」四个字，拿它当判据会一直通过。
  */
  await clickOneOf(page, box, HAND_RATIOS, selected);

  // 取消选中：点桌面上一处空位（棋盘上半边），提示回到初始态
  await clickOneOf(page, box, [0.32, 0.3, 0.36], async () =>
    (await hintText()).startsWith('本回合必须先出一张牌'),
  );

  /*
    把牌放到准备区。
    每次换候选位置之前都要**重新选一次手牌**：点空了会被 `onPointerMissed`
    当成「点空白取消选中」，选中态一没，后面的候选位置点了也没用。
  */
  const placed = async () =>
    (await page.locator('.hud__log').innerText()).includes('进入准备区');
  for (const [ratio, xRatio] of PREP_SPOTS) {
    if (await placed()) {
      break;
    }
    await clickOneOf(page, box, HAND_RATIOS, selected);
    const prep = pointAt(box, ratio, xRatio);
    await page.mouse.click(prep.x, prep.y);
    await page.waitForTimeout(400);
  }
  expect(await placed(), '把牌放到准备区没有成功').toBe(true);

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

  expect(problems, `场景出现问题：${problems.join(' / ')}`).toEqual([]);
});

test('普通与跳过得到完全相同的胜负与最终生命', async ({ page }) => {
  // 正常速度跑完整局约两分钟，跳过不到一秒
  test.setTimeout(400_000);
  const problems = collectProblems(page);

  await gotoBattle(page);
  const normal = await autoPlayToResult(page);

  // 回到菜单，切到跳过档，用同一个固定种子再跑一遍
  await page.getByRole('button', { name: '返回菜单' }).click();
  await expect(page.getByRole('button', { name: '开始对局' })).toBeVisible();
  await page.getByRole('button', { name: '跳过', exact: true }).click();
  const skipped = await autoPlayToResult(page);

  expect(skipped.verdict).toBe(normal.verdict);
  expect(skipped.score).toBe(normal.score);
  expect(skipped.reason).toBe(normal.reason);
  // 固定种子下必须真的分出了胜负，而不是两边都没打完
  expect(['胜利', '失败', '平局']).toContain(normal.verdict);

  expect(problems, `场景出现问题：${problems.join(' / ')}`).toEqual([]);
});

test('再来一局与返回菜单都能回到正确状态', async ({ page }) => {
  test.setTimeout(300_000);
  const problems = collectProblems(page);

  await gotoBattle(page);
  // 用跳过档把流程走快，这里验的是流程不是演出
  await page.getByRole('button', { name: '跳过', exact: true }).click();
  await autoPlayToResult(page);

  /*
    **不要在这里断言「停在第 1 回合」。** 自动演示还开着，点完「再来一局」
    对局会立刻继续推进，断言第 1 回合等于赌时序——这个用例原先就是这么写的，
    靠撞运气过了几次，并行跑的时候才露出来。
  */
  await page.getByRole('button', { name: '再来一局' }).click();
  await expect(page.locator('.overlay__title')).toBeHidden();
  await expect(page.locator('.hud__turn')).toBeVisible();

  // 自动演示会再打完一局；等它出结果再回菜单
  await expect(page.locator('.overlay__title')).toBeVisible({ timeout: 240_000 });
  await page.getByRole('button', { name: '返回菜单' }).click();
  await expect(page.getByRole('button', { name: '开始对局' })).toBeVisible();

  /*
    关掉自动演示再开一局——**这一步才是确定性的**：
    轮到玩家且输入开放，对局会停在第 1 回合满血等着。
  */
  await page.getByLabel(/自动演示/).uncheck();
  await page.getByRole('button', { name: '开始对局' }).click();
  await expect(page.locator('.hud__turn')).toContainText('第 1 回合');
  await expect(page.locator('.hud__side').first()).toContainText('20 / 20');
  await expect(page.locator('.hud__side').nth(1)).toContainText('20 / 20');

  expect(problems, `场景出现问题：${problems.join(' / ')}`).toEqual([]);
});
