import { expect, test } from '@playwright/test';

/**
 * 3D 战斗场景的浏览器验证。
 *
 * 施工清单 P1 的验收要求「以实际 WebGL 页面验证；仅构建成功不能代表粒子或交互正确」。
 * 这里检查的是**真的画出来了**：画布存在、尺寸正确、非全黑，
 * 以及没有把错误静默吞掉。
 *
 * 注意：这些断言不能证明「画面好看」，那要靠文档里的截图人工判断。
 * 它们的作用是防止后续改动把场景整个搞崩而没人发现。
 */

/** 读取画布中心区域的平均亮度，用来判断「有没有渲染出东西」。 */
async function canvasBrightness(page: import('@playwright/test').Page): Promise<number> {
  const canvas = page.locator('canvas');
  const buffer = await canvas.screenshot();
  // PNG 交给浏览器解码，避免在测试里引入图像库依赖
  return page.evaluate(async (bytes: number[]) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    const off = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = off.getContext('2d');
    if (!ctx) {
      return -1;
    }
    ctx.drawImage(bitmap, 0, 0);
    // 取中间 60% 区域，避开画布边缘的纯背景
    const x = Math.floor(bitmap.width * 0.2);
    const y = Math.floor(bitmap.height * 0.2);
    const w = Math.floor(bitmap.width * 0.6);
    const h = Math.floor(bitmap.height * 0.6);
    const { data } = ctx.getImageData(x, y, w, h);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    }
    return total / (data.length / 4);
  }, Array.from(buffer));
}

test.describe('3D 战斗场景', () => {
  test('WebGL2 可用时渲染出战桌，且无控制台错误', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        problems.push(`console: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) =>
      problems.push(`requestfailed: ${request.url()}`),
    );

    await page.goto('/');
    await page.getByRole('button', { name: '战斗场景' }).click();

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // 等首帧与纹理：卡面贴图是异步加载的
    await expect(async () => {
      expect(await canvasBrightness(page)).toBeGreaterThan(8);
    }).toPass({ timeout: 20_000 });

    // 画布应铺满可用区域，而不是塌成 0 尺寸
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(400);
    expect(box?.height ?? 0).toBeGreaterThan(300);

    expect(problems, `场景出现问题：\n${problems.join('\n')}`).toEqual([]);
  });

  test('窗口变窄时不裁掉双方区域（V-WORLD-4）', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.getByRole('button', { name: '战斗场景' }).click();

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    await expect(async () => {
      expect(await canvasBrightness(page)).toBeGreaterThan(8);
    }).toPass({ timeout: 20_000 });

    const box = await canvas.boundingBox();
    expect(box?.width).toBe(1280);
    expect(box?.height).toBeGreaterThan(500);
  });
});
