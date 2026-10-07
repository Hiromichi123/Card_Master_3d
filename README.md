# Card Master 3D

把旧项目 `card_maker`（Pygame 原型）重写成**「3D 战桌 + 实体卡牌 + 立体技能特效」**的桌面浏览器版本。
卡牌、技能族、关卡、卡池与商店货架都来自旧项目的数据；规则引擎、渲染与交互全部重写。

**当前版本：v1.0**（2026-10-06）· [施工清单](CONSTRUCTION_CHECKLIST.md) · [重写方案](PLAN.md) · [旧项目核查](docs/LEGACY_AUDIT.md)

## 这是什么

一副牌桌摆在屏幕上：手牌是能拿起来翻面的实体卡，出牌有位移与落位演出，
技能带火球、电弧、护盾、治疗环这些立体特效；卡面是高分辨率成品卡面，
动态 ATK/HP/CD 与卡面分开显示（改数值不用重画贴图）。

战斗规则跑在一个**不依赖浏览器**的引擎里（`src/domain/`，没有一行 `three`/`react`/DOM 的 import），
所以整局对局可以在 node 里跑完并逐事件复现；界面只负责把事件按顺序演出来。
这条边界是重写时最先立下的，也是「同种子必定同结果」能被测试钉住的原因。

## 快速开始

```bash
npm install
npm run dev      # http://127.0.0.1:5173
```

运行环境：**Node >= 22.12.0**（Vite 的 `engines` 校验；本机升级过程见 [docs/VERSIONS.md](docs/VERSIONS.md) 第 1 节）。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run typecheck` | `tsc --noEmit`，秒级，任何改动都跑 |
| `npm run test` | Vitest 单元测试（全套，秒级） |
| `npx playwright test` | 浏览器用例（自动起 dev server，分钟级） |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run preview` | 预览生产构建（本地 HTTP，不依赖任何 CDN） |

**日常改动只跑相关的那几个用例**：浏览器用例要现开页面、台面贴图是逐像素现生成的，
跑满一次是分钟级，而其中大部分与本次改动无关。改完跑
`npx playwright test tests/browser/<对应文件>.spec.ts` 与
`npx vitest run tests/unit/<对应文件>.test.ts` 即可，
完整的那套留到阶段收尾、提交前跑（约定见 [CONSTRUCTION_CHECKLIST.md](CONSTRUCTION_CHECKLIST.md) 开头）。
代价是回归要到收尾才暴露，所以**新增或改动的行为必须当场补上断言**。

## 已实现的玩法

主菜单顶栏是页签，玩法分两条动线：**进入战斗**（选择对战模式）与**活动入口**（限时活动）。

| 入口 | 内容 | 对应旧版 |
| --- | --- | --- |
| 主菜单 | 海报轮播、视差背景、配置/图鉴/商店入口 | `menu.py` |
| 进入战斗 → 单人战役 | 世界地图 → 章节地图 → 开战 → 结算，三章十二关 | `scenes/map/*` |
| 进入战斗 → 活动模式 | 活动大厅：迷宫挑战 / 深渊（未开放）/ 协力（未开放） | `activity/activity_scene.py` |
| 活动大厅 → 迷宫挑战 | **迷宫第一层**：50–60 节点的地图、走格子、普通/精英/Boss 节点、楼层商店、徽章与活动卡掉落 | `activity/maze_scene.py` |
| 抽卡 | 8 个卡池，单抽与十连；概率由权重现算 | `gacha/*` |
| 图鉴 | 按稀有度/拥有数筛选，悬停出详情 | `collection.py` |
| 配置 | 组卡：上限 12 张，可用张数 = 拥有 − 已上阵 | `deck_builder_scene.py` |
| 商店 | 常规与活动两套货架，按日刷新的售罄记录 | `shop_scene.py` / `activity_shop_scene.py` |
| 融合 | 五槽祭坛：五张换一张，消耗/结果权重与概率由配置算出 | `workshop_scene.py` |
| 演示战斗 / 战役 / 迷宫 | 同一套引擎，对 AI；可正常/快速/跳过三档演出 | `battle/*` |

战斗设置（**台面** 10 套、**视角** 4 个预设、画质档、演出速度、震动、静止）就在战斗界面里：
对局菜单中默认展开，开打后收成右下角一行「战斗设置」，随时可再打开。战斗里
**拖动鼠标自由旋转视角**、滚轮缩放，「静止」会冻结台面天气而不是移除它。
抬头只放导航（可手动收起，把高度让给画面）与性能读数条；抽卡与融合各有自己的「跳过演出」。

## 操作

- **战斗**：点手牌选中、点准备槽放下；右下角随时写着「现在能做什么」（能不能结束回合、是不是非法目标）。
  本回合必须先出一张牌才能结束回合（旧版规则），只有手上没牌或准备区与战斗区都满时才允许直接过。
- **迷宫**：点相邻节点看详情，**再点同一个节点才出发**（旧版就是两次点击确认）；
  走到战斗节点直接开打，走到补给节点开楼层商店；左下「清空探索记录」换一轮新地图。
- **卡牌详情**：任何界面把鼠标停在卡上就出详情框（图鉴 / 商店 / 组卡 / 迷宫货架共用一套）。

## 技术栈与目录

React 19 + TypeScript + Three.js（React Three Fiber / Drei / postprocessing）+ zustand，构建用 Vite 8。

| 目录 | 内容 |
| --- | --- |
| `src/domain/` | 纯规则：战斗引擎、技能族、抽卡/经济/战役/迷宫/融合的纯逻辑。**无 DOM、无 three** |
| `src/rendering/` | 3D 表现：卡牌、战桌、特效、抽卡舞台、融合祭坛 |
| `src/scenes/` | 各个屏幕（主菜单、图鉴、商店、战役、迷宫、抽卡、战斗……）与它们之间的拼装 |
| `src/ui/` | 通用界面件：设计空间舞台、菜单壳、货币/等级条、卡牌详情 |
| `src/state/` | 存档实例（`ProfileStore`）、React 桥、toast |
| `src/services/save/` | 存档仓库：IndexedDB / 内存 / 必定失败三种实现 |
| `src/data/` | 由脚本生成的规范化数据与素材清单（不要手改） |
| `scripts/` | 构建期导入与素材脚本（Python，只在重新导入旧数据时用） |
| `tests/unit/` `tests/browser/` | 规则单测（node 环境）与端到端用例（Playwright） |

## 验证

v1.0 提交前在参考机器上跑过（Intel Arc 核显 / Chrome / 1920×1080）：

| 项 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，零错误 |
| `npm run test` | **277 passed** |
| `npm run build` | 通过（1.58 s，生产构建，素材全部本地，无第三方 CDN） |
| `npx playwright test` | **37 passed / 9 failed**（4.2 min）——**不是全绿，见下节** |

浏览器用例的 9 条失败分两类：**迷宫那 2 条单跑时通过**（全套并发 5 个 worker、
同时还在跑生产构建，5 秒的落盘断言超时），**其余 6 条属于正在收尾的两摊工作**
（抽卡页改版 `gacha.spec.ts` ×5、战斗演出 `battleSlice.spec.ts` ×1）。
发布这个快照时如实记下来，没有把它们藏进「已知问题」以外的说法里。

性能与逐项验收记录在 `docs/validation/Px.md`；日常改动的验证范围约定见
[CONSTRUCTION_CHECKLIST.md](CONSTRUCTION_CHECKLIST.md) 开头。

## 文档

1. [PLAN.md](PLAN.md)：范围、技术选型、3D 表现、战斗架构、资源与存档策略。
2. [CONSTRUCTION_CHECKLIST.md](CONSTRUCTION_CHECKLIST.md)：按阶段勾选的施工任务、依赖与验收门槛。
3. [docs/LEGACY_AUDIT.md](docs/LEGACY_AUDIT.md)：旧项目静态核查、迁移来源与未完成内容。

| 文件 | 内容 |
| --- | --- |
| [docs/rules.md](docs/rules.md) | 战斗规则基线与新旧差异（D1–D15），每条标注是否改变对局结果 |
| [docs/SKILL_COVERAGE.md](docs/SKILL_COVERAGE.md) | 35 技能族逐族机制与 47 种未识别 trait 的分类依据 |
| [docs/VISUAL_SPEC.md](docs/VISUAL_SPEC.md) | 视觉规范与参考效果清单 |
| [docs/MAZE_FLOOR1.md](docs/MAZE_FLOOR1.md) | 迷宫第一层：与旧版有意不同的地方、验证结果、没验到的部分 |
| [docs/VERSIONS.md](docs/VERSIONS.md) | 锁定的依赖版本、Node 要求、Python 边界 |
| [docs/SLICE.md](docs/SLICE.md) | 切片牌与固定 seed 的使用方式 |
| [docs/import-report.md](docs/import-report.md) | 由脚本生成的导入报告，随数据源更新 |
| [docs/validation/](docs/validation/) | 每个阶段的验证环境、逐项结果与实测数字 |
| [assets-sources.json](assets-sources.json) | 素材来源与许可登记 |

## 数据与素材来源

- **卡牌**：247 张有效卡 + 9 张 `#yoroi` 未完成卡（只留档，不进战斗与抽卡池）。
- **内容**：三章十二关、12 套敌方牌组、8 个抽卡池、常规/活动商店与融合配置，
  全部由 `scripts/import-legacy-data.py` 从旧项目导入并规范化（可重复运行、不改动原项目）。
- **素材**：卡面/卡背/图标/海报/背景的派生纹理在 `public/assets/`，由 `scripts/prepare-assets.py` 生成。
  原素材在旧仓库内，不在本仓库；来源与许可见 `assets-sources.json`。
- **移植的第三方代码**：台面系统、材质数据、环境光照与天气层移植自
  [Chessboard-three.js](https://github.com/ibra-kdbra/Chessboard-three.js)（MIT），逐文件对应见 `assets-sources.json` 的 `portedCode` 段。
- **参考项目**：旧项目与其中的第三方素材多为 GPL，**只作视觉参考**，不复制其代码与素材。

## 已知限制与未完成

- **浏览器用例不是全绿**：见上一节，9 条里 2 条是全套并发下的超时、6 条是抽卡页与战斗演出正在收尾的部分。
- **未实现**：本地 Draft（28 张轮流选牌）与同机双人对战、迷宫第二层、活动增益条目、
  设置页（画质/音量等已有状态与入口，屏幕本身还是占位）、新版存档的 JSON 导入导出。
- **不提供**：局域网联机入口——旧版那几个入口在界面上明确标着「本版本不提供冒充联机的入口」。
- **数据侧的既有缺陷已按计划处理**：`2-3`/`2-4` 的敌方牌组是 13 张、超过组卡上限，
  启动关卡时裁到 12 张并在界面上说明；`#yoroi` 缺 ATK/HP/CD，列为未完成内容。
- **P4 的「35 技能族逐族验收」仍未闭环**：引擎侧 35 族都有规则与表现映射，
  但每一族的规则样例与 VFX 展示入口没有逐条走查。
- 首帧耗时没有取得可信数字（P1 记过一次，留给 P7 重测）；
  已有性能数字（中档 3.47 ms/帧、182 draw calls）是 P1 时期的实测，
  加入抽卡舞台、迷宫与融合之后**没有重测**。
- 生产构建是**单个 JS 包**（1.8 MB，gzip 485 kB，Vite 会给一条 chunk 体积警告），
  没有做代码分割——首屏会把 Three.js 一起下载。
- 迷宫只有第一层；Boss 打完后地图上盖「已通关」，不会生成下一层。

## 更新日志

### v1.0 — 2026-10-06

- 完成 P0–P3 与 P5：数据与规则基线、工程骨架与视觉样机、独立战斗引擎、
  首个可玩战斗切片、基础玩法循环（抽卡 → 图鉴 → 组卡 → 战役 → 商店 → 结算）与统一存档。
- 完成 P6 的迷宫第一层：生成与强度经济、runState 持久化、倾斜节点场景与走格子、
  开战结算接线、楼层商店。
- 完成融合工坊的规则与界面（立体祭坛的表现仍在施工）。
- 全部素材为本地派生纹理，生产构建不依赖第三方 CDN。
