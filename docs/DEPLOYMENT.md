# 静态网页版部署

## 发布边界

当前版本是静态网页：账号、存档保存在浏览器本地；好友、排行榜及协力 Boss 共享范围为同一浏览器、同一站点内的本地账号。没有云端账号、跨设备同步或全球排行榜。切换域名、浏览器、无痕窗口会使用不同的站点存储；清理站点数据会清除本地记录。更新前可在设置中导出存档。

正式构建默认关闭 admin 导航、开发资源按钮和开发敌阵编辑。`npm run dev` 中仍只为 admin 提供这些工具。生产版本只读项目内的 `src/data/enemy-deck-config.json`；开发浏览器里的临时敌阵配置不会自动发布，也不会覆盖正式敌阵。先从开发编辑器导出 JSON，核对后替换该文件，再构建。

旧版本存档迁移和导入保留，用于保护玩家数据；旧回合抢先选择及自动部署规则不再运行。未配置敌阵的关卡不能启动或结算奖励。

## 构建与检查

使用 Node.js 24 LTS 和项目锁文件：

```sh
npm ci
npm run release:check
```

此命令依次进行类型检查、完整单元回归、生产构建和本地资源完整性检查。不会启动游戏、浏览器或发布到服务器。输出目录为 `dist/`，部署时上传整个目录内的内容，不能只上传 `index.html`。

- `npm run build`：构建，不等同于完整验收。
- `npm run check:dist`：检查 HTML 入口、卡面/背景/音效、烘焙纹理和音乐来源字节记录。
- `npm run assets:bake-surfaces`：主题参数变更后重新生成静态材质。
- 默认不生成公开源码映射；排查问题需要时可设置 `BUILD_SOURCEMAP=true`。
- `dist/release-readiness.json` 保存该构建的资源检查摘要，不含玩家数据。
- GitHub Actions 仅检查并保存 dist 构建产物，不会自动上线发布。

## 网站根目录与子目录

默认部署于网站根目录 `/`。部署到 `/card-master-3d/` 时，在构建前设置 `VITE_BASE_PATH=/card-master-3d/`，必须包含开头和结尾的 `/`。

PowerShell：

```powershell
$env:VITE_BASE_PATH = '/card-master-3d/'
npm run release:check
Remove-Item Env:VITE_BASE_PATH
```

Linux/macOS：

```sh
VITE_BASE_PATH=/card-master-3d/ npm run release:check
```

将结果放在对应子目录。卡面、背景、音乐和音效均采用同一资源基址。应用使用内存中的页面切换，不依赖服务端 API 或 history 路由重写。

## 托管设置

可使用 Nginx、静态对象存储或静态网站托管服务。使用 HTTPS，保持正确的 `.js`、`.css`、`.wasm`、`.webp`、`.png` 和音频 MIME 类型；允许本站的本地模块 Worker。无需额外开放跨域访问。

`index.html` 和没有内容哈希的卡面、背景等 public 资源应使用 `Cache-Control: no-cache` 或较短缓存并重新验证，避免玩家更新后拿到旧图。带内容哈希的 Vite JS/CSS 文件可长期缓存。发布时先上传新资源，最后替换 index.html，保留上一版本的哈希资源直到缓存失效。

静态网页版无法靠浏览器中的账号口令实现服务端权限或防篡改；本地账号的用途是区分本机玩家与存档。正式版关闭开发工具也不等同于服务端鉴权。如将来需要跨设备账号、联网排行榜或共享 Boss，需另接服务端。

## 发布记录与待测项

本次音乐发布授权由项目维护者于 2026-10-22 明确确认，已记录于 `public/assets/audio/bgm/sources.json`，没有改写成 CC0 或虚构授权证明。

本轮不启动浏览器、游戏实例或截图。类型、规则、存档、组件声明及资源完整性检查属于自动检查；实际核显帧率、触屏操作、音频听感与真实托管站点下的首屏仍需发布前实机确认。保持固定域名和正常浏览器存储权限，验证已有存档导入、刷新后数据保留及页面更新。
