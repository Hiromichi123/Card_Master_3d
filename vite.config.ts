import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 演示与录屏都走本地 HTTP；不使用任何第三方 CDN（PLAN 第 3.3 节）。
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    target: 'es2022',
    // 素材是三档独立纹理，不做内联，便于按档加载与淘汰。
    assetsInlineLimit: 0,
    sourcemap: true,
  },
  // 中文字体与纹理都在 public/ 下，构建产物不依赖在线资源。
  publicDir: 'public',
});
