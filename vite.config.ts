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
  optimizeDeps: {
    /*
      **把依赖扫描的入口钉死成 index.html。**

      不写这一条时，Vite 会在项目根目录 glob 所有 HTML 文件
      （见 `vite/dist/node` 里 `entries = await globEntries("...")`，
      那个模式是「** 斜杠星点 html」），
      于是 `assets-library/` 里那一千多个第三方参考页全成了扫描入口，
      再顺着它们的 import 去解析 `lil-gui` 之类没装的包，每次启动都报一串
      「imported but could not be resolved」。

      `optimizeDeps.exclude` 解决不了这个：它管的是「预打包时排除某个依赖」，
      而这条警告发生在**爬取阶段**——文件压根不该被当成入口。
      `server.watch.ignored` 同理，管的是监听、不是扫描。所以真正的开关是入口本身。
    */
    entries: ['index.html'],
  },
  server: {
    // 演示与录屏都走本地 HTTP；不使用任何第三方 CDN（PLAN 第 3.3 节）。
    host: '127.0.0.1',
    port: 5173,
    watch: {
      /*
        `assets-library/` 是外部参考工程（1000+ 文件、约 160 MiB，见 .gitignore），
        只作视觉参考用，不参与构建。不排掉的话，这些文件会一直占着文件监听，
        白白多出一千多个 watcher，改一个参考页还可能触发整页重载。
      */
      ignored: ['**/assets-library/**'],
    },
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
