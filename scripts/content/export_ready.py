#!/usr/bin/env python3
"""Splint Content Factory — export APPROVED templates to import-ready bundle.

Usage:
  python scripts/content/export_ready.py

Reads derived-manifest.jsonl, collects entries with state == APPROVED,
writes data/content/import-ready/manifest.json + previews. Does NOT touch
production catalog — import is a separate explicit step.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "content"))

from content_lib import load_jsonl, now_utc  # noqa: E402

DERIVED = ROOT / "data" / "content" / "derived-manifest.jsonl"
SOURCES = ROOT / "data" / "content" / "source-manifest.jsonl"
OUT = ROOT / "data" / "content" / "import-ready"


def main() -> None:
    sources = load_jsonl(SOURCES)
    source_by_id = {s["source_asset_id"]: s for s in sources}
    derived = load_jsonl(DERIVED)
    approved = [d for d in derived if d.get("state") == "APPROVED"]

    if not approved:
        print("[export] no APPROVED entries; nothing to export")
        return

    OUT.mkdir(parents=True, exist_ok=True)
    bundle = []
    for entry in approved:
        src = source_by_id.get(entry["source_asset_id"], {})
        template = entry.get("template")
        if not template:
            continue
        bundle.append(
            {
                "id": f"color_{entry['derived_asset_id']}",
                "title": src.get("title_ru") or src.get("source_title") or entry["derived_asset_id"],
                "description": src.get("description_ru", ""),
                "category": (src.get("themes") or ["general"])[0],
                "difficulty": entry.get("difficulty", "NORMAL"),
                "width": template["width"],
                "height": template["height"],
                "palette": template["palette"],
                "cells": template["cells"],
                "provenance": {
                    "source_asset_id": entry["source_asset_id"],
                    "derived_asset_id": entry["derived_asset_id"],
                    "pipeline_version": entry.get("pipeline_version", "?"),
                    "license_type": src.get("license_type"),
                    "license_url": src.get("license_url"),
                    "source_url": src.get("source_url"),
                    "attribution_required": src.get("attribution_required", False),
                },
            }
        )

    (OUT / "manifest.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[export] {len(bundle)} APPROVED templates -> data/content/import-ready/manifest.json")


if __name__ == "__main__":
    main()
