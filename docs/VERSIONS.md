# 版本锁定与运行环境

日期：2026-10-05。对应施工清单 P0-3「确认 React/R3F/Drei/Three.js/后处理稳定版兼容关系，锁定版本与 Node 运行要求」。

本文件是依赖版本的事实来源。`package.json` 中的版本必须与此处一致；若调查后需要变更，
先改本文件并记录原因，再改 `package.json`。所有版本均已通过 `npm view` 核实为已发布版本，
peer 约束为注册表返回的实际值，不是推测。

## 1. 运行环境

| 项 | 要求 | 本机现值 | 说明 |
| --- | --- | --- | --- |
| Node | `^20.19.0 \|\| >=22.12.0`（推荐 24.x LTS） | 22.11.0 ⚠️ 不满足 | Vite 8.3.2 的 `engines.node` 原文要求 |
| npm | >= 10 | 10.9.0 ✅ | 随 Node 升级 |
| Python | 仅离线导入/素材派生，不参与运行时 | 3.11.7 ✅ | 见第 4 节 |
| Pillow | 派生三档纹理 | 10.2.0 ✅ | 仅 `scripts/prepare-assets.py` 使用 |
| GPU/浏览器 | Chrome / Edge 实际 WebGL2 页面 | 待 P1 记录具体型号 | 见第 5 节 |

**Node 升级是本项唯一阻塞点。**升级前不能执行 `npm install`，也不能运行 Vite/Vitest。

### 1.1 为什么不能自动完成（已实测）

2026-10-05 尝试自动升级，结论是需要一次**提权**操作。事实如下：

| 事实 | 值 | 影响 |
| --- | --- | --- |
| 现有 Node 安装位置 | `F:\Node.js\`（手工解压版，非 nvm） | — |
| 当前用户 | `22716`，**属于 Administrators 组** | 具备提权能力 |
| 当前进程是否提权 | **否**（UAC 下未提权） | 无法写入受保护目录 |
| `F:\Node.js` 的 ACL | `Users: ReadAndExecute`，**普通用户无写权限** | 不能就地替换 |
| `F:\Node.js\` 在 PATH 中的位置 | **Machine PATH 第 10 项**，也在 User PATH 中 | 见下 |
| Windows 的 PATH 解析顺序 | **Machine 段在前，User 段在后** | Machine 里的旧路径永远先命中 |

实测：即使用 `winget` 把 Node 24 装到用户级并加入 User PATH，新建进程仍然解析到
`F:\Node.js\node.exe`（v22.11.0），因为 Machine PATH 里那条排在前面。

因此，**只改 User PATH 无法生效**。可用的两条路都需要提权：

1. 替换 `F:\Node.js` 的内容（推荐：不动任何环境变量，PATH 保持原样）；
2. 从 **Machine PATH** 中删掉 `F:\Node.js\`（需改注册表，且要保留 `REG_EXPAND_SZ` 类型）。

### 1.2 已完成的准备工作

- 从 nodejs.org 下载 Node **v24.21.0 LTS**，SHA256 与官方 `SHASUMS256.txt` **校验通过**。
- 用 `winget install --id OpenJS.NodeJS.LTS --scope user` 安装了 Node **24.19.0 LTS**
  （npm 11.17.0），位于：
  `C:\Users\22716\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64`

  这个副本目前**不生效**（被 Machine PATH 遮蔽），但可以当作替换源。

### 1.3 待执行（需要一次提权）

在**管理员** PowerShell 中执行（会先把旧安装完整备份）：

```powershell
$src = "C:\Users\22716\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64"
Copy-Item F:\Node.js F:\Node.js.bak-22.11.0 -Recurse
robocopy $src F:\Node.js /MIR /NFL /NDL /NJH /NJS /NP
& F:\Node.js\node.exe -v          # 期望 v24.19.0
```

随后**新开**一个普通终端确认：

```bash
node -v     # 期望 v24.19.0
npm -v      # 期望 11.x
```

确认无误后可以删除备份 `F:\Node.js.bak-22.11.0`，并考虑
`winget uninstall OpenJS.NodeJS.LTS` 移除那份冗余副本。

> 若不想提权：退路是把工程降到 Node 22.11 可用的工具链
> （Vite 6.4.3 + Vitest 3.2.7 + @vitejs/plugin-react 5.2.0）。
> 这会把工程基线整体压低一代，属于用户此前已否决的选项，仅在无法提权时采用。
> 具体版本见本文件第 3 节表格的备选列（P1 若采用需回填）。

升级后请把 `node -v` 的实际输出补进 `docs/validation/P1.md` 的环境记录。

## 2. 运行时依赖

| 包 | 锁定版本 | 约束依据 |
| --- | --- | --- |
| react | 19.3.0 | R3F 9.8.1 要求 `react >=19 <19.4` |
| react-dom | 19.3.0 | 同上，`react-dom >=19 <19.4` |
| three | 0.186.1 | Drei 10.7.9 要求 `three >=0.159`，R3F 要求 `>=0.156` |
| @react-three/fiber | 9.8.1 | 主版本必须与 React 主版本匹配（官方要求） |
| @react-three/drei | 10.7.9 | 要求 `react ^19` + `@react-three/fiber ^9.0.0` |
| @react-three/postprocessing | 3.1.3 | 要求 `@react-three/fiber >=9.7.0`，`postprocessing ^6.36.0` |
| postprocessing | 6.39.5 | 满足上一条 `^6.36.0` |
| zustand | 5.0.15 | 低频应用状态；Drei 自身也依赖 `zustand ^5.0.1`，不会产生双实例 |

React 采用 **19.3.0 而不是 19.x 的最新补丁**：R3F 9.8.1 的 peer 上界是 `<19.4`，
19.3.0 是当前满足该区间的最高已发布版本。若后续 R3F 放宽上界，再一并升级。

## 3. 开发依赖

| 包 | 锁定版本 | 约束依据 |
| --- | --- | --- |
| vite | 8.3.2 | `engines.node: ^20.19.0 \|\| >=22.12.0` |
| @vitejs/plugin-react | 6.1.2 | peer 为 `vite ^8.0.0`；与 Vite 8 配套 |
| typescript | 7.0.2 | `latest` dist-tag；见下方风险说明 |
| @types/react | 19.3.0 | 与 react 版本对齐 |
| @types/react-dom | 19.3.0 | 与 react-dom 版本对齐 |
| @types/three | 0.186.0 | 与 three 0.186.1 同次发布线 |
| @types/node | 26.6.4 | 仅脚本与配置类型；Vitest 5 要求 `>=22.0.0` |
| vitest | 5.0.3 | peer `vite ^6.4.0 \|\| ^7.0.0 \|\| ^8.0.0`，覆盖 Vite 8 |
| jsdom | 30.1.2 | Vitest 的 DOM 环境，供少量 UI 层测试 |
| @playwright/test | 1.63.0 | P7 浏览器流程；P0 只锁定不安装 |

`@vitejs/plugin-react` 必须用 6.x：5.x 的 peer 只到 `vite ^7.0.0`，与 Vite 8 不匹配。

### TypeScript 7 风险与回退

TypeScript 的 `latest` 已是 7.0.2（原生编译器重写），6.0.3 与 5.9.3 仍可安装。
本项目 Vite 只用 esbuild/oxc 做转译，`tsc` 仅负责类型检查，因此 TS 7 的风险面主要在
类型检查行为差异和消费 TS 编译器 API 的工具（ESLint 规则、插件）尚未跟进。

处理方式：P0 锁定 7.0.2；若 P1 初始化时出现类型检查或工具链不兼容，回退到 6.0.3
并在本文件记录具体报错，不静默降级。

## 4. Python 的边界

Python **不参与运行时**，浏览器版本不需要 Python 后端。仅允许两种用途：

1. `scripts/import-legacy-data.py`：读取 `D:\Github\card_maker` 的 JSON 与目录，
   生成规范化的 `src/data/*.json` 与导入报告（P0-5、P0-8）。
2. `scripts/prepare-assets.py`：用 Pillow 派生 thumbnail/battle/detail 三档纹理（P0-13）。

选 Python 而非 Node 的理由：PLAN 第 2 节已明确「Python 仅可用于离线素材转换」；
读取旧目录、解析旧 JSON、按原比例生成派生图在 Pillow 里最短，且不必等 Node 升级。
导入脚本必须可重复运行、不写入原项目目录。

## 5. P1 需要补齐的环境记录

以下项目在 P1 建立样机时实测并写入 `docs/validation/P1.md`，此处不预填：

- 参考机器 CPU / GPU 型号、显存、驱动版本
- 浏览器与版本（Chrome / Edge 实测 WebGL2）
- 分辨率与 DPR
- 首次冷加载耗时、首次 Shader 编译卡顿、预热后帧耗时
- 中档预算实测：常驻纹理 MiB、draw calls、活跃粒子数

## 6. 明确不引入的依赖

| 不引入 | 原因 |
| --- | --- |
| WebGPU 渲染路径 | PLAN 第 2 节：不因追逐最新版本引入实验性路径 |
| 通用 ECS / 大型插件框架 / 游戏编辑器 | PLAN 第 7 节：不预先引入 |
| 多套时间轴库（GSAP、anime.js 等） | PLAN 第 2 节：自建轻量时间轴 + useFrame，避免多套并存 |
| CSS 全息库直接源码（`pokemon-cards-css`） | PLAN 第 3.3 节：GPL-3.0，仅作视觉参考 |
| 任何 CDN 运行时依赖 | PLAN 第 3.3 节：发布产物不依赖第三方 CDN |
