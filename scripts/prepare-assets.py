#!/usr/bin/env python3
"""素材盘点、派生纹理与安全 URL manifest（施工清单 P0-13 / P0-14 / P0-15）。

职责边界
--------
只读取 `--legacy-root`（默认 `D:\\Github\\card_maker`），写入 `public/assets/`、
`src/data/assets.manifest.json` 与 `assets-sources.json`。
不修改原项目目录，不覆盖原素材（派生结果一律落到新目录）。

默认只派生**切片**需要的纹理（P0 范围），`--all` 派生全部 247 张有效卡的卡面
（P5/P7 用）。共享资源（卡背、图标、技能图、海报、背景）在默认模式下也会处理，
因为它们数量小且 P1 就要用。

URL 安全
--------
旧路径里有三类会破坏 URL 或容易出错的字符，全部规范化：

- `#`（`#elna`、`#yoroi`、`#YAZIRI`）会被当作 URL 片段分隔符
- `+`（`SS+`、`A+`）在查询串里表示空格
- 空格与中文（`DLXXXI 581.jpg`、`二代/元素师卡包/元素师 勇气.png`、`铁血王座.png`）

处理方式：卡面与卡背走**纯 ASCII 的稀有度 slug + 编号**
（`card/ss-plus/002`），中文/空格/特殊字符的名字走 `urllib.parse.quote`，
并在 manifest 里同时记录 `sourceName`，保证可追溯。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import quote

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    print("需要 Pillow：pip install Pillow", file=sys.stderr)
    raise SystemExit(2)

DEFAULT_LEGACY_ROOT = Path(r"D:\Github\card_maker")
TARGET_ROOT = Path(__file__).resolve().parent.parent
PUBLIC = TARGET_ROOT / "public" / "assets"
MANIFEST_PATH = TARGET_ROOT / "src" / "data" / "assets.manifest.json"
SOURCES_PATH = TARGET_ROOT / "assets-sources.json"

# 三档长边（PLAN 第 5 节 / VISUAL_SPEC V-PERF-4）
TIERS = {
    "thumbnail": 384,
    "battle": 768,
    "detail": 1536,
}

# 与 scripts/import-legacy-data.py 的 RARITY_SLUG 保持一致
RARITY_SLUG = {
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

# 只盘点、不进入本轮战斗的目录（原画素材里存在但游戏数据不加载）
ART_ONLY_DIRS = ["#YAZIRI", "二代"]

WEBP_QUALITY = 88
WEBP_METHOD = 6  # 确定性：同输入同输出


def safe_name(name: str) -> str:
    """把任意文件名规范化成 URL 安全的形式。

    空格与 `#`/`+` 是真正会出问题的字符（片段分隔符、查询串空格），
    中文与其余符号用百分号编码，浏览器可直接使用。
    """
    stem = Path(name).stem
    return quote(stem, safe="-_.")


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def convert(src: Path, dst: Path, long_edge: int) -> dict[str, object]:
    """生成一张派生图，返回尺寸与字节数。若结果已存在则跳过实际写入。"""
    with Image.open(src) as img:
        src_size = img.size
        img = img.convert("RGBA") if img.mode in ("P", "LA", "RGBA") else img.convert("RGB")
        scale = long_edge / max(img.size)
        if scale < 1.0:
            new_size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
            img = img.resize(new_size, Image.LANCZOS)
        ensure_parent(dst)
        img.save(dst, "WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD)
        out_size = img.size
    return {
        "sourceSize": list(src_size),
        "size": list(out_size),
        "bytes": dst.stat().st_size,
    }


def url_for(path: Path) -> str:
    """public/ 下的文件转成站点绝对路径。"""
    rel = path.relative_to(TARGET_ROOT / "public")
    return "/" + rel.as_posix()


def collect_slice_ids() -> set[str]:
    slice_path = TARGET_ROOT / "src" / "data" / "slice.json"
    if not slice_path.exists():
        return set()
    payload = json.loads(slice_path.read_text(encoding="utf-8"))
    return {card["cardId"] for card in payload.get("cards", [])}


def prepare_card_faces(
    legacy: Path, ids: set[str] | None, problems: list[str]
) -> tuple[dict[str, object], dict[str, int]]:
    """派生卡面三档。ids 为 None 时处理全部有效卡。"""
    outputs_dir = legacy / "assets" / "outputs"
    art_dir = legacy / "assets" / "cards"
    cards: dict[str, object] = {}
    tier_totals = {tier: 0 for tier in TIERS}

    for rarity, slug in RARITY_SLUG.items():
        rdir = outputs_dir / rarity
        if not rdir.exists():
            continue
        for src in sorted(rdir.glob("*.png")):
            card_id = f"{rarity}_{src.stem}"
            # #yoroi 是未完成卡，只在 --all 时留档
            if ids is not None and card_id not in ids:
                continue

            entry: dict[str, object] = {
                "artId": f"card/{slug}/{src.stem}",
                "rarity": rarity,
                "sourceName": src.name,
                "face": {},
            }
            for tier, long_edge in TIERS.items():
                dst = PUBLIC / "card" / tier / slug / f"{src.stem}.webp"
                # thumbnail 也供 3D 使用不合适，这里只做存在性/尺寸统计
                info = convert(src, dst, long_edge)
                tier_totals[tier] += int(info["bytes"])
                entry["face"][tier] = {
                    "url": url_for(dst),
                    **info,
                }

            # 原画：assets/cards/<rarity>/<id>.jpg|png，可能缺失
            art_entry = None
            for ext in (".jpg", ".png", ".jpeg", ".webp"):
                candidate = art_dir / rarity / f"{src.stem}{ext}"
                if candidate.exists():
                    dst = PUBLIC / "art" / slug / f"{src.stem}.webp"
                    info = convert(candidate, dst, TIERS["detail"])
                    art_entry = {
                        "url": url_for(dst),
                        "sourceName": candidate.name,
                        **info,
                    }
                    break
            if art_entry is None:
                problems.append(f"{card_id} 没有原画（assets/cards/{rarity}/），只用成品卡面")
            entry["art"] = art_entry

            cards[card_id] = entry

    if ids is not None:
        missing = sorted(ids - set(cards))
        for card_id in missing:
            problems.append(f"切片卡 {card_id} 没有找到对应的成品卡面 PNG")

    return cards, tier_totals


def prepare_shared(legacy: Path, problems: list[str]) -> dict[str, object]:
    """处理卡背、图标、技能图、海报、背景。"""
    assets = legacy / "assets"
    shared: dict[str, object] = {"ui": {}, "skill": {}, "poster": {}, "bg": {}, "menu": {}}

    # 卡背与图标
    for src in sorted((assets / "ui").glob("*")):
        if src.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
            continue
        long_edge = 1024 if src.stem == "card_back" else 256
        dst = PUBLIC / "ui" / f"{safe_name(src.name)}.webp"
        info = convert(src, dst, long_edge)
        shared["ui"][src.stem] = {"url": url_for(dst), "sourceName": src.name, **info}

    if "card_back" in shared["ui"]:
        shared["cardBack"] = shared["ui"]["card_back"]["url"]

    # 技能图标
    for src in sorted((assets / "skill").glob("*.png")):
        dst = PUBLIC / "skill" / f"{safe_name(src.name)}.webp"
        info = convert(src, dst, 256)
        shared["skill"][src.stem] = {"url": url_for(dst), "sourceName": src.name, **info}

    # 关卡海报（长边 768 够用）
    for src in sorted((assets / "poster").glob("*")):
        if src.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
            continue
        dst = PUBLIC / "poster" / f"{safe_name(src.name)}.webp"
        info = convert(src, dst, 768)
        shared["poster"][src.stem] = {"url": url_for(dst), "sourceName": src.name, **info}

    # 背景（数量少，长边 1536）
    for src in sorted((assets / "bg").glob("*")):
        if src.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
            continue
        dst = PUBLIC / "bg" / f"{safe_name(src.name)}.webp"
        info = convert(src, dst, TIERS["detail"])
        shared["bg"][src.stem] = {"url": url_for(dst), "sourceName": src.name, **info}

    # 菜单背景
    for name in ("menu_bg.jpg", "battle_bg.png", "battle_menu_bg.png"):
        src = assets / name
        if src.exists():
            dst = PUBLIC / "bg" / f"{safe_name(name)}.webp"
            info = convert(src, dst, TIERS["detail"])
            shared["menu"][src.stem] = {"url": url_for(dst), "sourceName": src.name, **info}

    return shared


def build_manifest(
    legacy: Path, cards: dict[str, object], shared: dict[str, object], tier_totals: dict[str, int]
) -> dict[str, object]:
    content = json.dumps(cards, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return {
        "generatedBy": "scripts/prepare-assets.py",
        "legacyRoot": str(legacy),
        "contentVersion": hashlib.sha256(content.encode("utf-8")).hexdigest()[:12],
        "tiers": TIERS,
        "tierBytes": tier_totals,
        "tierMiB": {k: round(v / 1048576, 2) for k, v in tier_totals.items()},
        "cards": cards,
        "shared": shared,
        "notes": [
            "卡面与卡背使用纯 ASCII 的稀有度 slug + 编号，路径里不含 # 或 +。",
            "中文/空格/特殊字符的共享素材用百分号编码，sourceName 保留原文件名以便追溯。",
            "卡面三档长边为 thumbnail/battle/detail，保持原始比例。",
            "detail 档只在打开详情时加载，图鉴用 thumbnail 分页加载。",
            "旧项目 assets/cards 中存在但游戏数据未加载的目录（#YAZIRI、二代）不进入 manifest。",
        ],
    }


def build_sources(legacy: Path, shared: dict[str, object]) -> dict[str, object]:
    """素材来源与许可登记（施工清单 P0-15）。"""
    return {
        "$comment": "素材来源、许可与转换产物登记。由 scripts/prepare-assets.py 生成。",
        "policy": [
            "优先使用原项目素材与自制程序几何/Shader。",
            "第三方素材只用 CC0，下载后本地化，发布产物不依赖第三方 CDN。",
            "GPL 素材只作视觉参考，不复制其源码或插画。",
            "本轮规划阶段不批量下载第三方素材；下表 marked 字段记录实际状态。",
        ],
        "legacy": {
            "root": str(legacy),
            "license": "项目自有素材（由用户提供的原项目）",
            "used": {
                "assets/outputs": "成品卡面（已烘焙边框与名称），卡面三档的来源",
                "assets/cards": "原画，后续重排卡框时使用；本轮只做三档派生",
                "assets/ui": f"卡背与图标，共 {len(shared.get('ui', {}))} 项",
                "assets/skill": f"技能图标，共 {len(shared.get('skill', {}))} 项",
                "assets/poster": f"关卡与章节海报，共 {len(shared.get('poster', {}))} 项",
                "assets/bg": f"背景图，共 {len(shared.get('bg', {}))} 项",
            },
            "excluded": [
                "build/、dist/、__pycache__/：打包与缓存产物，不复制",
                "assets/cards/#YAZIRI、assets/cards/二代：原画里存在但游戏数据未加载",
                "assets/cards 下的零散 jpg（如 DLXXXI 581.jpg）：未与任何 cardId 关联",
            ],
            "unmapped": [
                "assets/cards 下未关联到 cardId 的散图（含中文名与空格名）",
            ],
        },
        "thirdParty": [
            {
                "name": "Poly Haven",
                "url": "https://polyhaven.com/license",
                "license": "CC0",
                "purpose": "HDRI、桌面/石材 PBR、少量装饰模型",
                "marked": "not-downloaded",
                "note": "施工时按需下载适当分辨率并本地化到 public/assets/env/",
            },
            {
                "name": "Kenney Particle Pack",
                "url": "https://kenney.nl/assets/particle-pack",
                "license": "CC0（页面标记）",
                "purpose": "火花、烟、星光等粒子图集",
                "marked": "not-downloaded",
                "note": "整理成图集后本地加载，不使用在线地址",
            },
            {
                "name": "pokemon-cards-css",
                "url": "https://github.com/simeydotme/pokemon-cards-css",
                "license": "GPL-3.0",
                "purpose": "全息表现的视觉参考",
                "marked": "reference-only",
                "note": "只参考反光/闪点/色带的视觉规律，不复制其源码实现，也不使用 Pokémon 插画",
            },
        ],
        "selfMade": [
            "卡框、法阵、冰晶、护盾、电弧等程序几何与自有 Shader",
            "自有全息 Shader（V-HOLO-1..4）",
        ],
    }


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--legacy-root", type=Path, default=DEFAULT_LEGACY_ROOT)
    parser.add_argument("--all", action="store_true", help="派生全部卡面（默认只派生切片）")
    parser.add_argument("--check", action="store_true", help="只比对 manifest，不写盘")
    args = parser.parse_args()

    legacy: Path = args.legacy_root
    if not legacy.exists():
        print(f"找不到旧项目目录: {legacy}", file=sys.stderr)
        return 2
    if not (legacy / "assets" / "outputs").exists():
        print(f"{legacy} 下没有 assets/outputs", file=sys.stderr)
        return 2

    problems: list[str] = []
    ids = None if args.all else collect_slice_ids()
    if ids is not None and not ids:
        problems.append(
            "没有找到 src/data/slice.json，先运行 scripts/import-legacy-data.py；"
            "本次将不派生任何卡面"
        )

    scope = "全部卡牌" if ids is None else f"切片 {len(ids)} 张"
    print(f"派生范围：{scope}")

    cards, tier_totals = prepare_card_faces(legacy, ids, problems)
    shared = prepare_shared(legacy, problems)
    manifest = build_manifest(legacy, cards, shared, tier_totals)
    sources = build_sources(legacy, shared)

    if args.check:
        existing = (
            json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
            if MANIFEST_PATH.exists()
            else None
        )
        if existing != manifest:
            print("--check 失败：manifest 与磁盘内容不一致", file=sys.stderr)
            return 1
        print("--check 通过")
        return 0

    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    SOURCES_PATH.write_text(
        json.dumps(sources, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )

    print(f"卡面条目：{len(cards)}")
    for tier, mib in manifest["tierMiB"].items():
        print(f"  {tier:10s} 合计 {mib} MiB")
    print(f"共享素材：ui {len(shared['ui'])}、skill {len(shared['skill'])}、"
          f"poster {len(shared['poster'])}、bg {len(shared['bg'])}")
    print(f"写入 {MANIFEST_PATH.relative_to(TARGET_ROOT)} 与 "
          f"{SOURCES_PATH.relative_to(TARGET_ROOT)}")

    if problems:
        print(f"\n提示 {len(problems)} 条：")
        for item in problems[:20]:
            print(f"  - {item}")
        if len(problems) > 20:
            print(f"  …另有 {len(problems) - 20} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
