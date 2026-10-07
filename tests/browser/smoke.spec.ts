import { expect, test } from '@playwright/test';

import { EXPECTED_FAMILY_COUNT } from '../../src/domain/skills/families';

/**
 * P1 骨架的浏览器冒烟测试。
 *
 * 目的不是覆盖玩法，而是确认三件事：
 * 1. 应用能在真实浏览器里启动，而不是只有构建成功；
 * 2. 导入的数据在浏览器中读到的是**预期数值**（数字对不上就是导入链路有问题）；
 * 3. 中文正常显示，没有缺字（V-HUD-1）。
 */
test.describe('应用骨架', () => {
  test('启动后无控制台错误，且数据自检数值与导入报告一致', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    // P5 之后落地页是主菜单，数据自检变成一个页签
    await page.getByRole('button', { name: '数据自检' }).click();

    await expect(page.getByRole('heading', { name: '数据自检' })).toBeVisible();

    // 与 docs/import-report.md 的「卡牌总量」一节对应
    const expected: [string, string][] = [
      ['卡牌条目', '256'],
      ['数据完整', '247'],
      ['数据不完整', '9'],
      // 从 families.ts 派生，不再手写：新增族时面板与用例一起动
      ['技能族', String(EXPECTED_FAMILY_COUNT)],
      ['关卡', '12'],
      ['切片卡', '23'],
    ];

    for (const [label, value] of expected) {
      const stat = page.locator('.probe__stat', { hasText: label });
      await expect(stat.locator('.probe__stat-value')).toHaveText(value);
      // 数值与期望不符时组件会加上 --bad 类，这里显式断言没有
      await expect(stat).not.toHaveClass(/probe__stat--bad/);
    }

    expect(errors, `控制台出现错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('中文名称正常渲染，没有缺字方框', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '数据自检' }).click();
    const firstCardName = page.locator('.probe__table tbody tr').first().locator('td').nth(1);
    await expect(firstCardName).toBeVisible();
    // 名称必须是中日韩统一表意文字，而不是替换字符或空
    await expect(firstCardName).toHaveText(/[一-鿿]/);
  });

  test('实验台展示切片卡的真实数据，并能手动触发特效', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '实验台' }).click();

    await expect(page.getByRole('heading', { name: '实验台' })).toBeVisible();

    // 面板数据必须来自导入结果，而不是写死的占位
    const meta = page.locator('.lab__meta').first();
    await expect(meta).toContainText('A_011');
    await expect(meta).toContainText('火球1、冰封1、闪电1');

    /*
      圣盾在模板区里紧跟「护盾 / 防御」：它与护盾是同一段演出，
      只是按族色取金色（`FAMILY_TINT`），所以按钮**名字不同、模板相同**。
    */
    const templates = page
      .locator('.lab__section', { hasText: '攻击与特效' })
      .getByRole('button');
    const labels = await templates.allTextContents();
    const defenseIndex = labels.indexOf('护盾 / 防御');
    expect(defenseIndex, '模板区里没有「护盾 / 防御」').toBeGreaterThanOrEqual(0);
    expect(labels[defenseIndex + 1], '圣盾没有紧跟防御').toBe('圣盾');

    // 手动触发一个特效：活跃粒子数应当被推起来
    const particleRow = page.locator('.lab__meta').last();
    await expect(particleRow).toContainText('活跃粒子');
    await page.getByRole('button', { name: '群体火球', exact: true }).click();
    await expect
      .poll(async () => {
        const text = await particleRow.innerText();
        const match = text.match(/活跃粒子\s*(\d+)/);
        return match ? Number(match[1]) : 0;
      }, { timeout: 5000 })
      .toBeGreaterThan(20);
  });

  test('实验台是「第二行一张施法卡 + 上排三张目标」的可换阵型', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '实验台' }).click();
    await expect(page.getByRole('heading', { name: '实验台' })).toBeVisible();

    // 上排三个槽都在；默认那张飞行卡（A+_006）在**左**槽，对位留给地面卡
    const targets = page.locator('.lab__target select');
    await expect(targets).toHaveCount(3);
    await expect(page.locator('.lab__badge')).toHaveCount(1);
    await expect(page.locator('.lab__target').nth(0).locator('.lab__badge')).toHaveText('飞行');

    // 标记跟着**卡上的 trait** 走，不是写死的三个槽里固定有一个
    await targets.nth(0).selectOption('S+_014');
    await expect(page.locator('.lab__badge')).toHaveCount(0);
    await targets.nth(0).selectOption('D_001');
    await expect(page.locator('.lab__badge')).toHaveCount(1);

    // 施法卡可任选；选中一个已经在目标位上的卡时**两槽对调**，
    // 于是「施法卡 + 三张其它卡」永远是四张不同的卡
    const source = page.locator('.lab__pick select');
    await expect(page.locator('.lab__meta').first()).toContainText('A_011');
    await source.selectOption('D_001');
    await expect(page.locator('.lab__meta').first()).toContainText('D_001');
    await expect(targets.nth(0)).toHaveValue('A_011');

    // 打几张**由技能族决定**：对单只打对位那张，对群打满三张。没有覆盖开关可切
    const last = page.locator('.lab__last');
    await expect(last).toContainText('（尚未触发）');
    await page.getByRole('button', { name: '冰封', exact: true }).click();
    await expect(last).toContainText('只打对位');
    await page.getByRole('button', { name: '群体冰封', exact: true }).click();
    await expect(last).toContainText('三张');
    await expect(page.getByLabel(/群体化/)).toHaveCount(0);
  });
});
