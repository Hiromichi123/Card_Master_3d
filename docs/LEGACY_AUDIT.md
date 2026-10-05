# 原项目静态核查与迁移索引

核查日期：2026-10-05。目录：`D:\Github\card_maker`。本记录来自源码/数据与项目截图；
没有启动游戏或运行测试，不能将旧文档中的 FPS 提升记录视为本次实测。

## 1. 规模与数据

| 项目 | 静态核查结果 |
| --- | --- |
| 输出目录 cards.json | 14 个，共 256 条卡牌数据 |
| 普通稀有度 | SSS、SS+、SS、S+、S、A+、A、B+、B、C+、C、D |
| 原数据库加载范围 | 12 个普通稀有度 + #elna，共 247 张 |
| #yoroi | 9 张；未在 EVENT_DIRS 加载，缺 ATK/HP/CD，留作未完成资源 |
| 元数据对应 PNG | 256 条均存在同 ID 的 PNG；存在图片不代表战斗数据完整 |
| 技能注册表/工厂 | 35 类 |
| 已加载卡的具体 trait 字符串 | 118 种，包含参数值与命名变体 |
| 注册表未直接识别 trait | 47 种，统计已排除场景实现的“飞行” |
| 已配置战役 | 三章共 12 关，第四章条目存在但 stages 为空 |
| 关键大文件 | battle_base_scene.py 2040 行；skill_effects.py 1713 行；skill_animations.py 1748 行；maze_scene.py 1501 行 |
| assets 体积 | 约 713.4 MiB；380 JPG、355 PNG、2 WebP、28 JSON |
| docs 截图 | battle_overview、gacha_menu、menu_overview、card_editor |

每个 outputs/cards.json 的数量：
#elna 13，#yoroi 9，A 24，A+ 14，B 27，B+ 14，C 38，C+ 14，D 35，
S 15，S+ 15，SS 13，SS+ 13，SSS 12。

资源目录包括 `assets/cards` 原画、`assets/outputs` 成品卡面、
`assets/bg` 分层背景、`assets/poster` 地图/入口海报、`assets/ui`、
`assets/skill`。成品卡面已由 maker.py 烘焙边框和名称，数值另在战斗 UI 绘制。

## 2. 源码到新模块的映射

| 原位置 | 已观察内容 | 新版安排 |
| --- | --- | --- |
| main.py:69 | 注册 17 种场景与延迟实例化 | app 路由/场景生命周期 |
| config.py | 全局像素尺度、窗口裁剪、Pygame 字体 | 相机适配 + CSS 布局 + 自有设置 |
| utils/card_database.py | CardData、目录加载、图片路径主键映射 | 不可变 CardDefinition + manifest |
| scenes/battle/battle_base_scene.py | 回合、槽位、战斗、动画、奖励和绘制混合 | 拆到 domain/battle、rendering、presentation、progression |
| scenes/battle/simple_battle.py | 玩家对 AI、牌组/关卡输入、开局抽牌 | BattleConfig + AI controller |
| scenes/battle/draft_battle.py | 本地双人战斗、AI 开关 | 同引擎的控制方式 |
| game/skills/skill_base.py | 触发枚举、效果链、BattleContext | 纯数据上下文与事件，取消 scene 引用 |
| game/skills/skill_registry.py | 中文 trait 正则/固定标签到工厂映射 | 构建期解析为稳定 SkillSpec |
| game/skills/skill_effects.py | 35 类技能规则，部分通过场景辅助执行 | domain/skills，效果不产生动画对象 |
| game/skills/skill_animations.py、game/card_animation.py | 2D 粒子/技能与攻击回调 | 三维模板、粒子池、时间轴 |
| game/hand_card.py、game/deck_renderer.py、utils/battle_component.py | Pygame 卡槽/手牌/卡堆与数值 | 三维布局/实体卡 + DOM HUD |
| game/card_system.py、scenes/gacha/* | 卡池抽样、单抽/十连、翻卡 | progression/gacha + 3D 展示 |
| scenes/collection.py、scenes/deck_builder_scene.py | 收藏与组卡 UI | DOM 可见列表 + 3D 详情 |
| game/chapter_config.py、scenes/map/*、data/deck/enemy_deck/single_player | 章节/关卡/奖励与敌方牌组 | stages 配置 + 地图场景 |
| utils/draft_manager.py、scenes/draft_scene.py | 28 候选，双方各选 12；临时 JSON | 内存 DraftState + BattleConfig |
| scenes/activity/maze_scene.py、floor_shop_scene.py | 第一层迷宫、强度、探索、商店和临时牌组 | runState + 内存战斗输入 |
| scenes/shop_scene.py、activity_shop_scene.py | 货币购买、每日/活动商店 | 统一经济事务服务 |
| scenes/workshop_scene.py | 五槽卡牌融合、概率展示、消耗与产出 | fusion 规则 + 三维祭坛演出 |
| utils/inventory.py、utils/deck_manager.py、ui/system_ui.py | 库存/组卡/货币分散保存 | ProfileStore + SaveRepository |
| maker.py | 原画加框/名称后生成图片 | 暂保留外部工具，结果离线导入 |

## 3. 战斗基线与实现边界

来源以 `scenes/battle/battle_base_scene.py` 为主：

- 文件开头：双方各 5 战斗槽、8 等候槽，双方基础生命 20。
- 初始化：每回合通常出 1 张，原 owner/current_turn 命名混用 player/enemy 与 player1/player2。
- simple_battle.py 初始化：默认开局各抽 3 张。
- :512 switch_turn：当前方开始新回合抽 1 张。
- :560 end_turn：出牌完成后进入战斗，减少双方准备区 CD，再部署。
- :581 update_battle_animations：按槽位攻击，固定等待时间进入 cleaning/compacting/finishing。
- :1298 execute_attack：攻击前技能、普通攻击、防御、受击后、攻击后混合动画回调。
- :1344 附近：防御者飞行而攻击者不飞行时，普通伤害转移至本体。
- skill_base.py deal_damage_to_slot：免疫阻挡技能伤害，不能笼统理解成免疫所有伤害。
- :1515 process_waiting_area：每次结束一方回合都递减双方准备区 CD。
- :1735 部署：准备区从前往后，将 CD 为零的卡放入首个空战斗槽。
- :1766 整理：保留有牌顺序向左压缩。
- :1801 死亡：按对象引用分组，避免分身重复弃牌；:1847 处理死亡技能。
- :1564 has_cards_alive：只检查手牌/准备区/战斗区，未计入剩余牌堆；新版应明确修正。
- game/skills/skill_effects.py:817 分身：多槽共享同一 CardData，意味着共享 HP 和其它可变属性。
- :858 复制：deepcopy 独立生命，场景限制每方每回合使用一次。
- 原 SkillTrigger 定义有 9 种，但枚举存在不意味着每种时机已有有效技能和调度。
  不把未使用的 ON_ATTACK/TURN_START/TURN_END 当作本轮新增机制。

新版需要固定事件顺序和命中显示节点，不沿用 0.9/1.0/0.5 秒等待作为规则同步方式。
原阻塞移动、pygame.time.delay 和动画完成回调均属于需重写的实现。

## 4. 已接入技能清单

来自 skill_registry.py 与 skill_effects.py，n 表示参数，不表示无限多种独立效果：

| 类别 | 技能族 |
| --- | --- |
| 元素 | 火球n、冰封n、闪电n、群体火球n、群体冰封n、群体闪电n |
| 牌堆/准备区 | 抽卡n、还魂n、加速n、延迟n |
| 增益/弱化 | 祝福n、群体祝福n、振奋n、群体振奋n、诅咒n |
| 防御/治疗 | 破甲n、防御n、治愈n、群体治愈n、恢复n |
| 攻击后/受击后 | 吸血n、受伤n、反击n、闪避n、狂暴 |
| 单位复制 | 分身、复制 |
| 爆破 | 炮击n、群体爆破n、爆裂 |
| 特殊 | 自毁、沉默、免疫、不死、复活 |

以上共 35 族；另外迁移战斗场景中的飞行规则。

未直接识别的 47 种 trait：

> 不屈、严霜2、传送、传送1、伤害5、傀儡、先攻、先锋、决斗、剑舞1、剑舞2、剧毒2、
> 即时、即死1、吞噬、圣盾1、地崩、对空、延时1、必杀1、拒止、操控1、斩击1、斩杀3、
> 毒雾5、治疗1、法术反弹、洞察、流血2、溅射、灭绝2、燃烧2、爆裂1、狂暴1、献祭1、献祭3、
> 群体伤害2、群体减速1、群体斩击1、群体禁飞、贯穿、远射、重伤1、闪避赋予3、隐匿、魅惑、麻痹2。

这是注册表静态匹配结果，不是对所有标签“绝对没有其它实现”的断言。
P0 仍要核查场景分支、命名歧义和说明性标签；未查明前不自动实现或自动建立别名。

## 5. 缓存与 IO 的具体改进点

| 观察 | 来源 | 重写策略 |
| --- | --- | --- |
| 基础/缩放图片全局字典，无容量边界 | utils/image_cache.py | 分级纹理 + 引用保护 + 预算/LRU |
| 收藏另有类级图片缓存，多场景各自缓存 | scenes/collection.py 等 | 一处资源管理与统一 URL |
| 抽卡 Card 构造时加载图片，load_image 又加载一次 | game/card_system.py | 单次加载、同资源共享 |
| 动画按不断变化的 width/height 缓存 Surface | game/card_system.py Card.draw | GPU transform/uniform，不缓存每帧位图 |
| 每次抽卡重新枚举图片目录 | game/card_system.py get_card_pool | 静态 manifest/卡池索引 |
| 小数概率配整数 randint(1,100) | game/card_system.py draw_single_card | 连续累计权重，保留配置意图 |
| add_cards 循环 add_card，每张保存，最后再保存 | utils/inventory.py:98 附近 | 十连与扣费同次事务 |
| 多 UI CurrencyLevelUI 各自 load/save | ui/system_ui.py、各 scenes | 单一内存 ProfileStore |
| 库存既保存 cards 列表又保存多项统计 | utils/inventory.py | 按 cardId 数量存储，统计派生 |
| 场景依赖 draft_temp/temp_deck 文件传牌组 | utils/draft_manager.py、maze_scene.py | 内存 BattleConfig，runState 单独持久化 |
| 商店扣费/售罄/授卡分多次更新 | scenes/activity/floor_shop_scene.py 等 | 原子经济操作，失败不出现半完成状态 |
| 原数据路径及打包路径策略混合 | inventory/system_ui/deck_manager | 浏览器存档与静态资源分开 |

原 docs/OPTIMIZATION_REPORT.md 的缓存优化针对 Pygame 有意义；
迁入 Three.js 应保留“复用资源”的原则，不复制逐像素尺寸 Surface 缓存。

## 6. 延期内容

- “局域网 卡组对战/任选对战”按钮目前仍调用本地 simple_battle，未形成真实联机逻辑；
  新版不应沿用该入口造成误解。
- #yoroi 的 9 张未完成卡仅保留数据记录。
- 第四章“月之都”没有 stages，本轮不扩关。
- 47 种未直接识别标签不作为默认补做需求。
- 迷宫商店有多种增益描述，须核查其购买和战斗生效路径；
  文字存在不代表生效，本轮只迁移实际完成部分。
- 不重写 Python maker 编辑器，不新增账号/网络/全角色模型依赖。

## 7. 核查方式

读取 README/config、关键战斗/技能/存档/外围模块，解析 JSON 和 Python AST，
核对输出图片是否存在，查看原 battle_overview/gacha_menu 截图。
读取操作未导入游戏模块，未触发其加载/保存副作用，也未修改原项目。
