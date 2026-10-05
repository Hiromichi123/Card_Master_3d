import { expect, test } from '@playwright/test';

/**
 * 画布截图的 base64。
 *
 * **不要**用 `Array.from(buffer)` 把字节数组传进页面：1920×1034 的画布截图
 * 约 1.5 MB，转成数字数组后序列化要好几秒；加上环境贴图与天气层之后截图更大，
 * 直接把断言的 20 秒预算耗光——场景其实是好的，是测量方法太慢。
 * base64 是字符串，序列化成本低一个数量级。
 */
async function canvasPngBase64(page: import('@playwright/test').Page): Promise<string> {
  return (await page.locator('canvas').screenshot()).toString('base64');
}

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
  const base64 = await canvasPngBase64(page);
  // PNG 交给浏览器解码，避免在测试里引入图像库依赖
  return page.evaluate(async (png: string) => {
    // 走 data URL 让浏览器自己解码：比在页面里手写 base64 解码更短，
    // 也不会碰上 Uint8Array 的 ArrayBufferLike 类型问题
    const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
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
    const { data: pixels } = ctx.getImageData(x, y, w, h);
    let total = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      total += (pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / 3;
    }
    return total / (pixels.length / 4);
  }, base64);
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
    // 预算放宽：软件渲染下程序化贴图与环境贴图都要现算
    await expect(async () => {
      expect(await canvasBrightness(page)).toBeGreaterThan(8);
    }).toPass({ timeout: 60_000 });

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
    }).toPass({ timeout: 60_000 });

    const box = await canvas.boundingBox();
    expect(box?.width).toBe(1280);
    expect(box?.height).toBeGreaterThan(500);
  });
});

test.describe('战斗台面主题', () => {
  /**
   * 只抽查 5 套有代表性的台面。
   *
   * 十套全跑在 SwiftShader 上要 4 分钟以上——每换一套台面都要现生成 768² 的
   * 木纹或大理石（逐像素 fbm）、重编译着色器、再截一次画布。
   * 「十套都不重复」这件事由 `tests/unit/tableThemes.test.ts` 用数据断言覆盖，
   * 这里只验证**渲染路径**确实跟着主题变了。
   */
  test('代表性台面切换后画面确实改变且无报错', async ({ page }) => {
    test.setTimeout(180_000);

    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        problems.push(`console: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

    await page.goto('/');
    await page.getByRole('button', { name: '战斗场景' }).click();
    await page.waitForTimeout(4000);

    const select = page.getByLabel('战斗台面');
    const all = await select
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(all.length).toBeGreaterThanOrEqual(6);

    // 木 / 大理石 / 石+玻璃 / 自发光 / 天气，各取一套
    const ids = ['tournament', 'marble', 'obsidian', 'neon', 'snow'].filter((id) =>
      all.includes(id),
    );
    expect(ids.length).toBe(5);

    /** 台面区域的像素指纹，用来判断主题是否真的换了外观。 */
    const fingerprint = async (): Promise<string> => {
      const base64 = await canvasPngBase64(page);
      return page.evaluate(async (png: string) => {
        const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
        const bitmap = await createImageBitmap(blob);
        const off = new OffscreenCanvas(64, 64);
        const ctx = off.getContext('2d');
        if (!ctx) return '';
        ctx.drawImage(bitmap, 0, 0, 64, 64);
        const { data: pixels } = ctx.getImageData(0, 0, 64, 64);
        let sum = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          sum =
            (sum + pixels[i]! * 3 + pixels[i + 1]! * 5 + pixels[i + 2]! * 7) % 1_000_003;
        }
        return String(sum);
      }, base64);
    };

    const seen = new Map<string, string>();
    for (const id of ids) {
      await select.selectOption(id);
      // 程序化贴图要现画，新材质也要编译，给足时间
      await page.waitForTimeout(2200);
      seen.set(id, await fingerprint());
    }

    // 每一套抽查的台面都应当与其它看起来不同——相同说明主题没生效
    const unique = new Set(seen.values());
    expect(unique.size, `有台面外观完全相同：${JSON.stringify([...seen])}`).toBe(ids.length);

    expect(problems, `切换台面时出错：\n${problems.join('\n')}`).toEqual([]);
  });
});

test.describe('相机', () => {
  test('四个视角预设都能切换，取景确实改变且内容不被裁掉', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));

    await page.goto('/');
    await page.getByRole('button', { name: '战斗场景' }).click();
    await page.waitForTimeout(4000);

    const camSelect = page.getByLabel('相机视角');
    const ids = await camSelect
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(ids).toEqual(['orbit', 'top', 'low', 'commander']);

    const seen = new Map<string, string>();
    for (const id of ids) {
      await camSelect.selectOption(id);
      await page.waitForTimeout(1800);
      seen.set(id, await canvasPngBase64(page));
    }

    // 每个预设都应当给出不同的取景；相同说明模式没生效
    expect(new Set(seen.values()).size).toBe(ids.length);

    // 取景是按内容外接盒算的，所以任何视角下格子垫都应当完整可见
    await camSelect.selectOption('orbit');
    await page.waitForTimeout(1800);
    const bounds = await page.evaluate(async (png: string) => {
      const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const off = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = off.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      // 奶白色的棋盘格只出现在格子垫上，用它来定位板面
      let minX = bitmap.width;
      let maxX = -1;
      for (let y = 0; y < bitmap.height; y += 3) {
        for (let x = 0; x < bitmap.width; x += 3) {
          const i = (y * bitmap.width + x) * 4;
          const r = data[i]!;
          const g = data[i + 1]!;
          const b = data[i + 2]!;
          if (r > 165 && g > 145 && b > 105) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }
      return { minX, maxX, width: bitmap.width };
    }, await canvasPngBase64(page));

    expect(bounds, '没能定位到格子垫').not.toBeNull();
    if (bounds) {
      expect(bounds.minX, '板面左侧被裁掉').toBeGreaterThan(2);
      expect(bounds.width - bounds.maxX, '板面右侧被裁掉').toBeGreaterThan(2);
    }

    expect(problems, `相机切换出错：\n${problems.join('\n')}`).toEqual([]);
  });
});
