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
升级方式（任选一，需在本机手动执行）：

```bash
# 已有 nvm-windows
nvm install lts && nvm use lts

# 或从 https://nodejs.org/ 下载当前 LTS 安装包
```

升级后请执行 `node -v` 确认输出 `>=22.12.0`，再进入 P1。当前 Node 22.11.0 与要求只差两个
补丁版本，但 Vite 是按 `engines` 硬校验的，不会自动放宽。

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
