import { expect, test } from '@playwright/test';

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

    await expect(page.getByRole('heading', { name: '数据自检' })).toBeVisible();

    // 与 docs/import-report.md 的「卡牌总量」一节对应
    const expected: [string, string][] = [
      ['卡牌条目', '256'],
      ['数据完整', '247'],
      ['数据不完整', '9'],
      ['技能族', '35'],
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
    const firstCardName = page.locator('.probe__table tbody tr').first().locator('td').nth(1);
    await expect(firstCardName).toBeVisible();
    // 名称必须是中日韩统一表意文字，而不是替换字符或空
    await expect(firstCardName).toHaveText(/[一-鿿]/);
  });

  test('未实现的页签给出明确占位而不是空白', async ({ page }) => {
    await page.goto('/');
    // 战斗场景在 P1 已实现，这里检查仍未实现的开发查看器
    await page.getByRole('button', { name: '开发查看器' }).click();
    await expect(page.getByText('尚未实现，计划在 P1 阶段完成。')).toBeVisible();
  });
});
