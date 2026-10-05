import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * 单元测试配置。
 *
 * 与 Playwright 分开是必须的：`tests/browser/*.spec.ts` 用的是
 * `@playwright/test` 的 `test/describe`，被 Vitest 收集到会直接报错
 * （两套 runner 的同名 API 不兼容）。这里只收 `tests/unit`。
 *
 * 规则层（P2 的 domain/battle）会跑在 node 环境；需要 DOM 的用例
 * 在文件顶部用 `// @vitest-environment jsdom` 单独声明，不全局开 jsdom。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
