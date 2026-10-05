import { defineConfig } from '@playwright/test';

/**
 * 浏览器验证配置。
 *
 * 用真实 WebGL2 页面验证，而不是只看构建成功
 * （PLAN 第 9 节：仅构建成功不能代表粒子或交互正确）。
 */
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
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
