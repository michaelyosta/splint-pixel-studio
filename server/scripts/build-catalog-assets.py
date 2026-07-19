from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageEnhance


ROOT = Path(__file__).resolve().parents[2]
ASSET_ROOT = ROOT / "public" / "assets" / "catalog"
OUTPUT = ROOT / "server" / "catalog-templates.json"

CATALOG = [
    {
        "id": "color_neon-cat",
        "file": "neon-cat.png",
        "title": "Неоновый кот",
        "description": "Лунный страж над огнями ночного города.",
        "category": "animals",
        "difficulty": "easy",
        "size": 32,
        "colors": 10,
    },
    {
        "id": "color_astro-whale",
        "file": "astro-whale.png",
        "title": "Космический кит",
        "description": "Добрый путешественник среди планет и звёзд.",
        "category": "space",
        "difficulty": "easy",
        "size": 28,
        "colors": 9,
    },
    {
        "id": "color_tea-dragon",
        "file": "tea-dragon.png",
        "title": "Чайный дракон",
        "description": "Уютное утро маленького хранителя чашки.",
        "category": "fantasy",
        "difficulty": "medium",
        "size": 32,
        "colors": 10,
    },
    {
        "id": "color_alpine-train",
        "file": "alpine-train.png",
        "title": "Альпийский экспресс",
        "description": "Красный паровоз отправляется навстречу вершинам.",
        "category": "travel",
        "difficulty": "medium",
        "size": 32,
        "colors": 10,
    },
    {
        "id": "color_lantern-fox",
        "file": "lantern-fox.png",
        "title": "Лис с фонарём",
        "description": "Тёплый огонёк в глубине волшебного леса.",
        "category": "animals",
        "difficulty": "medium",
        "size": 32,
        "colors": 10,
    },
    {
        "id": "color_coral-jellyfish",
        "file": "coral-jellyfish.png",
        "title": "Коралловая медуза",
        "description": "Биолюминесцентное сияние подводного сада.",
        "category": "ocean",
        "difficulty": "hard",
        "size": 32,
        "colors": 9,
    },
]


def build_template(item: dict) -> dict:
    source = Image.open(ASSET_ROOT / item["file"]).convert("RGB")
    source = ImageEnhance.Color(source).enhance(1.08)
    source = ImageEnhance.Contrast(source).enhance(1.08)
    pixel = source.resize((item["size"], item["size"]), Image.Resampling.BOX)
    quantized = pixel.quantize(
        colors=item["colors"],
        method=Image.Quantize.MAXCOVERAGE,
        dither=Image.Dither.NONE,
    )

    raw_palette = quantized.getpalette()[: item["colors"] * 3]
    palette = [tuple(raw_palette[index : index + 3]) for index in range(0, len(raw_palette), 3)]
    order = sorted(range(len(palette)), key=lambda index: sum(palette[index]))
    remap = {old: new for new, old in enumerate(order)}
    ordered_palette = [palette[index] for index in order]
    cells = [remap[value] for value in quantized.get_flattened_data()]

    exact = Image.new("RGB", (item["size"], item["size"]))
    exact.putdata([ordered_palette[index] for index in cells])
    preview_name = item["file"].replace(".png", "-pixel.png")
    exact.resize((512, 512), Image.Resampling.NEAREST).save(ASSET_ROOT / preview_name, optimize=True)

    return {
        "id": item["id"],
        "title": item["title"],
        "description": item["description"],
        "category": item["category"],
        "difficulty": item["difficulty"],
        "width": item["size"],
        "height": item["size"],
        "palette": [f"#{red:02x}{green:02x}{blue:02x}" for red, green, blue in ordered_palette],
        "cells": cells,
        "preview": f"/assets/catalog/{preview_name}",
    }


OUTPUT.write_text(json.dumps([build_template(item) for item in CATALOG], ensure_ascii=False), encoding="utf-8")
print(f"Built {len(CATALOG)} catalog templates at {OUTPUT}")
