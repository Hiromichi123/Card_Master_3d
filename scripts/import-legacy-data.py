#!/usr/bin/env python3
"""构建期旧数据导入与校验（施工清单 P0-5 / P0-6 / P0-8 / P0-9）。

职责边界
--------
本脚本**只读取** `--legacy-root`（默认 `D:\\Github\\card_maker`），把旧项目的
卡牌、关卡、卡池、牌组数据规范化成 `src/data/*.json`，并输出导入报告。
它不复制图片、不派生纹理（那是 `scripts/prepare-assets.py` 的职责），
也不写入原项目目录下的任何文件。

可重复性
--------
相同输入必须得到逐字节相同的输出。所有输出数组按固定顺序排序，
不使用随机数，不读取时间戳。`--check` 模式用于验证这一点：
重新生成后与磁盘上的文件比对，不一致则退出码 1。

机器判定 vs 人工判定
--------------------
- **机器判定**：`status`（数据完整度）、`registryMatch`（是否被 skill_registry.py
  的正则命中）由本脚本从旧数据与旧源码直接推导。
- **人工判定**：`scene-rule` / `alias` / `flavor` / `unimplemented` 这类结论需要
  读场景代码，结论保存在 `scripts/trait-overlay.json` 里（带 file:line 证据）。
  本脚本只负责合并与一致性检查，不臆造分类。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

# --------------------------------------------------------------------------
# 路径与常量
# --------------------------------------------------------------------------

DEFAULT_LEGACY_ROOT = Path(r"D:\Github\card_maker")
TARGET_ROOT = Path(__file__).resolve().parent.parent
DATA_OUT = TARGET_ROOT / "src" / "data"
REPORT_OUT = TARGET_ROOT / "docs" / "import-report.md"
OVERLAY_PATH = TARGET_ROOT / "scripts" / "trait-overlay.json"

# 旧项目 utils/card_database.py:8 的 RARITY_TO_LEVEL
RARITY_TO_LEVEL: dict[str, float] = {
    "SSS": 0,
    "SS+": 0.5,
    "SS": 1,
    "S+": 1.5,
    "S": 2,
    "A+": 2.5,
    "A": 3,
    "B+": 3.5,
    "B": 4,
    "C+": 4.5,
    "C": 5,
    "D": 6,
    "#elna": 0,
}

# 旧项目 utils/card_database.py:89 的加载顺序，用于决定输出顺序与稳定性
RARITY_DIRS = ["SSS", "SS+", "SS", "S+", "S", "A+", "A", "B+", "B", "C+", "C", "D"]
EVENT_DIRS = ["#elna"]
# #yoroi 不在 EVENT_DIRS 中（旧版从未加载），此处显式列出以便留档与报告
UNLOADED_DIRS = ["#yoroi"]

# 旧项目 config.py:38 的 COLORS（RGB 0-255）。新版按 sRGB 十六进制存储。
RARITY_COLORS: dict[str, str] = {
    "SSS": "#ff0000",
    "SS+": "#ff8072",
    "SS": "#ff6414",
    "S+": "#a0522d",
    "S": "#ffd700",
    "A+": "#4b0082",
    "A": "#8a2be2",
    "B+": "#0000a0",
    "B": "#00bfff",
    "C+": "#008000",
    "C": "#00ff00",
    "D": "#808080",
    "#elna": "#ff1493",
    "#yoroi": "#ff1493",
}

# 旧项目 game/card_system.py:49 的 HIGH_RARITY_LEVELS
HIGH_RARITY = ["A", "A+", "S", "S+", "SS", "SS+", "SSS", "#elna"]

# URL 安全 slug。旧目录名里的 `#` 与 `+` 不能直接进 URL
# （`#` 会被当作片段分隔符，`+` 在查询串里表示空格）。
RARITY_SLUG: dict[str, str] = {
    "SSS": "sss",
    "SS+": "ss-plus",
    "SS": "ss",
    "S+": "s-plus",
    "S": "s",
    "A+": "a-plus",
    "A": "a",
    "B+": "b-plus",
    "B": "b",
    "C+": "c-plus",
    "C": "c",
    "D": "d",
    "#elna": "elna",
    "#yoroi": "yoroi",
}

# 旧项目 game/skills/skill_registry.py 的匹配规则，**顺序与原文一致**。
# 原文用的是 `re.match`（只锚定开头，不是完整匹配），此处保持同样语义，
# 以便如实复现旧版的匹配结果；`--check` 会报告“前缀命中但非完整匹配”的情况。
REGISTRY_RULES: list[tuple[str, str, str]] = [
    # (family slug, kind, pattern)
    ("fireball", "regex", r"火球(\d+)"),
    ("iceSeal", "regex", r"冰封(\d+)"),
    ("lightning", "regex", r"闪电(\d+)"),
    ("groupFireball", "regex", r"群体火球(\d+)"),
    ("groupIceSeal", "regex", r"群体冰封(\d+)"),
    ("groupLightning", "regex", r"群体闪电(\d+)"),
    ("drawCard", "regex", r"抽卡(\d+)"),
    ("soulReturn", "regex", r"还魂(\d+)"),
    ("haste", "regex", r"加速(\d+)"),
    ("delay", "regex", r"延迟(\d+)"),
    ("selfDestruct", "exact", r"自毁"),
    ("silence", "exact", r"沉默"),
    ("immunity", "exact", r"免疫"),
    ("undying", "exact", r"不死"),
    ("rebirth", "exact", r"复活"),
    ("blessing", "regex", r"祝福(\d+)"),
    ("groupBlessing", "regex", r"群体祝福(\d+)"),
    ("inspire", "regex", r"振奋(\d+)"),
    ("groupInspire", "regex", r"群体振奋(\d+)"),
    ("curse", "regex", r"诅咒(\d+)"),
    ("armorBreak", "regex", r"破甲(\d+)"),
    ("defense", "regex", r"防御(\d+)"),
    ("healAlly", "regex", r"治愈(\d+)"),
    ("groupHeal", "regex", r"群体治愈(\d+)"),
    ("selfHeal", "regex", r"恢复(\d+)"),
    ("vampire", "regex", r"吸血(\d+)"),
    ("injury", "regex", r"受伤(\d+)"),
    ("counter", "regex", r"反击(\d+)"),
    ("dodge", "regex", r"闪避(\d+)"),
    ("berserk", "exact", r"狂暴"),
    ("clone", "exact", r"分身"),
    ("copy", "exact", r"复制"),
    ("bombard", "regex", r"炮击(\d+)"),
    ("groupBombard", "regex", r"群体爆破(\d+)"),
    ("explodeOnDeath", "exact", r"爆裂"),
    # ---- 以下不是旧注册表的规则，是本项目新增的族 -------------------------
    # 旧项目只有卡面数据（`assets/outputs/S+/cards.json:3` 写着「圣盾1」），没有实现。
    # 放在这个列表里是为了让生成的 skills 记录带上 family 与 param，
    # 与 `src/domain/skills/families.ts` 的 EXTRA_FAMILY_IDS 一一对应。
    ("holyShield", "regex", r"圣盾(\d+)"),
]

# 旧项目 game/skills/skill_registry.py 的工厂名，用于核对“35 族”这一数字。
REGISTRY_FACTORY_COUNT = 35

# slug -> 旧源码里的族名（skill_registry.py 的 import 注释与注册模式）。
# 仅用于报告可读性，规则实现以 REGISTRY_RULES 为准。
FAMILY_NAMES: dict[str, str] = {
    "fireball": "火球n",
    "iceSeal": "冰封n",
    "lightning": "闪电n",
    "groupFireball": "群体火球n",
    "groupIceSeal": "群体冰封n",
    "groupLightning": "群体闪电n",
    "drawCard": "抽卡n",
    "soulReturn": "还魂n",
    "haste": "加速n",
    "delay": "延迟n",
    "selfDestruct": "自毁",
    "silence": "沉默",
    "immunity": "免疫",
    "undying": "不死",
    "rebirth": "复活",
    "blessing": "祝福n",
    "groupBlessing": "群体祝福n",
    "inspire": "振奋n",
    "groupInspire": "群体振奋n",
    "curse": "诅咒n",
    "armorBreak": "破甲n",
    "defense": "防御n",
    "healAlly": "治愈n",
    "groupHeal": "群体治愈n",
    "selfHeal": "恢复n",
    "vampire": "吸血n",
    "injury": "受伤n",
    "counter": "反击n",
    "dodge": "闪避n",
    "berserk": "狂暴",
    "clone": "分身",
    "copy": "复制",
    "bombard": "炮击n",
    "groupBombard": "群体爆破n",
    "explodeOnDeath": "爆裂",
    "holyShield": "圣盾n",
}

# 战斗场景实现的规则，不在注册表里。见 battle_base_scene.py:1344 附近。
SCENE_RULE_TRAITS = ["飞行"]

# 旧项目 scenes/battle/battle_base_scene.py 的槽位与生命基线。
BATTLE_BASELINE = {
    "battleSlotsPerSide": 5,
    "prepSlotsPerSide": 8,
    "baseHp": 20,
    "openingDraw": 3,
}

# 旧项目 utils/deck_manager.py:7。战斗本身不校验上限（SB:159-191 照读 JSON），
# 只有组卡界面强制；因此敌方牌组可能存在超过上限的数据。
MAX_DECK_SIZE = 12


# --------------------------------------------------------------------------
# 小工具
# --------------------------------------------------------------------------


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path: Path, payload: Any) -> bool:
    """写入 JSON。返回是否与磁盘原内容不同。"""
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.write_text(text, encoding="utf-8", newline="\n")
    return True


def normalize_path(raw: str) -> str:
    """把旧存档里的反斜杠路径统一成 `/` 分隔。

    旧数据里 `data/deck/player_deck/deck.json` 用正斜杠，
    `data/deck/enemy_deck/single_player/*.json` 用反斜杠，
    两者都会经过 `utils/card_database.py:163` 的 replace('\\\\','/')。
    """
    return raw.replace("\\", "/")


def art_id(rarity: str, card_number: str) -> str:
    """卡面资源 ID。`#`/`+` 不出现在 ID 与文件名中。"""
    return f"card/{RARITY_SLUG[rarity]}/{card_number}"


def stable_hash(payload: Any) -> str:
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# trait 解析
# --------------------------------------------------------------------------


def match_registry(trait: str) -> dict[str, Any] | None:
    """按旧注册表的顺序与语义匹配一个 trait。"""
    for family, kind, pattern in REGISTRY_RULES:
        if kind == "exact":
            if trait == pattern:
                return {"family": family, "param": None, "matchKind": "exact"}
        else:
            m = re.match(pattern, trait)
            if m:
                prefix_hit = m.group(0) != trait
                return {
                    "family": family,
                    "param": int(m.group(1)),
                    "matchKind": "prefix" if prefix_hit else "full",
                }
    return None


def classify_trait(trait: str, overlay: dict[str, Any]) -> dict[str, Any]:
    """产出一条 trait 解析记录。

    `resolution` 的取值：
    - `implemented`   被技能注册表命中，旧版有规则实现
    - `scene-rule`    在战斗场景里实现，不在注册表
    - `alias`         与某个已注册族的命名变体，本轮不作为独立规则
    - `flavor`        说明性文字，无机制
    - `unimplemented` 确认没有实现
    - `ambiguous`     证据不足，需人工复核
    """
    hit = match_registry(trait)
    record: dict[str, Any] = {"raw": trait}

    if hit:
        record["resolution"] = "implemented"
        record["family"] = hit["family"]
        record["param"] = hit["param"]
        # 前缀命中说明旧版会把 `火球3X` 之类也当火球处理，记录以保留保真度
        record["matchKind"] = hit["matchKind"]
    elif trait in SCENE_RULE_TRAITS:
        record["resolution"] = "scene-rule"
        record["family"] = None
        record["param"] = None
        record["note"] = "战斗场景规则，非技能族"
    elif trait in overlay:
        entry = overlay[trait]
        record["resolution"] = entry["resolution"]
        record["family"] = entry.get("family")
        record["param"] = None
        record["evidence"] = entry.get("evidence")
        record["note"] = entry.get("note")
    else:
        record["resolution"] = "ambiguous"
        record["family"] = None
        record["param"] = None
        record["note"] = "未在 scripts/trait-overlay.json 中登记"

    return record


# --------------------------------------------------------------------------
# 数据导入
# --------------------------------------------------------------------------


def load_cards(legacy: Path, overlay: dict[str, Any], problems: list[str]) -> dict[str, Any]:
    """读取 13 个目录的 cards.json，生成 CardDefinition 列表。"""
    definitions: list[dict[str, Any]] = []
    incomplete: list[dict[str, Any]] = []
    level_mismatches: list[str] = []
    missing_png: list[str] = []
    orphan_png: list[str] = []
    per_rarity: list[dict[str, Any]] = []

    outputs_dir = legacy / "assets" / "outputs"
    for rarity in RARITY_DIRS + EVENT_DIRS + UNLOADED_DIRS:
        rdir = outputs_dir / rarity
        cards_json = rdir / "cards.json"
        loaded_here = False

        if not cards_json.exists():
            problems.append(f"缺少 {rarity}/cards.json")
            continue

        entries = read_json(cards_json)
        pngs = {p.stem for p in rdir.glob("*.png")}
        seen: set[str] = set()

        for entry in entries:
            number = str(entry["id"])
            seen.add(number)
            card_id = f"{rarity}_{number}"

            # 数据完整度：旧版要求 atk/hp/cd 同时存在
            missing_fields = [f for f in ("atk", "hp", "cd") if f not in entry]
            status = "incomplete" if missing_fields else "complete"

            # 旧版 `utils/card_database.py:30` 是
            # `level_override if level_override is not None else RARITY_TO_LEVEL.get(rarity, 3)`。
            # RARITY_TO_LEVEL 里没有 #yoroi，所以它会落到默认值 3；
            # 但 #yoroi 从未被加载，这一条只是为留档数据补一个确定值。
            rarity_level = RARITY_TO_LEVEL.get(rarity, 3)
            level = entry.get("level", rarity_level)
            if (
                rarity in (RARITY_DIRS + EVENT_DIRS)
                and entry.get("level") is not None
                and float(entry["level"]) != float(rarity_level)
            ):
                level_mismatches.append(
                    f"{card_id}: JSON level={entry['level']} 与稀有度默认 {rarity_level} 不同"
                )

            raw_traits = [str(t) for t in entry.get("traits", [])]
            skills = [classify_trait(t, overlay) for t in raw_traits]

            definition = {
                "cardId": card_id,
                "rarity": rarity,
                "name": entry.get("name", "未命名"),
                "level": level,
                "atk": int(entry.get("atk", 0)),
                "hp": int(entry.get("hp", 0)),
                "cd": int(entry.get("cd", 0)),
                "rawTraits": raw_traits,
                "skills": skills,
                "description": entry.get("description", ""),
                "status": status,
                "art": {
                    "artId": art_id(rarity, number),
                    "sourcePresent": number in pngs,
                },
            }
            definitions.append(definition)

            if status == "incomplete":
                incomplete.append(
                    {
                        "cardId": card_id,
                        "name": definition["name"],
                        "missingFields": missing_fields,
                        "loadedByLegacy": rarity in (RARITY_DIRS + EVENT_DIRS),
                    }
                )
                loaded_here = rarity in (RARITY_DIRS + EVENT_DIRS)
            else:
                loaded_here = True

            if number not in pngs:
                missing_png.append(card_id)

        for orphan in sorted(pngs - seen):
            orphan_png.append(f"{art_id(rarity, orphan)}.png")

        per_rarity.append(
            {
                "rarity": rarity,
                "slug": RARITY_SLUG[rarity],
                "level": RARITY_TO_LEVEL.get(rarity, 3),
                "color": RARITY_COLORS[rarity],
                "entryCount": len(entries),
                "pngCount": len(pngs),
                "loadedByLegacy": rarity in (RARITY_DIRS + EVENT_DIRS),
                "isEvent": rarity.startswith("#"),
                "isHighRarity": rarity in HIGH_RARITY,
            }
        )

        if rarity in (RARITY_DIRS + EVENT_DIRS) and not loaded_here and entries:
            problems.append(f"{rarity} 有 cards.json 但没有任何可用卡牌")

    if missing_png:
        problems.append(f"{len(missing_png)} 张卡缺同 ID 的 PNG（见报告）")
    if orphan_png:
        problems.append(f"{len(orphan_png)} 个 PNG 没有对应的 cards.json 条目（见报告）")

    return {
        "definitions": definitions,
        "incomplete": incomplete,
        "levelMismatches": level_mismatches,
        "missingPng": missing_png,
        "orphanPng": orphan_png,
        "perRarity": per_rarity,
    }


def load_stages(legacy: Path, problems: list[str]) -> dict[str, Any]:
    """从旧 `game/chapter_config.py` 提取章节与关卡。

    该模块只依赖 `os`，是纯数据 + 纯函数，执行它不会产生副作用，
    比手工转录更能保证与源码一致。
    """
    src = legacy / "game" / "chapter_config.py"
    if not src.exists():
        problems.append("缺少 game/chapter_config.py，跳过关卡导入")
        return {"chapters": [], "sourceHash": None}

    namespace: dict[str, Any] = {"__name__": "chapter_config"}
    code = src.read_text(encoding="utf-8")
    exec(compile(code, str(src), "exec"), namespace)  # noqa: S102 - 受控的纯数据模块
    chapters = namespace["WORLD_CHAPTERS"]

    out: list[dict[str, Any]] = []
    posters_dir = legacy / "assets" / "poster"
    for chapter in chapters:
        stages = []
        for stage in chapter.get("stages", []):
            poster_file = Path(stage["poster"]).name
            # poster 是资产，记录 slug 而不是旧相对路径
            poster_id = f"poster/{Path(poster_file).stem}"
            if not (posters_dir / poster_file).exists():
                problems.append(f"关卡 {stage['id']} 的海报缺失: {poster_file}")
            stages.append(
                {
                    "id": stage["id"],
                    "name": stage["name"],
                    "posterId": poster_id,
                    "summary": stage.get("summary"),
                    "reward": stage.get("reward"),
                }
            )
        chapter_poster = Path(chapter["poster"]).name
        if chapter.get("stages") and not (posters_dir / chapter_poster).exists():
            problems.append(f"章节 {chapter['id']} 的海报缺失: {chapter_poster}")
        out.append(
            {
                "id": chapter["id"],
                "name": chapter["name"],
                "posterId": f"poster/{Path(chapter_poster).stem}",
                "bgType": chapter.get("bg_type"),
                "stages": stages,
            }
        )

    empty = [c["id"] for c in out if not c["stages"]]
    return {
        "chapters": out,
        "emptyChapters": empty,
        "sourceHash": hashlib.sha256(code.encode("utf-8")).hexdigest()[:16],
    }


def load_gacha(legacy: Path, problems: list[str]) -> dict[str, Any]:
    """从旧 `scenes/gacha/gacha_probabilities.py` 提取卡池与概率表。"""
    src = legacy / "scenes" / "gacha" / "gacha_probabilities.py"
    if not src.exists():
        problems.append("缺少 scenes/gacha/gacha_probabilities.py，跳过卡池导入")
        return {"pools": [], "tables": {}, "tableDiagnostics": []}

    namespace: dict[str, Any] = {"__name__": "gacha_probabilities"}
    namespace["__file__"] = str(src)
    code = src.read_text(encoding="utf-8")
    # 该模块只有 `from __future__ import annotations` 与纯数据，执行无副作用
    exec(compile(code, "from __future__ import annotations\n" + code, "exec"), namespace)  # noqa: S102

    rarity_levels = list(namespace["RARITY_LEVELS"])
    raw_tables = {
        "simple": namespace["simple_prob"],
        "activity": namespace["activity_prob"],
        "special": namespace["special_prob"],
        "holiday": namespace["holiday_prob"],
        "SSS": namespace["_PROB_TABLES"]["SSS"],
        "SS": namespace["_PROB_TABLES"]["SS"],
        "S": namespace["_PROB_TABLES"]["S"],
        "A": namespace["_PROB_TABLES"]["A"],
    }

    tables: dict[str, dict[str, float]] = {}
    diagnostics: list[dict[str, Any]] = []
    for name, table in raw_tables.items():
        # 复现 get_prob_table：缺失稀有度补 0，并按 RARITY_LEVELS 固定顺序
        full = {r: float(table.get(r, 0)) for r in rarity_levels}
        tables[name] = full
        total = sum(full.values())
        rare = sum(v for k, v in full.items() if k in ("SSS", "SS+", "SS", "S+", "S", "A+", "A"))
        entry = {
            "table": name,
            "total": round(total, 6),
            "rareTotal": round(rare, 6),
            "missingRarities": [r for r in rarity_levels if r not in table],
        }
        diagnostics.append(entry)
        if abs(total - 100.0) > 1e-9:
            # 旧版 draw_single_card 用 randint(1,100) 与累计值比较，
            # 权重和不等于 100 时剩余区间会落到 fallback 的“任意稀有度随机”。
            problems.append(
                f"概率表 {name} 权重合计 {total}（不是 100），"
                "旧版剩余区间会走 fallback 随机稀有度"
            )

    pools = []
    for pool in namespace["GACHA_POOLS"]:
        label = pool.get("prob_label", "")
        declared = re.search(r"\(([\d.]+)%\)", label)
        entry = {
            "id": pool["id"],
            "name": pool["name"],
            "bgType": pool.get("bg_type"),
            "description": pool.get("description"),
            "probTable": pool.get("prob_table"),
            "probLabel": label,
            "currency": pool.get("currency"),
            "singleCost": pool.get("single_cost"),
            "tenCost": pool.get("ten_cost"),
            "showcaseCards": pool.get("showcase_cards", []),
        }
        table = tables.get(pool.get("prob_table", "simple"), {})
        actual_rare = sum(
            v for k, v in table.items() if k in ("SSS", "SS+", "SS", "S+", "S", "A+", "A")
        )
        entry["declaredRarePercent"] = float(declared.group(1)) if declared else None
        entry["computedRarePercent"] = round(actual_rare, 6)
        # 文案与实际权重不一致时以配置为准（PLAN 第 6 节）
        if declared and abs(float(declared.group(1)) - actual_rare) > 1e-9:
            problems.append(
                f"卡池 {pool['id']} 的展示文案 {declared.group(1)}% "
                f"与实际权重 {actual_rare}% 不一致"
            )
        pools.append(entry)

    return {
        "pools": pools,
        "tables": tables,
        "tableDiagnostics": diagnostics,
        "sourceHash": hashlib.sha256(code.encode("utf-8")).hexdigest()[:16],
    }


def load_decks(legacy: Path, card_ids: set[str], problems: list[str]) -> dict[str, Any]:
    """导入敌方牌组与演示牌组。路径映射到 cardId，未知项可见。"""

    def convert(entries: list[dict[str, Any]], origin: str) -> dict[str, Any]:
        ids: list[str] = []
        unknown: list[str] = []
        for item in entries:
            norm = normalize_path(item["path"])
            # assets/outputs/<rarity>/<id>.png -> "<rarity>_<id>"
            parts = norm.split("/")
            if len(parts) >= 4 and parts[0] == "assets" and parts[1] == "outputs":
                candidate = f"{parts[2]}_{Path(parts[3]).stem}"
            else:
                candidate = f"<无法解析:{norm}>"
            if candidate in card_ids:
                ids.append(candidate)
            else:
                unknown.append(f"{candidate} ({norm})")
        if unknown:
            problems.append(f"{origin} 有 {len(unknown)} 个无法映射到 cardId 的条目")

        # 牌组结构体检：上限、重复度。旧版战斗不校验上限，
        # 所以这里只报告，不擅自裁剪数据。
        distinct = len(set(ids))
        notes: list[str] = []
        if len(ids) > MAX_DECK_SIZE:
            notes.append(f"超过 {MAX_DECK_SIZE} 张上限（{len(ids)} 张）")
            problems.append(f"{origin} 有 {len(ids)} 张，超过组卡上限 {MAX_DECK_SIZE}")
        if ids and distinct == 1:
            notes.append(f"全部是同一张卡（{ids[0]}），疑似占位数据")
            problems.append(f"{origin} 的 {len(ids)} 张全是同一张卡 {ids[0]}，疑似占位数据")
        return {
            "cardIds": ids,
            "unknown": unknown,
            "size": len(ids),
            "distinct": distinct,
            "notes": notes,
        }

    decks: dict[str, Any] = {"enemy": {}, "demo": None}

    enemy_dir = legacy / "data" / "deck" / "enemy_deck" / "single_player"
    if enemy_dir.exists():
        for path in sorted(enemy_dir.glob("*.json")):
            payload = read_json(path)
            decks["enemy"][path.stem] = convert(payload.get("deck", []), f"敌牌组 {path.stem}")
    else:
        problems.append("缺少敌方牌组目录 data/deck/enemy_deck/single_player")

    demo_path = legacy / "data" / "deck" / "player_deck" / "deck.json"
    if demo_path.exists():
        payload = read_json(demo_path)
        converted = convert(payload.get("deck", []), "演示牌组")
        converted["note"] = (
            "这是旧版玩家存档里的牌组，仅作为 P3 固定演示牌组的候选；"
            "新版用户牌组存在 IndexedDB，不从这里读取。"
        )
        decks["demo"] = converted
    else:
        problems.append("缺少演示牌组 data/deck/player_deck/deck.json")

    return decks


SLICE_DEFINITION_PATH = TARGET_ROOT / "scripts" / "slice-definition.json"


def load_slice(
    definitions: list[dict[str, Any]], problems: list[str]
) -> dict[str, Any] | None:
    """校验人工挑选的切片并补上真实数值。

    切片意图在 `Scripts/slice-definition.json` 里，ATK/HP/CD/traits 一律从
    `cards.json` 取，不复抄，避免与数据源漂移。
    """
    if not SLICE_DEFINITION_PATH.exists():
        problems.append("缺少 scripts/slice-definition.json，跳过切片校验")
        return None

    try:
        spec = read_json(SLICE_DEFINITION_PATH)
    except json.JSONDecodeError as exc:
        problems.append(f"slice-definition.json 解析失败: {exc}")
        return None

    by_id = {d["cardId"]: d for d in definitions}

    cards: list[dict[str, Any]] = []
    slice_ids: set[str] = set()
    for entry in spec.get("cards", []):
        cid = entry["cardId"]
        if cid in slice_ids:
            problems.append(f"切片里 {cid} 重复")
            continue
        card = by_id.get(cid)
        if card is None:
            problems.append(f"切片引用了不存在的卡牌 {cid}")
            continue
        if card["status"] != "complete":
            problems.append(f"切片引用了数据不完整的卡牌 {cid}，不能进入战斗")
            continue
        slice_ids.add(cid)
        cards.append(
            {
                "cardId": cid,
                "why": entry["why"],
                "rarity": card["rarity"],
                "atk": card["atk"],
                "hp": card["hp"],
                "cd": card["cd"],
                "rawTraits": card["rawTraits"],
                "families": [
                    s["family"]
                    for s in card["skills"]
                    if s["resolution"] in ("implemented", "alias") and s.get("family")
                ],
                "sceneRules": [
                    s["raw"] for s in card["skills"] if s["resolution"] == "scene-rule"
                ],
            }
        )

    decks: list[dict[str, Any]] = []
    for deck in spec.get("decks", []):
        ids = deck["cardIds"]
        for cid in ids:
            if cid not in slice_ids:
                problems.append(f"牌组 {deck['id']} 引用了切片外的卡牌 {cid}")
        if len(ids) > MAX_DECK_SIZE:
            problems.append(f"牌组 {deck['id']} 有 {len(ids)} 张，超过上限 {MAX_DECK_SIZE}")
        if len(ids) != len(set(ids)):
            problems.append(f"牌组 {deck['id']} 内部有重复的卡牌 ID")
        decks.append(
            {
                "id": deck["id"],
                "name": deck["name"],
                "purpose": deck["purpose"],
                "cardIds": ids,
                "size": len(ids),
            }
        )

    # 切片覆盖了哪些族，以及缺哪些族
    covered: set[str] = set()
    for card in cards:
        covered.update(card["families"])
    all_families = {f for f, _, _ in REGISTRY_RULES}
    missing = sorted(all_families - covered)

    # 每个场景声明的族必须真的出现在切片里（flying 是场景规则，单独校验）
    scene_rule_traits = {trait for card in cards for trait in card["sceneRules"]}
    scenarios: list[dict[str, Any]] = []
    for scenario in spec.get("scenarios", []):
        for cover in scenario["covers"]:
            if cover == "flying":
                if "飞行" not in scene_rule_traits:
                    problems.append(f"场景 {scenario['id']} 声明覆盖飞行，但切片里没有飞行卡")
            elif cover not in covered:
                problems.append(
                    f"场景 {scenario['id']} 声明覆盖 {cover}，但切片里没有任何卡带这个族"
                )
        scenarios.append(
            {
                "id": scenario["id"],
                "goal": scenario["goal"],
                "covers": scenario["covers"],
                "coversNames": [
                    "飞行" if c == "flying" else FAMILY_NAMES.get(c, c)
                    for c in scenario["covers"]
                ],
            }
        )

    return {
        "seedBase": spec.get("seedBase"),
        "cards": cards,
        "decks": decks,
        "scenarios": scenarios,
        "familiesCovered": sorted(covered),
        "familiesMissing": missing,
        "count": len(cards),
    }


def _literalish(node: Any) -> Any:
    """把 AST 字面量转成 Python 值；遇到非字面量（如 `int(x * SCALE)`）抛错。

    用于从旧场景文件里取出配置常量，而不必 import 它们
    （那些模块 `import pygame`，无法在无显示环境执行）。
    """
    import ast

    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Tuple):
        return tuple(_literalish(e) for e in node.elts)
    if isinstance(node, ast.List):
        return [_literalish(e) for e in node.elts]
    if isinstance(node, ast.Dict):
        return {
            _literalish(k): _literalish(v) for k, v in zip(node.keys, node.values)
        }
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_literalish(node.operand)
    raise ValueError(f"非字面量节点: {type(node).__name__}")


def _module_constants(path: Path, wanted: set[str]) -> dict[str, Any]:
    """取出模块级 `NAME = <字面量>` 形式的常量。"""
    import ast

    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: dict[str, Any] = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id in wanted:
                try:
                    found[target.id] = _literalish(node.value)
                except ValueError as exc:
                    raise ValueError(f"{path.name}:{node.lineno} {target.id} {exc}") from exc
    return found


def _class_attr(path: Path, class_name: str, attr: str) -> Any:
    """取出 `class X: ATTR = <字面量>`。"""
    import ast

    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            for item in node.body:
                if isinstance(item, ast.Assign):
                    for target in item.targets:
                        if isinstance(target, ast.Name) and target.id == attr:
                            return _literalish(item.value)
    raise ValueError(f"{path.name}: 找不到 {class_name}.{attr}")


def _method_returned_dict(path: Path, class_name: str, method: str) -> dict[str, Any]:
    """取出形如 `def _build_shelf_specs(self): return {...}` 的返回值。

    只取配置相关的键；`card_size`/`height`/颜色属于旧版像素布局，
    新版按 PLAN 第 1 节重新设计，不迁移。
    """
    import ast

    keep = {"label", "rarities", "count_range", "allow_repeat"}
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            for item in node.body:
                if isinstance(item, ast.FunctionDef) and item.name == method:
                    for stmt in ast.walk(item):
                        if isinstance(stmt, ast.Return) and isinstance(stmt.value, ast.Dict):
                            out: dict[str, Any] = {}
                            for key, value in zip(stmt.value.keys, stmt.value.values):
                                name = _literalish(key)
                                entry: dict[str, Any] = {}
                                if isinstance(value, ast.Dict):
                                    for k2, v2 in zip(value.keys, value.values):
                                        kk = _literalish(k2)
                                        if kk in keep:
                                            entry[kk] = _literalish(v2)
                                out[name] = entry
                            return out
    raise ValueError(f"{path.name}: 找不到 {class_name}.{method} 返回的字典")


# 融合的数值写在 `_calculate_probabilities` 的代码里而不是常量表里，
# 这里按 file:line 声明并用源码文本核对（见 _verify_fusion_literals）。
FUSION_SPEC = {
    "altarSlots": 5,
    "baseWeight": 0.05,
    "sameRarityBonus": 1.0,
    "rarerNeighborBonus": 0.35,
    "commonNeighborBonus": 0.2,
    "currencyCost": 0,
}

# (文件, 期望出现的片段) —— 任一找不到就报错，避免旧源码变动后静默失配。
# 用片段搜索而不是固定行号：行号会随无关改动漂移，而我们要守的是**数值**。
FUSION_LITERAL_CHECKS: list[tuple[str, str]] = [
    ("scenes/workshop_scene.py", "self.altar_slots = [None] * 5"),
    ("scenes/workshop_scene.py", "{rarity: 0.05 for rarity in self.RARITY_ORDER}"),
    ("scenes/workshop_scene.py", "distribution.get(rarity, 0.0) + 1.0"),
    ("scenes/workshop_scene.py", "distribution.get(neighbor, 0.0) + 0.35"),
    ("scenes/workshop_scene.py", "distribution.get(neighbor, 0.0) + 0.2"),
]


def load_shops(legacy: Path, problems: list[str]) -> dict[str, Any]:
    """迁移常规商店、活动商店与工坊融合的配置。

    只迁移**配置数值**；这些场景在旧版里的行为缺陷（买卡不授予、礼包不发物品、
    融合失败仍消耗素材等）不照搬，逐条写进 knownIssues，由 P5 决策新版语义。
    """
    shop_src = legacy / "scenes" / "shop_scene.py"
    act_src = legacy / "scenes" / "activity" / "activity_shop_scene.py"
    ws_src = legacy / "scenes" / "workshop_scene.py"

    for path in (shop_src, act_src, ws_src):
        if not path.exists():
            problems.append(f"缺少 {path.relative_to(legacy)}，跳过商店与融合配置迁移")
            return {"available": False}

    normal = _module_constants(shop_src, {"CARD_PRICE_RULES", "PACK_DEFINITIONS"})
    activity = _module_constants(
        act_src, {"BADGE_PRICE_RULES", "DEFAULT_BADGE_PRICE"}
    )
    rarities = _class_attr(ws_src, "WorkshopScene", "RARITY_ORDER")

    # 融合字面量核对：数值写在代码里而不是常量表里，所以按片段搜索确认它们没变
    for rel, expected in FUSION_LITERAL_CHECKS:
        source_text = (legacy / rel).read_text(encoding="utf-8")
        if expected not in source_text:
            problems.append(
                f"{rel} 中找不到融合相关片段 `{expected}`；"
                "融合配置可能已变动，需要人工核对 FUSION_SPEC"
            )

    valid = set(RARITY_TO_LEVEL)
    for rarity in normal["CARD_PRICE_RULES"]:
        if rarity not in valid:
            problems.append(f"常规商店价格表出现未知稀有度 {rarity}")
    for rarity in activity["BADGE_PRICE_RULES"]:
        if rarity not in valid:
            problems.append(f"活动商店价格表出现未知稀有度 {rarity}")

    return {
        "available": True,
        "normalShop": {
            "priceByRarity": normal["CARD_PRICE_RULES"],
            "unknownRarityFallback": {"currency": "gold", "amount": 1000},
            "packs": normal["PACK_DEFINITIONS"],
            "shelves": _method_returned_dict(shop_src, "ShopScene", "_build_shelf_specs"),
            "refresh": {
                "dayKeyFormat": "%Y%m%d",
                "seedDerivation": "int(dayKey)",
                "seedReproducible": True,
            },
        },
        "activityShop": {
            "priceByRarity": activity["BADGE_PRICE_RULES"],
            "unknownRarityFallback": {"currency": "badge", "amount": activity["DEFAULT_BADGE_PRICE"]},
            "shelves": _method_returned_dict(act_src, "ActivityShopScene", "_build_shelf_specs"),
            "refresh": {
                "dayKeyFormat": "%Y%m%d",
                "seedDerivation": "abs(hash('activity_' + dayKey)) % (2**31-1)",
                "seedReproducible": False,
                "note": "Python 字符串 hash 受 PYTHONHASHSEED 影响，跨进程不可复现；新版改用稳定哈希",
            },
        },
        "fusion": {
            **FUSION_SPEC,
            "rarityOrder": rarities,
            "distributionRule": (
                "每个稀有度基础权重 0.05；每张投入卡：自身稀有度 +1.0、"
                "更稀有的一档 +0.35、更常见的一档 +0.2；最后按总和归一化"
            ),
            "displayMatchesDraw": True,
            "evidence": "scenes/workshop_scene.py:475-493 计算，:495-518 使用同一个分布抽取",
        },
        "knownIssues": [
            {
                "area": "normalShop.card",
                "issue": "购买卡牌只扣除货币并标记售罄，从未把卡加入库存",
                "evidence": "scenes/shop_scene.py:612-635 无 inventory.add_card",
                "newVersionDecision": "P5 必须补齐授予流程，并按新语义记录；不得照搬",
            },
            {
                "area": "normalShop.packs",
                "issue": "礼包只扣费，不发放任何物品，也不记录，可无限重复购买",
                "evidence": "scenes/shop_scene.py:637-654",
                "newVersionDecision": "P5 需要定义礼包内容或从界面移除",
            },
            {
                "area": "activityShop.purchase",
                "issue": "扣费、售罄、加卡分散在 4 次保存，非原子",
                "evidence": "activity_shop_scene.py:493-525",
                "newVersionDecision": "改为一次 EconomyTransaction",
            },
            {
                "area": "fusion",
                "issue": "抽取失败（该稀有度无可用卡）时，5 张投入卡仍被消耗并保存",
                "evidence": "scenes/workshop_scene.py:507-516",
                "newVersionDecision": "新版必须在一次事务内判定，失败则整个操作不生效",
            },
            {
                "area": "fusion",
                "issue": "新卡可能与刚消耗的卡是同一张，等于原地不动却消耗了 4 张",
                "evidence": "scenes/workshop_scene.py:508-512",
                "newVersionDecision": "P5 决定是否排除刚消耗的卡",
            },
            {
                "area": "normalShop.refresh",
                "issue": "「刷新货架」每次都重建同 seed 的随机源，货架内容不变",
                "evidence": "scenes/shop_scene.py:245-256",
                "newVersionDecision": "新版刷新必须真正重掷，或明确移除该按钮",
            },
        ],
    }


def load_trait_overlay(problems: list[str]) -> dict[str, Any]:
    if not OVERLAY_PATH.exists():
        problems.append(
            "缺少 scripts/trait-overlay.json，未登记 trait 会全部标为 ambiguous"
        )
        return {}
    try:
        payload = read_json(OVERLAY_PATH)
    except json.JSONDecodeError as exc:
        problems.append(f"trait-overlay.json 解析失败: {exc}")
        return {}
    allowed = {"scene-rule", "alias", "flavor", "unimplemented", "ambiguous", "implemented"}
    for trait, entry in payload.get("traits", {}).items():
        if entry.get("resolution") not in allowed:
            problems.append(f"trait-overlay.json 中 {trait} 的 resolution 非法")
    return payload.get("traits", {})


# --------------------------------------------------------------------------
# 校验
# --------------------------------------------------------------------------


def apply_content_rules(cards_payload: dict[str, Any]) -> list[str]:
    """
    生成期的**内容规则**（不是旧数据的翻译）。

    `自毁` 卡的血量一律记 0：这类卡是**一次性**的——上场即执行自己的行动，
    然后被消耗掉，留在台面上的那 5 点血没有意义（旧数据里 19 张全是 5）。
    引擎那边由 `isSelfDestructCard` 认这一类卡（`src/domain/cards/traits.ts`），
    数值徽标也不显示它们的 HP。

    **为什么写在这里而不是去改旧项目的数据**：导入脚本对旧项目**只读**
    （P0 验收：「导入可重复运行、不修改原项目」），所以这类修正只能落在生成期；
    写在这里，重跑导入不会把这 19 张退回 5。

    返回被改动的 cardId（进导入报告，便于核对）。
    """
    changed: list[str] = []
    for definition in cards_payload["definitions"]:
        if "自毁" in definition["rawTraits"] and definition["hp"] != 0:
            changed.append(f"{definition['cardId']}（{definition['hp']} → 0）")
            definition["hp"] = 0
    return changed


def validate_cards(cards: dict[str, Any], problems: list[str]) -> dict[str, Any]:
    definitions = cards["definitions"]
    complete = [d for d in definitions if d["status"] == "complete"]
    incomplete = [d for d in definitions if d["status"] == "incomplete"]

    ids = [d["cardId"] for d in definitions]
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    if duplicates:
        problems.append(f"cardId 重复: {duplicates}")

    for d in complete:
        # 自毁卡的 hp 就该是 0（见 apply_content_rules），其余 complete 卡必须为正
        if d["hp"] < 0 or (d["hp"] == 0 and "自毁" not in d["rawTraits"]):
            problems.append(f"{d['cardId']} 是 complete 但 hp={d['hp']}")
        if d["cd"] < 0:
            problems.append(f"{d['cardId']} 是 complete 但 cd={d['cd']} 为负")

    trait_counts: dict[str, int] = {}
    for d in definitions:
        for t in d["rawTraits"]:
            trait_counts[t] = trait_counts.get(t, 0) + 1

    resolution_counts: dict[str, int] = {}
    for d in definitions:
        for s in d["skills"]:
            res = s["resolution"]
            resolution_counts[res] = resolution_counts.get(res, 0) + 1

    # 去重后的分布：与「118 种 trait」「47 种未识别」这两个口径对齐，
    # 上面的 occurrence 计数会被热门 trait（如 飞行 18 张）放大。
    distinct_by_resolution: dict[str, set[str]] = {}
    for d in definitions:
        for s in d["skills"]:
            distinct_by_resolution.setdefault(s["resolution"], set()).add(s["raw"])

    # 35 个族的覆盖情况：每族有哪些参数、多少张卡使用
    family_cards: dict[str, set[str]] = {}
    family_params: dict[str, set[int]] = {}
    for d in definitions:
        for s in d["skills"]:
            fam = s.get("family")
            if s["resolution"] in ("implemented", "alias") and fam:
                family_cards.setdefault(fam, set()).add(d["cardId"])
                if s.get("param") is not None:
                    family_params.setdefault(fam, set()).add(s["param"])

    known_families = {f for f, _, _ in REGISTRY_RULES}
    families = []
    for fam in sorted(known_families):
        params = sorted(family_params.get(fam, set()))
        families.append(
            {
                "family": fam,
                "sourceName": FAMILY_NAMES.get(fam, fam),
                "paramValues": params,
                "hasParam": any(kind == "regex" for f, kind, _ in REGISTRY_RULES if f == fam),
                "cardCount": len(family_cards.get(fam, set())),
                # family_cards 在收集时已包含 alias 命中，所以这里就是“是否被卡牌使用”
                "used": fam in family_cards,
            }
        )

    return {
        "total": len(definitions),
        "complete": len(complete),
        "incomplete": len(incomplete),
        "distinctTraits": len(trait_counts),
        "traitCounts": dict(sorted(trait_counts.items())),
        "resolutionCounts": dict(sorted(resolution_counts.items())),
        "distinctByResolution": {
            k: sorted(v) for k, v in sorted(distinct_by_resolution.items())
        },
        "families": families,
        "registryFactoryCount": REGISTRY_FACTORY_COUNT,
        "recognizedFamilyCount": len(known_families),
        "duplicateIds": duplicates,
    }


# --------------------------------------------------------------------------
# 报告
# --------------------------------------------------------------------------


def render_report(
    cards_payload: dict[str, Any],
    validation: dict[str, Any],
    stages: dict[str, Any],
    gacha: dict[str, Any],
    decks: dict[str, Any],
    slice_data: dict[str, Any] | None,
    shops: dict[str, Any],
    problems: list[str],
    self_destruct_zeroed: list[str] | None = None,
) -> str:
    lines: list[str] = []
    add = lines.append

    add("# 旧数据导入报告")
    add("")
    add("由 `scripts/import-legacy-data.py` 生成，请勿手工编辑。")
    add("重新生成：`python scripts/import-legacy-data.py`；只校验：`--check`。")
    add("")

    add("## 1. 卡牌总量")
    add("")
    add("| 项 | 数量 |")
    add("| --- | --- |")
    add(f"| 输出目录中的卡牌条目 | {validation['total']} |")
    add(f"| 其中数据完整（可进战斗与卡池） | {validation['complete']} |")
    add(f"| 其中数据不完整（仅留档） | {validation['incomplete']} |")
    add(f"| 不同 trait 字符串 | {validation['distinctTraits']} |")
    zeroed = self_destruct_zeroed or []
    add(f"| 其中「自毁」卡 hp 置零（本项目的内容规则） | {len(zeroed)} |")
    add("")
    if zeroed:
        add(
            "`自毁` 是一次性卡：上场即执行行动然后被消耗，血量没有意义，"
            "所以生成期把它们的 `hp` 一律记 0（旧数据里是 5）。"
            "导入脚本对旧项目只读，这类修正落在生成期，重跑不会退回。"
        )
        add("")
        add("被改动的卡：" + "、".join(f"`{item}`" for item in zeroed))
        add("")

    add("按 trait 解析结果的分布。**出现次数**是卡面上的累计出现（热门 trait 会被放大），")
    add("**不同 trait** 才是与「118 种」「47 种未识别」对齐的口径：")
    add("")
    add("| 解析结果 | 出现次数 | 不同 trait |")
    add("| --- | --- | --- |")
    for key, value in validation["resolutionCounts"].items():
        distinct = len(validation["distinctByResolution"].get(key, []))
        add(f"| {key} | {value} | {distinct} |")
    add("")
    recognized = validation["recognizedFamilyCount"]
    add(
        f"注册表识别族数：{recognized}（旧源码 `skill_registry.py` 导入的工厂数 "
        f"{validation['registryFactoryCount']}，其余 {recognized - validation['registryFactoryCount']} "
        "个是本项目新增的族——旧项目只有卡面数据、没有实现）。"
    )
    add("")
    scene_rule_traits = sorted(
        validation["distinctByResolution"].get("scene-rule", [])
    )
    not_implemented = sorted(
        set(validation["distinctByResolution"].get("alias", []))
        | set(validation["distinctByResolution"].get("flavor", []))
        | set(validation["distinctByResolution"].get("unimplemented", []))
        | set(validation["distinctByResolution"].get("ambiguous", []))
    )
    add(
        f"场景规则 trait：{'、'.join(scene_rule_traits) or '无'}；"
        f"不在注册表的 trait 共 {len(not_implemented)} 种。"
    )
    add("")

    add("### 35 个技能族的覆盖")
    add("")
    add("`used` 表示该族是否真的被卡牌引用；`param` 列出卡面数据里实际出现的参数值。")
    add("未被使用的族仍然要在 P4 覆盖（PLAN 第 4.3 节），但本轮不为其造数据。")
    add("")
    add("| 族 | 旧名 | 带参数 | 参数取值 | 引用卡数 |")
    add("| --- | --- | --- | --- | --- |")
    for row in validation["families"]:
        params = "、".join(str(p) for p in row["paramValues"]) if row["paramValues"] else "—"
        add(
            f"| {row['family']} | {row['sourceName']} | "
            f"{'是' if row['hasParam'] else '否'} | {params} | {row['cardCount']} |"
        )
    unused = [r["family"] for r in validation["families"] if not r["used"]]
    add("")
    add(
        f"未被任何卡牌引用的族（{len(unused)} 个）：{'、'.join(unused) or '无'}"
    )
    add("")

    add("## 2. 每个稀有度目录")
    add("")
    add("| 稀有度 | slug | level | 条目 | PNG | 旧版加载 | 备注 |")
    add("| --- | --- | --- | --- | --- | --- | --- |")
    for row in cards_payload["perRarity"]:
        note = []
        if row["isEvent"]:
            note.append("事件卡")
        if not row["loadedByLegacy"]:
            note.append("旧版未加载")
        add(
            f"| {row['rarity']} | {row['slug']} | {row['level']} | {row['entryCount']} | "
            f"{row['pngCount']} | {'是' if row['loadedByLegacy'] else '否'} | "
            f"{'、'.join(note) or '—'} |"
        )
    add("")

    add("## 3. 数据不完整的卡牌")
    add("")
    add("这些卡只有部分元数据，没有 ATK/HP/CD。它们**不进入**战斗与抽卡池，")
    add("只在图鉴里留档。")
    add("")
    add("| cardId | 名称 | 缺失字段 | 旧版是否加载 |")
    add("| --- | --- | --- | --- |")
    for row in cards_payload["incomplete"]:
        add(
            f"| {row['cardId']} | {row['name']} | {'、'.join(row['missingFields'])} | "
            f"{'是' if row['loadedByLegacy'] else '否'} |"
        )
    add("")

    if cards_payload["levelMismatches"]:
        add("### 卡面 `level` 与稀有度默认值不一致")
        add("")
        add("旧版以稀有度映射为准（`level_override` 优先，但样例数据里两者相同）：")
        add("")
        for item in cards_payload["levelMismatches"]:
            add(f"- {item}")
        add("")
    else:
        add("所有卡牌的 `level` 都与所属稀有度的默认值一致，无需额外处理。")
        add("")

    if cards_payload["missingPng"] or cards_payload["orphanPng"]:
        add("### 图片与数据不一致")
        add("")
        if cards_payload["missingPng"]:
            add(f"- 有 JSON 条目但缺 PNG：{len(cards_payload['missingPng'])} 张")
            for cid in cards_payload["missingPng"][:20]:
                add(f"  - {cid}")
        if cards_payload["orphanPng"]:
            add(f"- 有 PNG 但没有 JSON 条目：{len(cards_payload['orphanPng'])} 个")
            for aid in cards_payload["orphanPng"][:20]:
                add(f"  - {aid}")
        add("")

    add("## 4. 章节与关卡")
    add("")
    add("| 章节 | 名称 | 关卡数 | 空章节 |")
    add("| --- | --- | --- | --- |")
    for chapter in stages["chapters"]:
        add(
            f"| {chapter['id']} | {chapter['name']} | {len(chapter['stages'])} | "
            f"{'是' if not chapter['stages'] else '否'} |"
        )
    add("")
    if stages.get("emptyChapters"):
        add(
            f"空章节：{'、'.join(stages['emptyChapters'])}。"
            "按 PLAN 第 1 节，本轮不为其构造新内容。"
        )
        add("")

    add("## 5. 卡池与概率")
    add("")
    add("| 卡池 | 货币 | 单抽 | 十连 | 概率表 | 文案爆率 | 计算爆率 | 权重合计 |")
    add("| --- | --- | --- | --- | --- | --- | --- | --- |")
    diag = {d["table"]: d for d in gacha.get("tableDiagnostics", [])}
    for pool in gacha.get("pools", []):
        table = diag.get(pool["probTable"], {})
        add(
            f"| {pool['name']} | {pool['currency']} | {pool['singleCost']} | "
            f"{pool['tenCost']} | {pool['probTable']} | "
            f"{pool['declaredRarePercent']}% | {pool['computedRarePercent']}% | "
            f"{table.get('total', '—')} |"
        )
    add("")
    add("### 概率表诊断（关键）")
    add("")
    add("| 概率表 | 权重合计 | 缺失稀有度 |")
    add("| --- | --- | --- |")
    for d in gacha.get("tableDiagnostics", []):
        add(
            f"| {d['table']} | {d['total']} | "
            f"{'、'.join(d['missingRarities']) if d['missingRarities'] else '—'} |"
        )
    add("")
    add("旧版 `game/card_system.py:465` 用 `random.randint(1, 100)` 与累计权重比较。")
    add("权重合计不足 100 时，剩余区间会落到 `draw_single_card` 末尾的 fallback：")
    add("从“所有非空稀有度”里随机挑一个，即一个未被配置描述的随机结果。")
    add("新版按 PLAN 第 6 节改为浮点累计权重统一采样，并把口径写进配置。")
    add("")

    if shops.get("available"):
        add("## 5.5 商店与融合配置")
        add("")
        normal = shops["normalShop"]
        activity = shops["activityShop"]
        add("### 常规商店价格（按稀有度）")
        add("")
        add("| 稀有度 | 货币 | 价格 |")
        add("| --- | --- | --- |")
        for rarity in RARITY_DIRS:
            rule = normal["priceByRarity"].get(rarity)
            if rule:
                add(f"| {rarity} | {rule['currency']} | {rule['amount']} |")
        add(
            f"| 其他 | {normal['unknownRarityFallback']['currency']} | "
            f"{normal['unknownRarityFallback']['amount']} |"
        )
        add("")
        add("货架（`allow_repeat` 为真表示同一张卡可以出现多次）：")
        add("")
        add("| 货架 | 标签 | 稀有度 | 数量 | 允许重复 |")
        for name, shelf in normal["shelves"].items():
            add(
                f"| {name} | {shelf.get('label', '—')} | {'、'.join(shelf.get('rarities', ()))} | "
                f"{shelf.get('count_range')} | {'是' if shelf.get('allow_repeat') else '否'} |"
            )
        add("")
        add("| 礼包 | 稀有度 | 货币 | 价格 | 界面说明 |")
        add("| --- | --- | --- | --- | --- |")
        for pack in normal["packs"]:
            add(
                f"| {pack['name']} | {pack['rarity']} | {pack['currency']} | "
                f"{pack['amount']} | {pack['note']} |"
            )
        add("")
        add("### 活动商店价格（按稀有度，货币为徽章）")
        add("")
        add("| 稀有度 | 价格 |")
        add("| --- | --- |")
        for rarity in list(EVENT_DIRS) + RARITY_DIRS:
            rule = activity["priceByRarity"].get(rarity)
            if rule:
                add(f"| {rarity} | {rule} |")
        add(f"| 其他 | {activity['unknownRarityFallback']['amount']} |")
        add("")
        add("| 货架 | 标签 | 稀有度 | 数量 | 允许重复 |")
        add("| --- | --- | --- | --- | --- |")
        for name, shelf in activity["shelves"].items():
            add(
                f"| {name} | {shelf.get('label', '—')} | {'、'.join(shelf.get('rarities', ()))} | "
                f"{shelf.get('count_range')} | {'是' if shelf.get('allow_repeat') else '否'} |"
            )
        add("")
        add("### 每日刷新")
        add("")
        add(f"- 常规商店：种子 = `{normal['refresh']['seedDerivation']}`，跨进程可复现")
        add(
            f"- 活动商店：种子 = `{activity['refresh']['seedDerivation']}`，"
            "**不可复现**（依赖 Python 进程随机化哈希）"
        )
        add("")
        fusion = shops["fusion"]
        add("### 工坊融合")
        add("")
        add(f"- 祭坛槽位：{fusion['altarSlots']}；货币消耗：{fusion['currencyCost']}（成本是投入的卡本身）")
        add(f"- 分布规则：{fusion['distributionRule']}")
        add(f"- 展示概率与实际抽取是否一致：{'是' if fusion['displayMatchesDraw'] else '否'}")
        add(f"- 稀有度顺序：{'、'.join(fusion['rarityOrder'])}")
        add("")
        add("### 旧版行为缺陷（不照搬，由 P5 决策新语义）")
        add("")
        add("| 范围 | 问题 | 证据 | 新版处理 |")
        add("| --- | --- | --- | --- |")
        for issue in shops["knownIssues"]:
            add(
                f"| {issue['area']} | {issue['issue']} | `{issue['evidence']}` | "
                f"{issue['newVersionDecision']} |"
            )
        add("")

    add("## 6. 牌组")
    add("")
    add(f"组卡上限 {MAX_DECK_SIZE}，但旧版**战斗不校验上限**（`SB:159-191` 照读 JSON），")
    add("只有组卡界面强制。下表按实际数据列出，不擅自裁剪。")
    add("")
    add("| 牌组 | 张数 | 不同的卡 | 无法映射 | 备注 |")
    add("| --- | --- | --- | --- | --- |")
    for stage_id, deck in sorted(decks["enemy"].items()):
        add(
            f"| 敌方 {stage_id} | {deck['size']} | {deck['distinct']} | "
            f"{len(deck['unknown'])} | {'、'.join(deck['notes']) or '—'} |"
        )
    if decks["demo"]:
        add(
            f"| 演示牌组 | {decks['demo']['size']} | {decks['demo']['distinct']} | "
            f"{len(decks['demo']['unknown'])} | {'、'.join(decks['demo']['notes']) or '—'} |"
        )
    add("")
    add(f"基线：每方 {BATTLE_BASELINE['battleSlotsPerSide']} 个战斗槽、")
    add(f"{BATTLE_BASELINE['prepSlotsPerSide']} 个准备槽、基础生命 {BATTLE_BASELINE['baseHp']}、")
    add(f"开局各抽 {BATTLE_BASELINE['openingDraw']} 张。")
    add("")

    if slice_data:
        add("## 6.5 切片与演示牌组")
        add("")
        add(
            f"切片共 {slice_data['count']} 张（施工清单要求 16–24 张），"
            f"覆盖 {len(slice_data['familiesCovered'])} 个族 + "
            f"{'飞行' if any('飞行' in c['sceneRules'] for c in slice_data['cards']) else '无场景规则'}。"
        )
        add("")
        add("| cardId | 稀有度 | ATK/HP/CD | traits | 挑选理由 |")
        add("| --- | --- | --- | --- | --- |")
        for card in slice_data["cards"]:
            traits = "、".join(card["rawTraits"]) or "—"
            add(
                f"| {card['cardId']} | {card['rarity']} | "
                f"{card['atk']}/{card['hp']}/{card['cd']} | {traits} | {card['why']} |"
            )
        add("")
        add("| 牌组 | 张数 | 用途 |")
        add("| --- | --- | --- |")
        for deck in slice_data["decks"]:
            add(f"| {deck['name']} | {deck['size']} | {deck['purpose']} |")
        add("")
        add("| 场景 | 目标 | 覆盖 |")
        add("| --- | --- | --- |")
        for scenario in slice_data["scenarios"]:
            add(
                f"| {scenario['id']} | {scenario['goal']} | "
                f"{'、'.join(scenario['coversNames'])} |"
            )
        add("")
        add(
            "切片**未覆盖**的族（留给 P4，本轮不为其造数据）："
            f"{'、'.join(FAMILY_NAMES.get(f, f) for f in slice_data['familiesMissing'])}。"
        )
        add("")

    add("## 7. 严格未识别 trait 清单")
    add("")
    add("以下 trait 未被技能注册表命中，也未登记为场景规则。它们**不作为**默认补做需求。")
    add("分类证据见 `docs/SKILL_COVERAGE.md`。")
    add("")
    unresolved = sorted(
        {
            s["raw"]
            for d in cards_payload["definitions"]
            for s in d["skills"]
            if s["resolution"] in ("ambiguous", "unimplemented", "alias", "flavor")
        }
    )
    for trait in unresolved:
        add(f"- {trait}")
    add("")

    add("## 8. 问题与差异")
    add("")
    if problems:
        for item in problems:
            add(f"- {item}")
    else:
        add("无。")
    add("")

    add("## 9. 可重复性")
    add("")
    add("本报告与 `src/data/*.json` 都由同一份旧数据确定性地生成，不包含时间戳或随机数。")
    add("`python scripts/import-legacy-data.py --check` 会在有差异时以退出码 1 结束；")
    add("本次运行与磁盘的差异只打印到标准输出，不写进本文件——")
    add("否则报告内容会依赖自己上一次的写入结果，`--check` 永远无法稳定通过。")
    add("")

    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------


def main() -> int:
    # Windows 控制台默认不是 UTF-8，中文报告会显示成乱码。
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--legacy-root",
        type=Path,
        default=DEFAULT_LEGACY_ROOT,
        help="旧项目根目录（只读）",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="只重新生成并比对，不写盘；有差异则退出码 1",
    )
    args = parser.parse_args()

    legacy: Path = args.legacy_root
    if not legacy.exists():
        print(f"找不到旧项目目录: {legacy}", file=sys.stderr)
        return 2

    problems: list[str] = []
    overlay = load_trait_overlay(problems)

    cards_payload = load_cards(legacy, overlay, problems)
    # 内容规则（自毁卡 hp=0）必须在校验之前套上，否则校验会按旧值放行/报错
    self_destruct_zeroed = apply_content_rules(cards_payload)
    validation = validate_cards(cards_payload, problems)
    card_ids = {d["cardId"] for d in cards_payload["definitions"]}
    stages = load_stages(legacy, problems)
    gacha = load_gacha(legacy, problems)
    decks = load_decks(legacy, card_ids, problems)
    slice_data = load_slice(cards_payload["definitions"], problems)
    shops = load_shops(legacy, problems)

    # P0-9：所有被引用的 cardId 必须真实存在
    for pool in gacha.get("pools", []):
        for cid in pool["showcaseCards"]:
            if cid not in card_ids:
                problems.append(f"卡池 {pool['id']} 展示位引用了不存在的 {cid}")

    definitions = cards_payload["definitions"]
    content_version = stable_hash(
        [{k: v for k, v in d.items() if k != "art"} for d in definitions]
    )[:12]

    outputs: dict[Path, Any] = {
        DATA_OUT / "cards.json": {
            "contentVersion": content_version,
            "source": "assets/outputs/*/cards.json",
            "definitions": definitions,
        },
        DATA_OUT / "rarities.json": {"rarities": cards_payload["perRarity"]},
        DATA_OUT / "stages.json": stages,
        DATA_OUT / "gacha-pools.json": gacha,
        DATA_OUT / "shops.json": shops,
        DATA_OUT / "decks.json": decks,
        DATA_OUT / "incomplete-cards.json": cards_payload["incomplete"],
        **(
            {DATA_OUT / "slice.json": slice_data}
            if slice_data is not None
            else {}
        ),
        DATA_OUT / "battle-baseline.json": {
            **BATTLE_BASELINE,
            "cardsPerTurn": 1,
            "note": "来自 scenes/battle/battle_base_scene.py 的静态核查，P2 用样例对局复核",
        },
    }

    # `changed` 既决定写盘，也会被渲染进报告正文，所以两种模式必须用
    # **同一条**判定路径算出同一个列表；否则 --check 与写入模式的报告
    # 内容本身会不一致，--check 永远失败。
    changed: list[str] = []
    json_changed: list[str] = []
    for path, payload in outputs.items():
        rel = str(path.relative_to(TARGET_ROOT)).replace("\\", "/")
        expected = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        if args.check:
            existing = path.read_text(encoding="utf-8") if path.exists() else None
            if existing != expected:
                json_changed.append(rel)
        elif write_json(path, payload):
            json_changed.append(rel)

    report_path = REPORT_OUT
    # 报告内容只依赖数据本身，不依赖“本次哪些文件有差异”，否则会自我引用。
    report_expected = render_report(
        cards_payload,
        validation,
        stages,
        gacha,
        decks,
        slice_data,
        shops,
        problems,
        self_destruct_zeroed,
    )
    existing_report = (
        report_path.read_text(encoding="utf-8") if report_path.exists() else None
    )
    report_differs = existing_report != report_expected
    if not args.check and report_differs:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(report_expected, encoding="utf-8", newline="\n")

    changed = json_changed + (["docs/import-report.md"] if report_differs else [])

    print(f"卡牌: {validation['total']} 条"
          f"（完整 {validation['complete']} / 不完整 {validation['incomplete']}）")
    print(f"trait 字符串: {validation['distinctTraits']} 种")
    print(f"关卡: {sum(len(c['stages']) for c in stages['chapters'])} 关")
    print(f"卡池: {len(gacha.get('pools', []))} 个")
    if problems:
        print(f"\n发现 {len(problems)} 个问题：")
        for item in problems:
            print(f"  - {item}")
    if args.check:
        if changed:
            print(f"\n--check 失败：{len(changed)} 个输出与磁盘不一致")
            for item in changed:
                print(f"  - {item}")
            return 1
        print("\n--check 通过：输出与磁盘一致")
        return 0

    if changed:
        print(f"\n写入 {len(changed)} 个文件")
    else:
        print("\n输出已是最新，无改动")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
