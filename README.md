# Card Master 3D — 重写计划

日期：2026-10-05。原项目：`D:\Github\card_maker`。目标项目：`D:\Github\card_master_3d`。

**当前进度：P0、P1 已完成。**
P1 是工程骨架与视觉样机（3D 战桌、实体卡牌、全息、粒子特效、实验台、画质档）。
下一步是 P2：不依赖渲染的战斗规则引擎。

## 运行方式

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

导航栏三个页签：

| 页签 | 内容 |
| --- | --- |
| 数据自检 | 确认导入的数据被应用读到，数值与导入报告一致 |
| 战斗场景 | 3D 战桌、实体卡牌、悬停详情、动态数值徽标 |
| 实验台 | 手动触发卡牌特性与 13 类攻击特效，调强度/数量/时长/配色，暂停与跳过 |

导航栏右侧可切换画质档（低/中/高）与演出速度（正常/快速/跳过），并可打开性能读数条。

```bash
npm run typecheck    # tsc --noEmit
npm run test         # Vitest 单元测试
npx playwright test  # 浏览器用例（会自动启动 dev server）
npm run build        # 类型检查 + 生产构建
```

Node 需要 `>=22.12.0`；本机升级过程的记录见 [docs/VERSIONS.md](docs/VERSIONS.md) 第 1 节。

## 阅读顺序

1. [PLAN.md](PLAN.md)：范围、技术选型、3D 表现、战斗架构、资源与存档策略。
2. [CONSTRUCTION_CHECKLIST.md](CONSTRUCTION_CHECKLIST.md)：按阶段勾选的施工任务、依赖和验收门槛。
3. [docs/LEGACY_AUDIT.md](docs/LEGACY_AUDIT.md)：原项目静态核查结果、迁移来源和未完成内容。

P0 / P1 的关键文档：

| 文件 | 内容 |
| --- | --- |
| [docs/validation/P0.md](docs/validation/P0.md) | P0 验证环境、逐项结果、发现的差异与待办 |
| [docs/validation/P1.md](docs/validation/P1.md) | P1 逐项结果、实测性能数字、踩到并修掉的缺陷 |
| [docs/rules.md](docs/rules.md) | 战斗规则基线与新旧差异（D1–D15），P2 的执行依据 |
| [docs/SKILL_COVERAGE.md](docs/SKILL_COVERAGE.md) | 35 技能族逐族机制 + 47 种未识别 trait 的分类依据 |
| [docs/VISUAL_SPEC.md](docs/VISUAL_SPEC.md) | 视觉规范与参考效果清单，P1 验收直接引用 |
| [docs/VERSIONS.md](docs/VERSIONS.md) | 锁定的依赖版本、Node 要求、Python 边界 |
| [docs/SLICE.md](docs/SLICE.md) | 切片牌与固定 seed 的使用方式 |
| [docs/import-report.md](docs/import-report.md) | 由脚本生成的导入报告，随数据源更新 |
| [assets-sources.json](assets-sources.json) | 素材来源与许可登记 |

## 已确认方向

采用 React + TypeScript + Three.js + React Three Fiber + Drei，面向桌面浏览器。
先完成“3D 战桌、实体卡牌、立体技能特效”的可玩战斗，再迁移已有外围玩法。
玩法保持基本一致，允许调整场景布局、交互和实现方式；不照搬 Pygame 的 Surface 缓存、阻塞动画和临时文件通信。

首个可玩里程碑为 P3；已有玩法迁移完成的验收点为 P7。
局域网联机、账号服务、旧版未接入技能、空章节和未完成活动机制均不进入本轮施工。
用户已确认采用 3D 战桌＋实体卡牌＋立体技能特效。

## P0 已完成的内容

**数据**（`src/data/`，全部由脚本生成，可重复运行）：

- 247 张有效卡 + 9 张 `#yoroi` 未完成卡（只留档，不进战斗与抽卡池）
- 三章十二关、12 套敌方牌组、8 个抽卡池、常规/活动商店与工坊融合配置
- 23 张切片卡、两套 12 张演示牌组、固定 seed

**规则**（`docs/rules.md`）：双方 CD 同时递减、部署填首个空槽、从左到右同下标对位、
地对空只打本体、免疫只挡技能伤害、分身共享状态组而复制独立。
15 条允许改动的规则逐条标注是否改变对局结果；7 项静态阅读无法确定的留给 P2 复核。

**素材**（`public/assets/` + `src/data/assets.manifest.json`）：
切片卡的三档纹理、卡背、图标、技能图、海报与背景。
`#`、`+`、中文与空格路径已全部规范化，生成的路径中不含这些字符。

**已知问题**（已记录，未静默处理）：`special`/`holiday` 概率表权重和不足 100、
常规卡池文案 8.9% 与实际 6.3% 不符、常规商店买卡不授予卡牌、礼包不发物品、
迷宫商店 7 条增益是死数据、敌方牌组 `2-3`/`2-4` 超过组卡上限、
`3-1`…`3-4` 疑似占位数据。完整清单见 `docs/validation/P0.md` 第 6 节。

## 复现 P0

```bash
cd D:/Github/card_master_3d

# 旧数据导入与校验（只读原项目，不修改 D:\Github\card_maker）
python scripts/import-legacy-data.py
python scripts/import-legacy-data.py --check

# 素材盘点与派生纹理（默认只做切片，--all 做全部 247 张）
python scripts/prepare-assets.py
python scripts/prepare-assets.py --check
```

运行环境：Python 3.11 + Pillow 10（仅离线使用，不参与运行时）。

## 开工方式

P0 已完成。P1 从建立 Vite/React/TypeScript 工程骨架与 3D 视觉样机开始，
先验证卡牌质感（透视、厚度、翻转、阴影）与三种代表特效（火球、闪电、护盾/治疗）。
每阶段完成后记录演示截图/录像、验证结果和规则差异，再勾选任务并进入下一阶段。
