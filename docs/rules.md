# 规则基线与新旧差异

日期：2026-10-05。对应施工清单 P0-10「定义并记录双方 CD、部署顺序、攻击/防御触发、死亡处理、
复制体攻击、同时死亡、耗尽/平局规则」与 P0-11「明确允许改动的规则」。

**证据强度**：本文件的内容来自对旧项目源码的**静态阅读**，没有启动旧游戏、没有运行旧测试。
每一条判断都带 `file:line` 引用，便于 P2 用固定样例逐条复核。凡是静态阅读无法确定的，
写进第 12 节「待 P2 复核」，不写成结论。

引用简写：

| 简写 | 文件 |
| --- | --- |
| `BBS` | `scenes/battle/battle_base_scene.py`（2040 行） |
| `SB` | `scenes/battle/simple_battle.py` |
| `DB` | `scenes/battle/draft_battle.py` |
| `SKB` | `game/skills/skill_base.py` |
| `SKE` | `game/skills/skill_effects.py` |
| `CMP` | `utils/battle_component.py` |
| `HAND` | `game/hand_card.py` |
| `DBM` | `utils/deck_manager.py` |

---

## 1. 基线常量

| 项 | 值 | 来源 |
| --- | --- | --- |
| 每方战斗槽 | 5 | `BBS:44` |
| 每方准备区（等候）槽 | 8 | `BBS:45` |
| 双方基础生命 | 20 | `BBS:64-67` |
| 开局各抽 | 3 张 | `SB:134-141` |
| 当前方新回合抽 | 1 张 | `BBS:527-529` |
| 每回合可出牌 | 1 张 | `BBS:168`，`BBS:649-656` 校验 |
| 组卡上限 | 12 | `DBM:7` |
| 手牌上限 | 无 | `HAND:188`，无上限逻辑 |

组卡上限只由组卡界面强制（`DBM:27-29`），战斗只读 JSON 里的实际张数（`SB:159-191`）。
新版把上限作为存档层约束，战斗接受 `BattleConfig` 传入的牌组。

`turn_number` 在 1 起步，**仅在控制权回到 `player1` 时 +1**（`BBS:519`），
即一个「回合数」等于一整轮。

---

## 2. 回合流程（精确顺序）

### 2.1 结束回合 `end_turn`（`BBS:560-579`）

1. 若 `turn_phase != "playing"` 直接返回（`BBS:562-564`）。
2. 若本回合出牌数未达上限则返回——**必须先出一张牌才能结束回合**（`BBS:566-568`）。
3. 切到战斗阶段：`turn_phase="battling"`、`battle_phase="attacking"`、
   `current_attack_index=0`、`battle_timer=0`（`BBS:570-573`）。
4. `check_game_over()`；若已结束则返回，战斗阶段不执行（`BBS:575-576`）。
5. `process_waiting_area()`：**双方**准备区 CD 各 −1（`BBS:578` → `BBS:1515-1519`）。
6. `move_ready_cards_to_battle()`：双方 CD 归零的卡进入战斗槽（`BBS:579` → `BBS:1719-1764`）。

关键点：**当前方在这一系列步骤中保持不变**；`switch_turn` 只在战斗序列最末尾调用。
因此第 6 步刚部署上场的卡**同一次战斗阶段就会攻击**（攻击列表在 `update_battle_animations`
里重新读取，`BBS:587-594`）。

### 2.2 战斗序列 `update_battle_animations`（`BBS:581-645`）

由 `battle_timer` 累加驱动：

| 子阶段 | 等待 | 动作 | 来源 |
| --- | --- | --- | --- |
| `attacking` | 每 0.9 s 一次 | 按当前方战斗槽从左到右，跳过空槽，逐个 `execute_attack` | `BBS:596-620` |
| `cleaning` | 1.0 s | `remove_dead_cards()` | `BBS:622-628` |
| `compacting` | 0.5 s | `adjust_battle_slots()` | `BBS:630-636` |
| `finishing` | 0.6 s | `battle_phase="idle"`，`check_game_over()`，否则 `switch_turn()` | `BBS:638-645` |

### 2.3 切换回合 `switch_turn`（`BBS:512-531`）

1. 翻转 `current_turn`；回到 `player1` 时 `turn_number += 1`（`BBS:514-520`）。
   调用 `_advance_owner_turn(owner)` 推进 owner 级回合标记并重置「复制」的每回合标记（`BBS:533-540`）。
2. `turn_phase="playing"`、`cards_played_this_turn=0`、`auto_timer=0`（`BBS:523-525`）。
3. 为新的当前方抽 1 张（`BBS:527-529`）。
4. 启动回合指示动画（`BBS:530`）。
5. `_auto_skip_turn_if_no_space()`：若战斗区和准备区**同时**满，直接强制结束回合（`BBS:531` → `BBS:674-683`）。

`SB:145-156` 覆盖了 `switch_turn`：新当前方手牌为空时，强制结束回合，
中间还有 `pygame.time.delay(500)` 阻塞 0.5 秒。

### 2.4 出牌 `play_card_to_waiting`（`BBS:1581-1629`）

1. `can_play_card()` 校验（`BBS:1584-1586`）。
2. 按 `current_turn` 选择本方准备区（`BBS:1589-1598`）。
3. 该方两个区都满 → 自动跳过回合（`BBS:1600-1603`）。
4. 取**从左到右第一个空准备槽**（`BBS:1606-1610`）。
5. 阻塞移动动画 0.3 s（`BBS:1616-1621`）。
6. `target_slot.set_card(card)`，从手牌移除，`cards_played_this_turn += 1`（`BBS:1623-1625`）。

**此步不触发 `ON_DEPLOY`**：上场技能只在准备区→战斗区时触发。

### 2.5 每帧更新顺序（`BBS:228-265`）

`_update_safe_area` → 若 `game_over` 立即返回 → `super().update` → 回合指示动画 →
生命条 → 全部槽位动画 → 双方手牌 → 重建 `battle_animations`（`BBS:255`）→
若处于 `battling` 则执行 `update_battle_animations` 并**提前返回**（`BBS:256-258`）→
否则处理抽牌队列（`BBS:261-265`）。

抽牌队列是墙钟时间表（`draw_timer` 累加，绝对时间点 0.5/0.8/1.1…），
`battling` 期间抽牌被整体跳过。

---

## 3. CD 语义

1. CD 存在**槽位**上而非卡牌对象上：`CardSlot.cd_remaining`（`CMP:26`）。
2. CD 只在 `slot_type == "waiting"` 时于 `set_card` 重置为 `card.cd`（`CMP:49-50`）。
   战斗槽不读取 `cd_remaining`（`CMP:104` 有 `slot_type == "waiting"` 门控）。
   **后果**：卡牌任何一次进入准备区都会重新套用原始 CD，包括「复活」回到准备区。
3. **每个 `end_turn` 递减双方准备区 CD 一次**（`BBS:1517`：遍历
   `player_waiting_slots + enemy_waiting_slots`）。不是每方各自回合，不由 `switch_turn` 驱动。
   卡牌的 CD 在**任何一方**结束回合时都会减少。
4. `reduce_cd` 在 0 处截断并返回 `cd_remaining == 0`，返回值被丢弃（`CMP:102-107`、`BBS:1519`）。
5. CD=0 → 同一次 `end_turn` 内、递减之后立刻部署（`BBS:579`）。
6. **部署目标是第一个空战斗槽（从左到右）**（`BBS:1740-1744`）。
   新部署的卡会填最左边的空位，可能落在已部署卡的**左边**，从而改变本次战斗阶段从左到右的攻击顺序。
   槽位没有配对记忆，位置完全是下标。
7. 准备区按从左到右遍历（`BBS:1737`）：两张卡同时就绪时，靠左的准备区卡拿靠左的战斗空位。
8. 每次部署调用 `_trigger_on_deploy(target_battle_slot, owner)`（`BBS:1764`）。
9. 时序后果：`cd = 0` 的卡在**被打出的那次 `end_turn`** 就部署；`cd = 1` 在**下一次**
   `end_turn` 部署。每点 CD 等于一次任意方的 `end_turn`。
10. 卡牌效果可以改动 CD：加速n 减少本方**第一个占用中的**准备槽（`SKE:1227-1257`，
    `BBS:1290-1296`）；延迟n 增加对手第一个占用中的准备槽（`SKE:1259-1290`，`CMP:109-114`，下限 0）。
    两者都是 `BEFORE_ATTACK`，在战斗阶段中途生效，效果要到下一次 `end_turn` 才体现在部署上。
11. `CardSlot.remove_card` 把 `cd_remaining` 归零（`CMP:95`），离开准备区的卡不会留下旧 CD。

新版按 `CardInstance.cd` 建模（每张实例各自持有），保持第 3、5、6、7 条语义。

---

## 4. 攻击结算

入口 `execute_attack(attacker_slot, defender_slot, defender_hp_ref)`（`BBS:1298-1513`）。

### 4.1 顺序与目标

- 从左到右下标 0→4，每 0.9 s 发起一个（`BBS:602-615`）。
- **目标 = 对位同下标的槽位**（`BBS:609`）。不搜索最近的存活对手；
  对位是空的就打本体生命（见 4.4）。
- 攻守双方由**列表成员判断**得出，不是读槽位自带的 `owner` 字段
  （`BBS:1309, 1313, 1381, 1414`）。
- 对位无卡时 `context.defender_owner` 被设为 hp ref 字符串（`BBS:1317`）。

### 4.2 两段式执行

1. **攻击者沉默门控**：`is_slot_silenced(attacker_slot)` 为真则 `skills = []`，
   该攻击者的**所有**触发点技能都不再触发（`BBS:1321-1324`）。
2. **阶段 A（`BEFORE_ATTACK`）**：每个技能遍历其 `BEFORE_ATTACK` 效果。
   返回动画的效果注册 `anim.on_hit = lambda: effect.execute(context)` 后 `break`
   ——**每个技能只使用第一个带动画的效果**；没有动画的效果立即同步执行。
   只有**最后一个**技能动画的 `on_complete` 接上 `execute_normal_attack`（`BBS:1482-1513`）。
3. **阶段 B（普通攻击）**：`context.reset_attack_result()` 后构造
   `AttackAnimation(on_complete=resolve_damage)`，**全部普通伤害在动画结束时结算**（`BBS:1327-1480`）。

### 4.3 `resolve_damage` 分支（`BBS:1331-1475`）

开头守卫：动画结束时攻击者槽位已空/已死则整个攻击**静默取消**（`BBS:1332-1336`）。

**分支 A：对位有卡**（`BBS:1339-1439`）

先判飞行（`BBS:1344-1347`，直接读 `traits` 列表）：

- **A1 地对空免疫**（`BBS:1347-1368`）：攻击**无法伤害飞行卡**，改为把攻击者的原始
  `atk` 打到**飞行卡所属方**的本体生命上。此路径**绕过** `context.damage_amount`，
  因此防御/闪避/破甲都不生效，攻击者的破甲也被浪费；同样绕过免疫。
  反向不成立：飞行攻击者打地面防御者走正常卡对卡流程。
- **A2 正常卡对卡**（`BBS:1369-1439`）：
  1. `base_damage = attacker_card.atk`，写入 `context.damage_amount`（`BBS:1371, 1378`）。
  2. 防御者沉默门控（`BBS:1374-1377`）。
  3. **角色互换**：`context.set_attacker(context.defender_slot, defender_owner)`
     ——执行 `ON_DAMAGED` 期间，`attacker_slot/attacker_owner` 指的是**防御者**（`BBS:1381-1384`）。
  4. 依次执行 `ON_DAMAGED` 效果，逐个改写 `context.damage_amount`（`BBS:1387-1399`）。
     防御n 为 `max(0, damage - max(0, reduction - armor_break))` 并消耗破甲量（`SKE:335-356`）；
     闪避n 概率 `0.9 - 0.6 * 0.5**(level-1)`，成功则伤害置 0（`SKE:683-708`）。
     **免疫不是 `ON_DAMAGED` 效果**，只在 `deal_damage_to_slot` 里硬编码（见 4.5）。
  5. 恢复攻击者上下文（`BBS:1402`）。
  6. **伤害直接写 `card.hp`，不走 `deal_damage_to_slot`**（`BBS:1404-1411`）。
  7. 记录 `set_attack_result`、`last_damage_taken`、`last_attacker_slot/owner`（`BBS:1415-1424`）。
  8. **`AFTER_DAMAGED`（反击）仅在 `actual_damage > 0` 时触发**（`BBS:1427-1439`），
     此时 again 把 attacker 上下文临时换成防御者。

**分支 B：对位空**（`BBS:1440-1459`）：按 `attacker_card.atk` 平摊打到本体生命条，
不做任何技能判定，也不读 `context.defender_owner`（读的是入参 `defender_hp_ref`）。

**两支之后**都执行 `AFTER_ATTACK`（`BBS:1461-1471`，受攻击者沉默门控约束）。
`finally` 清理破甲量与当前攻击动画引用（`BBS:1472-1475`）。

### 4.4 打本体生命的路径

两条独立代码路径，都不调用共享 helper：

1. 对位空槽（`BBS:1440-1459`）——固定 `atk`。
2. 飞行防御者 vs 非飞行攻击者（`BBS:1347-1368`）——固定 `atk`，重定向。

`BattleContext.deal_damage_to_player`（`SKB:188-197`）存在但**全项目无人调用**，是死代码。

### 4.5 免疫语义

`"免疫"` 只在 `BattleContext.deal_damage_to_slot` 内检查（`SKB:166-186`）。因此免疫能挡：

- 所有经 `deal_damage_to_slot` 的技能伤害（火球/冰封/闪电/群体版本/炮击/群体爆破/爆裂）
- 反击伤害（`SKE:673-681` 走到该 helper）

免疫**不能挡**：普通卡对卡攻击（直接写 `card.hp`）、飞行重定向到本体的伤害、
自毁（`SKE:1314` 直接 `hp = 0`）、受伤、狂暴、任何 ATK 改动。
`ImmunityEffect.execute` 返回 `False`，纯声明式（`SKE:1388-1398`）。

新版必须保留「免疫挡技能伤害、不挡普通攻击」这条边界（PLAN 第 4.3 节明确要求）。

### 4.6 沉默

`is_slot_silenced(slot)`（`BBS:1280-1288`）在**对位槽位当前占用者**带 `"沉默"` 时为真，
每次使用时实时求值，因此依赖行对齐（`adjust_battle_slots` 压缩后可能变化）。
应用点：攻击者技能门控 `BBS:1321`、防御者门控 `BBS:1374`、`_trigger_on_deploy` `BBS:1945`。
**未**应用于 `_handle_post_death_traits`（`BBS:1847-1887`）——被沉默的卡照样触发死亡系技能。

---

## 5. 技能触发点

`SkillTrigger`（`SKB:5-15`）声明 9 个值；实际派发 6 个：

| 触发点 | 是否派发 | 调用点 |
| --- | --- | --- |
| `BEFORE_ATTACK` | 是 | `BBS:1485` |
| `ON_DAMAGED` | 是 | `BBS:1389` |
| `AFTER_DAMAGED` | 是 | `BBS:1430`（仅 `actual_damage > 0`） |
| `AFTER_ATTACK` | 是 | `BBS:1463` |
| `ON_DEPLOY` | 是 | `BBS:1958`（仅准备区→战斗区） |
| `ON_DEATH` | 是 | `BBS:1870` |
| `ON_ATTACK` | **否** | 只声明于 `SKB:7`，全项目无派发 |
| `TURN_START` | **否** | 只声明于 `SKB:14` |
| `TURN_END` | **否** | 只声明于 `SKB:15` |

PLAN 第 4.3 节要求：声明了枚举不等于有有效机制。新版**不**为这三个未派发触发点新增机制。

另外 `Skill.execute_trigger`（`SKB:65-80`）从未被调用；`SkillEffect.animation_duration`
（`SKB:35`）被赋值但从未读取。

---

## 6. 死亡与清理

`remove_dead_cards`（`BBS:1801-1845`）：

1. 只从**战斗区**收集 `hp <= 0` 的卡（`BBS:1822-1823`）。
2. **按对象标识分组**：`key = id(slot.card_data)`（`BBS:1809-1820`）。
   这是为「分身」准备的——分身多个槽位引用**同一个 `CardData` 对象**
   （`SKE:851` 直接 `set_card(slot.card_data)`，不复制）。
   因此一个分身死亡会让整组同时死亡，整组只处理一次（一次弃牌、一次死亡技能）。
3. 每组播放**阻塞**淡出动画到弃牌堆（0.5 s，`BBS:1829-1834`），移除主槽与全部
   `linked_slots`（`BBS:1836-1842`），加入弃牌堆（`BBS:1844`）。
4. 入弃牌堆时 `_reset_card_state` 把 `hp` 恢复为 `max_hp`（`BBS:1185-1190`）。
   弃牌堆里的卡永远满血，不携带「已死」状态。
5. `_handle_post_death_traits(card_data, owner, slot)`（`BBS:1845` → `BBS:1847-1887`）：
   遍历 death 卡的 trait，取 `ON_DEATH` 效果执行；只有**爆裂**声明 `ON_DEATH`
   （`SKE:1013-1046`），伤害从**主槽的对位**打出，只炸主槽位置。
   随后在触发循环**之外**判断 `"不死"`（`BBS:1883` → 回手牌）与
   `"复活"`（`BBS:1884` → 回准备区）。

死亡系规则的边界：

- **不死**（`BBS:1905-1916`）要求卡确实在弃牌堆里，之后回手牌，可以再次抽到再打出，
  **没有一次性标记**，理论上可无限循环。
- **复活**（`BBS:1918-1940`）用 `card_data._revive_consumed` 做**一次性**限制，
  且需要有空准备槽，否则静默返回（卡留在弃牌堆）。
- **自毁**（`SKE:1292-1325`）完全绕过 `remove_dead_cards`：自己置 0 血、
  播自己的淡出动画、移除主槽、清掉重复链接（`BBS:1897-1903`）、入弃牌堆、
  自己调用 `_handle_post_death_traits`。它是 `BEFORE_ATTACK` 效果，
  所以自毁的攻击者随后那次普通攻击会命中 `BBS:1332` 守卫并干净中止。
- **连锁爆炸不是一次递归**：爆裂立即造成伤害，但受害者的 `ON_DEATH` 要等
  **下一次** `remove_dead_cards`（下一个 `cleaning` 阶段）才处理。
  没有显式递归保护，因为没有递归。

---

## 7. 胜负与平局

`has_cards_alive(who)`（`BBS:1564-1579`）只数三个区：
`hand`、`waiting`、`battle`。**不计入牌堆与弃牌堆**。

`check_game_over`（`BBS:336-350`）：

```python
if player_hp <= 0 or not player_has_cards:   -> _end_battle("player2")
elif enemy_hp <= 0 or not enemy_has_cards:   -> _end_battle("player1")
```

- **玩家失败优先**：同归于尽判定为玩家失败。
- 只在两处调用：`end_turn`（`BBS:575`，在 CD/部署/攻击**之前**）与 `finishing`（`BBS:644`）。
  不在 `resolve_damage`、不在 `remove_dead_cards`。
- 因此 HP 可能在战斗阶段剩余时间里一直 ≤0，要到 `finishing` 才登记失败。
- `_end_battle`（`BBS:475-500`）由 `game_over` 守卫保证幂等；`winner == "player1"` 才算胜利（`BBS:480`）。
- 结束后 `update()` 立即返回（`BBS:230-231`），战斗阶段停在当时状态，不再有回合。

原版**没有平局**。PLAN 第 4.2 节要求新版在「循环但无法分出胜负」时通过状态重复或回合上限
产生明确平局，且平局不发胜利奖励。

---

## 8. 命名空间混乱（`player`/`enemy` vs `player1`/`player2`）

三套标识并存，约 10 处手工转换：

- 回合标识 `current_turn ∈ {"player1","player2"}`（`BBS:164`）：`player1` = 人类。
- 归属标识 `{"player","enemy"}`：槽位（`CMP:18`）、手牌、牌堆、弃牌堆、全部
  `BattleContext` 与效果的 owner 参数。
- 胜者标识 `winner ∈ {"player1","player2"}`（`BBS:345, 348`）。

已知的具体缺陷：

1. **`defender_hp_ref` 混淆了回合与归属**：`BBS:590/594` 传的是 `"enemy"|"player"`，
   到 `BBS:1317` 存成 `context.defender_owner`，`BBS:1443` 又按字符串比较。
2. **`_end_battle("player2")` 的语义是「敌人获胜」**（`BBS:345`），该值随后被当作
   `winner` 使用（`BBS:477-480`）。
3. **`_resolve_owner` 静默兜底为 `"enemy"`**：当 `attacker_slot` 为 `None` 时，
   归属判断落到 else 分支，效果会给**错误的一方**加血/加 buff/抽卡
   （`SKE:827-832, 868-873, 1170, 1205, 1240, 1272, 1304, 1458, 1561`）。无 `None` 守卫。
4. **`_move_cards_from_waiting_to_battle` 用中文显示串判归属**：
   `owner = 'player' if owner_name == '玩家' else 'enemy'`（`BBS:1763`）。
5. 归属在 `resolve_damage` 内被重复推导四次（`BBS:1351, 1381, 1414`、`1309, 1313`），
   而 `CardSlot.owner`（`CMP:18`）从未被逻辑读取。
6. `context.defender_owner` 只在空槽分支偶然正确；`deal_damage_to_player` 若被接上，
   会因 `ON_DAMAGED` 角色互换而给错误一方扣血。
7. `owner_turn_markers` / `copy_usage_state` 以 `{"player","enemy"}` 为键
   （`BBS:169-174`），与 `turn_number` 无关联。

新版统一为 `SideId = "player" | "enemy"`（见 `src/domain/cards/types.ts`），
回合归属由 `BattleState.currentSide` 表达，不再有第二套词汇。

---

## 9. 动画即逻辑：必须移除的竞态

**A. 伤害由动画完成回调交付**

1. `BBS:1478`：普通攻击的全部伤害在动画结束时于 `resolve_damage` 内结算。
2. `BBS:1504-1510`：只有**最后一个**技能动画的 `on_complete` 接普通攻击，
   普通攻击被推迟到所有技能动画结束；而 0.9 s 的攻击节奏照常推进。
   技能动画一旦超过 0.9 s，**上一次攻击的伤害可能在下一次攻击发起之后才落地**。
3. `BBS:1491-1497`：技能伤害在动画命中帧应用。
4. `SKE:673-681`：反击伤害只在 `CounterAttackAnimation` 完成时应用。
5. 上述闭包捕获的是攻击时刻的 `BattleContext`；唯一的陈旧守卫是 `BBS:1332-1336`，
   且只检查攻击者。

**B. 阶段推进由墙钟计时器驱动**

6. `BBS:597-599` 攻击节奏；7. `BBS:617-620` `attacking→cleaning`；
8. `BBS:622-628` `cleaning`；9. `BBS:630-636` `compacting`；
10. `BBS:638-645` `finishing` ——**整个回合交接是计时器回调**。
11. `BBS:261-265` 抽牌队列是绝对时间表。
12. `SB:54-67` / `DB:31-44` AI 由 `auto_timer` 驱动，AI 节奏受帧率影响。

**C. 逻辑内部的阻塞睡眠 / 忙等渲染循环**

13. `BBS:1632-1669` `play_blocking_move_animation`：`while True` + `clock.tick` + `draw()`，
    调用方全部被阻塞。调用者：`BBS:1616`、`1753`、`1915`、`1938`、`1216`。
14. `BBS:1670-1703` `play_blocking_fade_move_animation`：`BBS:1829`（死亡）、`SKE:1318`（自毁）。
15. `SB:153` / `DB:157`：`pygame.time.delay(500)`，新当前方空手时冻结主循环 0.5 s。
16. `ANI:190-206` `SlideAnimation` 每帧修改 `slot.rect`，完成时才吸附到目标；
    槽位 `rect` 在动画期间是错的，而 HP 条目标位置依赖它。

**D. 上述造成的重入**

17. `BBS:644-645` 在 `update_battle_animations` 内部调用 `switch_turn` →
    `SB:150-154` → `end_turn()` → 再次进入战斗阶段。
18. `BBS:531` `_auto_skip_turn_if_no_space` → 在 `switch_turn` 内部调 `end_turn()`。
19. `BBS:255` 在遍历动画列表时重建该列表，而 `a.update(dt)` 可以同步追加新动画到同一列表，
    同帧内新增项会被本次迭代访问到，帧内更新顺序依赖数据。

**新版做法**：规则层一次算完整个行动的 `Resolution`（events + patches + finalState），
演出层按事件顺序播放并在命中节点应用 display patch。删除全部 `sleep`/`delay` 与
阻塞循环；`跳过动画不漏结算` 由「跳过即应用剩余 patch」保证。

---

## 10. 允许改动的规则（差异记录）

每条都标注：**是否可能改变对局结果**。可能改变结果的必须在 P2 用固定样例核对并记录。

| # | 差异 | 理由 | 是否改变结果 |
| --- | --- | --- | --- |
| D1 | 移除动画回调决定伤害与时序；规则按固定顺序一次算完 | 消除第 9 节的竞态 | 是（原版结果依赖帧率与动画时长） |
| D2 | 胜负检查计入**牌堆**；`has_cards_alive` 不再漏算剩余牌堆 | 原版 `BBS:1564-1579` 只数手牌/准备区/战斗区 | 是（原版会提前判负） |
| D3 | 新增明确平局：状态重复或回合上限；平局不发胜利奖励 | 原版无平局，可能无限循环 | 是（新增终局分支） |
| D4 | 同时死亡改为对称判定，双方同时 ≤0 判平局，不再固定玩家失败 | 原版 `BBS:336-350` 玩家失败优先 | 是 |
| D5 | 移除 `SB:119-131` 的重复洗牌与从未被消费的 `_player_draw_pile` | 死代码，渲染计数与真实牌堆脱节 | 否（洗牌次数不同会改变牌序，故仍按同一牌堆实现） |
| D6 | 归属判定不再静默兜底 `"enemy"`，`attacker_slot` 为 `None` 时显式报错 | `_resolve_owner` 的静默错误会加错一方 | 是（修掉的是错误行为） |
| D7 | 移除按中文显示串判归属（`BBS:1763`） | 字符串比较不是可靠的身份来源 | 否 |
| D8 | 移除 `pygame.time.delay(500)` 与全部阻塞动画循环 | 阻塞主循环与重入 | 否（只影响节奏，不影响数值） |
| D9 | CD 建模在卡实例上而不是槽位上 | 槽位是表现概念，实例才是规则主体 | 否（保持第 3 节语义） |
| D10 | 一个行动内已死亡单位不再发起新行动 | 原版靠动画回调时序，可能让已死单位完成后续动作 | 是（收紧边界） |
| D11 | 死亡链在明确边界处理，不依赖 `id()` 分组 | `id()` 分组在 GC 复用地址时不可靠 | 否（语义等价，实现更安全） |
| D12 | 不再为未派发的 `ON_ATTACK`/`TURN_START`/`TURN_END` 造机制 | PLAN 第 4.3 节：枚举存在不等于已实现 | 否（原版本就不触发） |
| D13 | 飞行规则保持「地对空只能打本体」，但统一走一条伤害管线 | 原版两条路径都不经免疫/防御判定 | 是（统一后需明确是否仍绕过免疫，见第 12 节） |
| D14 | 战斗随机使用独立带 seed 的 RNG；粒子随机另用独立源 | PLAN 第 4.2 节 | 是（固定 seed 后结果可复现） |
| D15 | 抽卡改用浮点累计权重统一采样 | 旧版整数 `randint(1,100)` 对小数权重有量化误差，且 `special`/`holiday` 权重和不足 100 时会落到未描述的全稀有度随机 | 是（修正概率） |

**不改动**的部分：5 战斗槽 / 8 准备槽 / 20 生命 / 开局各抽 3 / 每回合抽 1 出 1 /
双方 CD 同时递减 / 部署填首个空槽 / 从左到右同下标对位 / 空槽打本体 /
免疫只挡技能伤害 / 冰封造成伤害而不新增冻结状态 / 重复 trait 保留 /
分身共享状态组而复制独立。

---

## 11. 数据侧已确认的差异

来自 `scripts/import-legacy-data.py` 的实际运行（可由 `--check` 复现）：

| 项 | 旧值 | 问题 |
| --- | --- | --- |
| `special` 概率表权重合计 | 94.0 | 缺 B+/B/C+/C/D，剩余 6% 落到未描述的全稀有度随机 |
| `holiday` 概率表权重合计 | 64.5 | 剩余 35.5% 落到未描述的全稀有度随机 |
| 常规卡池 `prob_label` | 文案「8.9%」 | 实际权重算得 6.3% |
| 特别卡池 `prob_label` | 文案「100%」 | 实际权重 94.0% |
| 普通商店买卡 | 扣费 + 标记售罄 | **从未把卡加入库存**，是纯货币消耗 |
| 普通商店礼包 | 扣费 | **不发任何物品**，可无限重复购买 |
| 迷宫商店 7 条增益 | 写进存档 | 无战斗效果、界面也不显示，是死数据 |
| 活动商店随机种子 | `abs(hash(...))` | 依赖进程随机化哈希，跨进程不可复现 |

这些不在本轮自动「修好」，但也不照搬：概率口径按配置计算并写进配置（PLAN 第 6 节），
死数据不实现，缺失的授予流程在 P5 补齐并作为新规则记录。

---

## 12. 曾待 P2 复核（静态阅读无法确定）

**本节 7 项已在 P2 给出结论**，逐条见
[docs/validation/P2.md](validation/P2.md) 第 3 节。结论摘要：

1. 飞行重定向**保持绕过**免疫与防御——与旧版一致，改成走防御属于行为变更。
2. 同时死亡在**两个明确节点**判定（回合开头、全部战斗处理之后），不依赖时序巧合。
3. 复活体**本轮不能攻击**：回准备区并重新套用卡牌原始 CD。
4. 自毁**不会**与死亡处理重复：自毁只置零，移出与死亡技能统一由 `removeDead` 做。
5. 弃牌堆取牌**不存在**动画重入——引擎里没有任何阻塞或回调。
6. 「复制」的限制按回合重置。
7. 分身**没有按组限制行动**：每个槽位各自攻击一次，共享的只是数值。
   模型里原本设想的 `actedThisTurn` 字段因此被删掉——它暗示了一条不存在的规则。

以下是当时的原始列表，保留备查。

1. **飞行重定向是否应绕过免疫与防御**：原版 A1 路径（`BBS:1347-1368`）直接扣本体生命，
   不经 `deal_damage_to_slot`。统一伤害管线后要决定保留还是修正，并在差异记录里写明。
2. **同时死亡的具体判定时机**：一个行动内多次伤害可能造成双方或多张卡同时 ≤0，
   原版靠「下一个 `cleaning` 阶段」和玩家失败优先来规避，新版需要明确的判定点。
3. **复活体本轮能否攻击**：原版复活回准备区 `set_card` 会重置 CD（`CMP:49-50`），
   是否能在同日部署取决于 CD 值，需要用样例确认。
4. **自毁与 `remove_dead_cards` 是否可能处理同一 `CardData` 两次**：
   自毁先移除自己的槽位，静态看不会，但依赖动画时序。
5. **`draw_from_discard(animate=True)` 在 `BEFORE_ATTACK` 内重入阻塞动画**（`BBS:1216`）
   是否可能命中半渲染帧。
6. **`copy_usage_state` 的每回合限制**与 `turn_number` 的对应关系（`BBS:169-174, 519`）。
7. **分身共享状态组的行动限制**：一份状态组每方每回合能行动几次，需要样例确认。

以上每一条都必须在 `docs/validation/P2.md` 里给出结论与依据，不能默认沿用原版。
