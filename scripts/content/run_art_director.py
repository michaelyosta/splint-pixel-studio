#!/usr/bin/env python3
"""Splint Content Art Director — run the full catalog through the new funnel.

For every source in the manifest:
  1. source_quality (is it inherently good for number coloring?)
  2. select_resolutions (best ONE or TWO grid sizes, subject-aware crop)
  3. writes artwork-family records to data/content/artwork-families.jsonl

An artwork family = one source + its chosen resolutions. Size variants are
NOT separate catalog entries anymore.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "content"))

from content_lib import load_jsonl, save_jsonl, now_utc  # noqa: E402
from art_director import select_resolutions, source_quality  # noqa: E402

SOURCES = ROOT / "data" / "content" / "source-manifest.jsonl"
OUT = ROOT / "data" / "content" / "artwork-families.jsonl"


def main() -> None:
    sources = load_jsonl(SOURCES)
    print(f"[art-director] {len(sources)} sources", flush=True)

    families = []
    t0 = time.time()
    for i, src in enumerate(sources):
        path = src.get("source_file_path")
        if not path or not Path(path).exists():
            print(f"  [{i}] {src['source_asset_id']}: SKIP (no file)", flush=True)
            continue
        tier = src.get("content_tier", "medium")
        try:
            sq = source_quality(path)
            chosen = select_resolutions(path, tier)
        except Exception as exc:  # noqa: BLE001
            print(f"  [{i}] {src['source_asset_id']}: ERROR {exc}", flush=True)
            continue
        family = {
            "source_asset_id": src["source_asset_id"],
            "source_title": src.get("source_title", ""),
            "license_type": src.get("license_type"),
            "license_verdict": src.get("license_verdict"),
            "content_tier": tier,
            "themes": src.get("themes", []),
            "source_quality": sq,
            "chosen_resolutions": [
                {
                    "grid": c["grid"],
                    "gate_score": c["gate_score"],
                    "source_quality": c["source_quality"],
                    "conversion_quality": c["conversion_quality"],
                    "game_quality": c["game_quality"],
                    "edge_preservation": c["edge_preservation"],
                    "background_ratio": c["background_ratio"],
                    "difficulty": c["difficulty"],
                    "estimated_taps": c["estimated_taps"],
                    "notes": c["sq_notes"] + c["cq_notes"] + c["gq_notes"],
                    "template": c["template"],
                    "crop_bbox": c["bbox"],
                }
                for c in chosen
            ],
            "state": "DIRECTED",
            "directed_at": now_utc(),
        }
        families.append(family)
        if (i + 1) % 25 == 0 or i == len(sources) - 1:
            elapsed = time.time() - t0
            print(f"  [{i+1}/{len(sources)}] {len(families)} families, {elapsed:.0f}s", flush=True)
            save_jsonl(OUT, families)  # incremental

    save_jsonl(OUT, families)
    with_res = [f for f in families if f["chosen_resolutions"]]
    print(f"\n[art-director] {len(families)} families, {len(with_res)} with >=1 resolution")
    grids = [c["grid"] for f in with_res for c in f["chosen_resolutions"]]
    if grids:
        print(f"resolutions chosen: {len(grids)} for {len(with_res)} artworks "
              f"(avg {len(grids)/max(1,len(with_res)):.2f} per family)")


if __name__ == "__main__":
    main()
