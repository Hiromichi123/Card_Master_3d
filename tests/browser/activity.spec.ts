import { expect, test, type Page } from '@playwright/test';

import { collectProblems, openWithFreshSave } from './helpers';

/**
 * 活动大厅：滚轮选模式、全页滚轮、逐模式背景。
 *
 * 断的是**行为**（滚一下换一个模式、背景跟着换、未实现的给提示），
 * 不碰像素——版式交给用户看。
 */

async function openActivity(page: Page): Promise<void> {
  await openWithFreshSave(page);
  await expect(page.locator('.menu__title')).toHaveText('Card Master 3D', { timeout: 30_000 });
  await page.locator('.menu__columns').getByRole('button', { name: '进入战斗', exact: true }).click();
  await expect(page.locator('.menu__title')).toHaveText('选择对战模式');
  await page.locator('.menu__columns').getByRole('button', { name: '活动模式', exact: true }).click();
  await expect(page.locator('.menu__title')).toHaveText('限时活动模式');
  await expect(page.locator('.activity-wheel__stage')).toBeVisible();
}

/** 底座背景层的 URL（交叉淡化结束后 `base` 就是新图）。 */
function baseBackground(page: Page): Promise<string> {
  return page
    .locator('.menu__bg[data-background-layer="base"]')
    .evaluate((node) => (node as HTMLElement).style.backgroundImage);
}

function detailTitle(page: Page) {
  return page.locator('.activity-detail__title');
}

test('滚轮在**页面任意位置**都生效（不必对准轮盘）', async ({ page }) => {
  const problems = collectProblems(page);
  await openActivity(page);
  await expect(detailTitle(page)).toContainText('迷宫挑战');

  // 指针挪到远离轮盘的一侧再滚——轮盘在设计框左侧约 120–740
  await page.mouse.move(1000, 900);
  await page.mouse.wheel(0, 300);
  await expect(detailTitle(page)).toContainText('深渊挑战');

  // 两次滚动之间要留出冷却时间：`usePageWheel` 刻意不连发（见那个文件）
  await page.waitForTimeout(300);
  await page.mouse.wheel(0, -300);
  await expect(detailTitle(page)).toContainText('迷宫挑战');

  expect(problems).toEqual([]);
});

test('点击滚轮项即切换，且背景跟着换', async ({ page }) => {
  const problems = collectProblems(page);
  await openActivity(page);

  await expect.poll(() => baseBackground(page)).toContain('activity_maze_bg');

  await page.locator('.activity-wheel__option', { hasText: '协力突袭' }).click();
  await expect(detailTitle(page)).toContainText('协力突袭');
  await expect.poll(() => baseBackground(page)).toContain('activity_coop_bg');

  await page.locator('.activity-wheel__option', { hasText: '天梯赛' }).click();
  await expect(detailTitle(page)).toContainText('天梯赛');
  await expect.poll(() => baseBackground(page)).toContain('activity_ladder_bg');

  expect(problems).toEqual([]);
});

test('未实现的模式：给了提示，且不会离开活动大厅', async ({ page }) => {
  const problems = collectProblems(page);
  await openActivity(page);

  await page.locator('.activity-wheel__option', { hasText: '极难挑战' }).click();
  await expect(page.locator('.activity-detail__enter')).toHaveText('尚未开放');
  await page.locator('.activity-detail__enter').click();

  await expect(page.locator('.toast')).toBeVisible();
  await expect(page.locator('.menu__title')).toHaveText('限时活动模式');

  expect(problems).toEqual([]);
});

/**
 * 版式的两条硬约束（2026-10-08 修过一次真实问题：滚轮压住左上角的玩家状态面板，
 * 且斜切把靠下的卡片横向切掉）。
 *
 * 断言放在**舞台自己的坐标系**里（`offset*` 相对舞台）——`overflow: hidden`
 * 就是在这一层裁的，所以「选项的框有没有越出舞台」正是「看不看得全」的判据。
 * 重叠则用客户端坐标比（两者都不带斜切）。
 */
test('滚轮不遮挡玩家状态面板，且五个选项任何时候都不被裁掉', async ({ page }) => {
  const problems = collectProblems(page);
  await openActivity(page);

  const measure = () =>
    page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('.activity-wheel__stage');
      const wheel = document.querySelector<HTMLElement>('.activity-wheel');
      const status = document.querySelector<HTMLElement>('.menu__status');
      const detail = document.querySelector<HTMLElement>('.activity-detail');
      if (!stage || !wheel || !status || !detail) {
        return null;
      }
      return {
        stage: { width: stage.clientWidth, height: stage.clientHeight },
        wheel: wheel.getBoundingClientRect().toJSON(),
        status: status.getBoundingClientRect().toJSON(),
        detail: detail.getBoundingClientRect().toJSON(),
        options: Array.from(stage.querySelectorAll<HTMLElement>('.activity-wheel__option')).map(
          (node) => ({
            id: node.dataset.wheelId ?? '',
            left: node.offsetLeft,
            top: node.offsetTop,
            width: node.offsetWidth,
            height: node.offsetHeight,
          }),
        ),
      };
    });

  const overlaps = (a: DOMRect, b: DOMRect): boolean =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  // 逐个选中一遍：任何一项为选中态时，五个选项都必须整整齐齐落在舞台内
  for (const mode of ['迷宫挑战', '深渊挑战', '协力突袭', '天梯赛', '极难挑战']) {
    await page.locator('.activity-wheel__option', { hasText: mode }).click();
    const data = await measure();
    expect(data, `${mode}：量不到版式`).not.toBeNull();

    for (const option of data!.options) {
      expect(option.left, `${mode} 选中时 ${option.id} 越出左边界`).toBeGreaterThanOrEqual(0);
      expect(option.top, `${mode} 选中时 ${option.id} 越出上边界`).toBeGreaterThanOrEqual(0);
      expect(
        option.left + option.width,
        `${mode} 选中时 ${option.id} 越出右边界`,
      ).toBeLessThanOrEqual(data!.stage.width + 1);
      expect(
        option.top + option.height,
        `${mode} 选中时 ${option.id} 越出下边界`,
      ).toBeLessThanOrEqual(data!.stage.height + 1);
    }

    expect(
      overlaps(data!.wheel, data!.status),
      `${mode} 选中时滚轮压住了玩家状态面板`,
    ).toBe(false);
    expect(overlaps(data!.wheel, data!.detail), `${mode} 选中时滚轮压住了详情面板`).toBe(false);
  }

  expect(problems).toEqual([]);
});

test('迷宫：选中后点「进入」才进得去', async ({ page }) => {
  const problems = collectProblems(page);
  await openActivity(page);

  // 先切走再切回来，证明「进入」用的是**当前选中项**而不是默认项
  await page.locator('.activity-wheel__option', { hasText: '深渊挑战' }).click();
  await expect(page.locator('.activity-detail__enter')).toHaveText('尚未开放');
  await page.locator('.activity-wheel__option', { hasText: '迷宫挑战' }).click();
  await expect(page.locator('.activity-detail__enter')).toHaveText('进入');

  await page.locator('.activity-detail__enter').click();
  await expect(page.locator('.maze__title')).toHaveText('迷宫挑战·第一层');

  expect(problems).toEqual([]);
});
