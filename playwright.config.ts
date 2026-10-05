import { defineConfig } from '@playwright/test';

/**
 * 浏览器验证配置。
 *
 * 用真实 WebGL2 页面验证，而不是只看构建成功
 * （PLAN 第 9 节：仅构建成功不能代表粒子或交互正确）。
 */
export default defineConfig({
  testDir: './tests/browser',
  /**
   * 并行执行。
   *
   * 这里曾经被迫改成串行：headless 走 SwiftShader **软件渲染**，而每个用例都要
   * 现生成程序化台面贴图（木纹/大理石是逐像素跑 fbm），几个用例同时跑会把 CPU 抢光
   * ——「单独跑 22 秒通过，5 个并行时全部超时」。
   *
   * 换成下面那个带 GPU 的有头浏览器之后这个理由就不成立了：
   * 7 个用例 7 个 worker 全绿，耗时 25 秒。软件渲染才需要串行，GPU 不需要。
   */
  fullyParallel: true,
  timeout: 60_000,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        browserName: 'chromium',
        /**
         * 用**带 GPU 的有头浏览器**跑，不用 headless。
         *
         * headless 走 SwiftShader 软件渲染：这个画面里台面贴图是逐像素 fbm 现生成的、
         * 还有一次 PMREM 环境贴图，全是纯 CPU 的活，一套台面初始化要好几秒，
         * 十套主题的用例直接跑到四分钟以上并超时。
         *
         * 换成走 D3D11 的核显之后同样的场景是 3.5 ms/帧（见 P1 验证记录的实测表）。
         * 更重要的是，PLAN 第 9 节要求的验收方式本来就是「以实际 WebGL 页面验证」——
         * 软件渲染既慢又不代表玩家会看到的画面。
         */
        headless: false,
        launchOptions: {
          args: [
            '--use-angle=d3d11',
            '--enable-gpu',
            '--ignore-gpu-blocklist',
            // 窗口被遮挡时 Chromium 会把 rAF 节流到 1 Hz，测试会因此假超时
            '--disable-backgrounding-occluded-windows',
            '--disable-features=CalculateNativeWinOcclusion',
          ],
        },
        // 先用 P1 的目标分辨率之一；P7 再覆盖 1280×720 与窗口缩放
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: 'npx vite --port 5173 --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
