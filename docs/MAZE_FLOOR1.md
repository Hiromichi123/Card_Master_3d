# 迷宫第一层（P6 的一段）

日期：2026-10-06。来源：`D:\Github\card_maker\scenes\activity\maze_scene.py`（只作设计参考，不复制代码）。
施工分四步：`迷宫（1/6）生成规则与强度经济` → `（2/6）runState 的持久化通道` → （3/6）地图场景与走格子 →
（4/6）开战、结算与楼层商店。

## 1. 做了什么

| 层 | 文件 | 内容 |
| --- | --- | --- |
| 规则 | `src/domain/progression/maze.ts` | 生成（随机游走 + 6 次重试保证 Boss ≥ 5 步）、连接清洗、探索、强度经济（`1.0 × (1+探索度×0.6) × 类型倍率 × U(0.9,1.2)`）、奖励、楼层货架、战斗 id 语义 |
| 拼装 | `src/scenes/mazeFlow.ts` | `planMazeLaunch` / `mazeSettlementFor` / `planMazeSettlement` / `mazeShopStock` / `planMazePurchase` |
| 版面 | `src/scenes/mazeLayout.ts` | 格距 375 / 边长 225、倾斜 58°、透视 6000、厚度 34、取景点 (1440, 810)，以及**投影数学**（`projectRel` / `projectToScreen`） |
| 场景 | `src/scenes/MazeScene.tsx` | 倾斜地图、走格子、详情栏、楼层商店、`#elna` 卡展示位、图例与按钮 |
| 接线 | `src/app/App.tsx`、`src/app/routes.ts`、`src/scenes/ActivityScene.tsx` | `maze` 路由（活动大厅第一张卡进）、与战役分流的结算、打完成回地图 |

一局的地图由 `mazeRngFor('floor1', version)` 生成，**同种子必然同一张图**；`version` 就是「第几次开」，
「清空探索记录」把它 +1（换图、重来）。第 1 轮的实测形状：56 个节点（普通 40 / 补给 10 / 精英 4 /
入口 1 / Boss 1），Boss 距入口 12 步。

## 2. 与旧版有意不同的地方（每条都有理由）

1. **平面是斜的、方块是真立体**。旧版是正对屏幕 + 假前脸（`tile_front` 梯形）。
   清单要求「倾斜节点场景」，这里改用 CSS 3D：`perspective: 6000` + `rotateX(58deg)`，
   方片 = 抬到 `z = 34` 的顶面 + 南沿转 90° 的立面。
   代价：节点名字与玩家光球在**独立的屏幕空间层**，位置由 JS 现算
   （`projectToScreen`，与 CSS 同一套矩阵），所以这两层能严格贴合；
   单测用「取景点恒落在取景点 / 南北缩放比 / 离面抬升」三项钉住这件事。
2. **不复现旧版「连线冻结」的 bug**。旧版把连线画进整屏缓存位图、只在换图时置脏，
   于是走动时节点在动、连线不动。这里连线是平面内的 SVG，跟 `transform` 一起走。
3. **不复现 `UI_SCALE` 被乘两次**（旧版 `BASE_TILE_SIZE` 与 `tile_size` 各乘一次，
   窗口一大格子就平方级变大）。这里只有一个 `--ui`。
4. **不写 `temp_deck.json`**。敌牌组现生成、直接进内存，随机流由 `attemptKey` 派生，
   所以「预览」与「实战」不会各掷一次，同一局重算也得到同一副牌。
5. **Boss 只能通关一次**是结构性的：胜利的 `battleId` 稳定（`maze:floor1:v1:boss`），
   第二次提交会被 `settledBattleIds` 判成 `alreadySettled`，一分钱不发。
   **败北另用一条每次不同的 id**（`mazeBossLossBattleId`）——否则第二次挑战 Boss
   连失败经验都拿不到（这是接这套管线时发现并修掉的）。
   随机流不跟着稳定：Boss 每次重试的敌牌与种子都不同。
6. **迷宫不碰战役进度**：结算事务里没有 `clearStageId`，单测直接断言这一点。
7. **楼层商店是同一屏的右侧面板**（旧版是另开一块 `floor_shop` 屏），
   售罄落 `mazeRun.shopByNode[nodeId].soldOut`——那一轮过期即失效，
   不写全局的每日货架。

## 3. 验证

- `npm run typecheck`：通过。
- 单测：`tests/unit/mazeLayout.test.ts`（13）与 `tests/unit/mazeFlow.test.ts`（16）全过；
  相关的既有用例 `maze.test.ts`（23）、`progression.test.ts`（44）、`saveStore.test.ts` 也全过（合计 83）。
- 浏览器：`tests/browser/maze.spec.ts` 5 条，**5 passed / 16.4s**——
  进入地图（56 个方块、图例五项、初始 run 落盘）、走一格（两次点击确认 → 位置与探索集落盘 → 刷新回位）、
  补给节点开货架（买入扣 587 金币、售罄落在这个节点、每日货架不动）、
  战斗节点开打（跳过 + 自动演示 → 结算落盘 → 「返回地图」回地图屏）、清空探索记录（version + 1）。
  数值一律读 IndexedDB 的落盘值。

## 4. 没验到的（如实记）

- **没有截图、没有人工试玩**：倾斜平面的观感（倾角、厚度、配色）只在数学上验证过对齐，
  没有像素级核对；标签若与别处的方块重叠，目前只能靠投影排序（`zIndex` 跟纵深走）压住，
  没有实测。
- **性能未测**：这一屏是 DOM/CSS 3D（不是 WebGL），没有 draw call 数字；
  56 个带 `preserve-3d` 的方块在低端机上是否掉帧没有测。
- 活动增益条目（旧版「活动增益」那一套）没有迁移——不在本轮范围。
- 只有第一层，没有「下一层」；Boss 胜利后的文案是「已通关」，不会生成第二层地图。
- 楼层商店的活动位收水晶，演示存档开局没有水晶，所以界面上它会一直买不起（数据如此，不是缺陷）。

## 5. 并发施工说明

本轮的施工与另一个会话（融合 / 工坊，P6 的另一段）**同时**改动了 `App.tsx`、`routes.ts`、
`ActivityScene.tsx`。这三处的改动是叠加的：迷宫只加了自己的路由分支、结算分流与活动大厅第一张卡；
`App.tsx` 里那行 `ROUTES.filter((item) => !['maze', 'draft'].includes(item.id))` 与 `fusion` 那条路由
是另一个会话写的，保留原样。提交前如果这些文件还在被别人改，以工作区为准。
