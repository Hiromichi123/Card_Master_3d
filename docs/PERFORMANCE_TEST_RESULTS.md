# 性能优化后的单元回归记录（历史基线）

2026-10-22；仅运行单元测试、类型检查与生产构建，未启动游戏或浏览器。

**后续发布清理已完成：99个测试文件、727项测试全部通过，类型检查、生产构建和资源检查通过。以下55项是修复前记录，不代表当前状态。最终结果见 [上线准备记录](RELEASE_READINESS.md)。**

完整回归：724 项，669 项通过，55 项失败。

**最终定向检查：9/9 通过；TypeScript 类型检查通过；Vite 生产构建通过。dist/assets/surfaces 内已包含 73 张 PNG，共 13,825,303 字节。**

本轮新增的 8 项性能检查及 1 项天梯材质回归检查通过。下列完整回归失败未在本轮一并修改；列表包含过时规则/版本断言，也不能代替逐项基线归因或上线验收。

## abyssBalance.test.ts

- Abyss balance and AI tempo rewards completion irrespective of victory: true

## abyssBattleAdapter.test.ts

- 深渊战斗编译 同模板不同培养独立；双方召唤目标各自编译全体效果

## abyssBattleRules.test.ts

- 真实技能免疫与明确伤害来源 免疫根据当前对位沉默而非旧marks动态判断

## abyssCultivation.test.ts

- 深渊培养与存档 applies drawn attributes repeatedly and replaces a cultivated trait for one crystal, preserving originals
- 深渊培养与存档 saves pending paid candidates exactly, without rerolling or consuming the offer
- 深渊培养与存档 does not allow erasing innate traits or modifying a card while an offer is pending

## abyssEntrance.test.ts

- 深渊按钮屏外依次浮入 屏外起点使用视口高度而非按钮自身高度，动画由包装层负责

## abyssEntry.test.ts

- 深渊入口与结算展示 轮盘NEW在名称后，选中显示倒计时但不进入，点进入才导航
- 深渊入口与结算展示 主页独立入口和第一张海报均进入深渊，旧玩法入口保留

## abyssHome.test.ts

- 深渊大厅落稳后的第二阶段 标题独立上移和深红光晕；倒计时左靠安全区，窄屏避免占同一行

## abyssPreparationScene.test.ts

- 深渊实体选择盘面 点击加成再点击己方卡，保留其余卡并完成属性升级
- 深渊实体选择盘面 有效拖放升级；拖出盘面或取消不消耗奖励
- 深渊实体选择盘面 覆盖特性先提示；取消不扣资源，确认仅扣一枚结晶
- 深渊实体选择盘面 下一局先淡出整备，再显示普通到困难的实际关卡，标题结束才开放三组接受按钮

## abyssRecruitment.test.ts

- Abyss recruits, endless and permanent leaderboard records opens settlement after 3-10, permits endless camp settlement, and preserves best results beyond ten histories

## abyssRewards.test.ts

- 深渊永久奖励与独立周账本 第一个节点原子发钱，候选五张平均C；刷新后手选五选三只入库一次
- 深渊永久奖励与独立周账本 中途放弃取最近通过节点，低于1-10没有奖励；Boss失败也取上个节点
- 深渊永久奖励与独立周账本 通关结算每周两轮，额度用尽仍可结束；新周重新获得额度
- 深渊永久奖励与独立周账本 进入无尽立即第三档结算；同轮继续与退出不重复支付
- 深渊永久奖励与独立周账本 本周抵达9-10可累计五档，领取不改变通关奖励次数，指定卡跨新周重置
- 深渊永久奖励与独立周账本 篡改奖励金额、额外库存和选择记录都不能混入普通深渊事务

## abyssScene.test.ts

- 深渊入场 图片失败立即可返回，卸载清理所有倒计时

## abyssVortexScene.test.ts

- 深渊云雾装饰声明 动态仅前台运行，系统偏好不参与，still/非active使用按需帧，预算读取设置
- 深渊云雾装饰声明 ready只减弱基础层且保持四层运动，后续失败恢复强度并撤Canvas
- 深渊云雾装饰声明 实际useFrame推进GPU uniform，静止/后台冻结，恢复仅累加新帧

## abyssWorld.test.ts

- 深渊背景沿用普通鼠标阻尼 底图和云雾同一平移容器，暗角留在容器外，扩边56px覆盖50px位移

## backgroundMusic.test.ts

- 背景音乐 曲目为本地文件，来源和实际字节数对应，版权不冒充CC0

## battleEngine.test.ts

- 建局 开局各抽 3 张，其余在牌堆里
- 命令校验 不是当前方就不能行动
- 命令校验 出牌会进入准备区并消耗本回合额度
- 冷却与部署 CD 归零的卡进入**第一个**空战斗槽
- 攻击 对位空槽时攻击打到本体
- 攻击 免疫挡技能伤害，但**不挡普通攻击**
- 技能规则 加速把自己最左占用准备槽的 CD 减 n
- 技能规则 爆裂在死亡时对对位造成固定 2 点
- 分身共享与复制独立 分身加入同一个状态组，复制另起一组
- 分身共享与复制独立 分身受伤，同组的所有位置一起掉血

## campaignWorldGeometry.test.ts

- 碎片大陆、南端群岛与古海要塞布局 南端群岛包含魔域毒雾岛，2-1 旗标落在真实岛面而非海床
- 碎片大陆、南端群岛与古海要塞布局 24 栋房屋确定性生成，屋顶不越墙，街巷与建筑不重叠
- 碎片大陆、南端群岛与古海要塞布局 房屋与门窗屋顶共享朝向，且按最终模型坐标贴地

## deckEditorScene.test.ts

- 四套卡组配置 页内导航保存失败留在配置、保留草稿，重试成功后可以进入天梯

## deckSlots.test.ts

- 四槽卡组与天梯存档 原生往返保存真实积分与映射，坏槽位不偷偷重建

## demonLayout.test.ts

- 魔域海报地形与独立关卡布局 低画质深渊局部细分的水平边长不超过 .18，实际顶点不穿底座

## displayState.test.ts

- 显示状态 开局与权威状态一致：各抽 3 张、场上为空、本体满血
- 显示状态 推进一次结算之后，显示状态与权威状态一致
- 整局推进 每一手之后显示状态都与权威状态一致
- 整局推进 整局不会冒出处理不了的事件类型

## fusionScene.test.ts

- exposes fusion, keeps lobby Draft and maze entries hidden and restores local battle selection

## ladderRewardSave.test.ts

- schema5天梯领奖账本 v4只补空账本，保留积分、卡组映射、其他奖励/迷宫记录，反复迁移幂等

## mazeLayout.test.ts

- 迷宫版面：节点外观与坐标 节点透明度与旧版 `node_type_styles` 的各档一致

## progression.test.ts

- 商店 探索货架恰好 5 格，且允许重复
- 领域层不得依赖时间与随机 src/domain/progression 下没有 Math.random / new Date / Date.now

## saveTransfer.test.ts

- ProfileStore 导入导出 导出 → 导入 → 再导出的文本逐字节相同

## skillVfx.test.ts

- bounded skill geometry lifecycle reclaims geometry actors on completion and skip while firing one group callback

## tableThemes.test.ts

- 战斗台面主题 八套可选台面，且 id 唯一

