#!/usr/bin/env python3
"""Splint Content Factory — curated approval selection.

Selects the final APPROVED set from CONVERTED candidates:
* at most `max_per_source` candidates per source (best score wins);
* per-tier caps to keep a balanced catalog (small/medium/large/masterpiece);
* requires score >= threshold and no rejection signals;
* writes human-editable review-decisions.jsonl (APPROVED only).
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "content"))

from content_lib import load_jsonl, save_jsonl  # noqa: E402

DERIVED = ROOT / "data" / "content" / "derived-manifest.jsonl"
OUT = ROOT / "data" / "content" / "review-decisions.jsonl"

TIER_CAPS = {
    "12-32": 20,
    "32-64": 20,
    "96-192": 20,
    "256-512": 15,
    "600+": 15,
}


def tier_of(grid: int) -> str:
    if grid <= 32:
        return "12-32"
    if grid <= 64:
        return "32-64"
    if grid <= 192:
        return "96-192"
    if grid <= 512:
        return "256-512"
    return "600+"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, default=58.0)
    parser.add_argument("--max-per-source", type=int, default=1)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    derived = load_jsonl(DERIVED)
    candidates = [
        e for e in derived
        if e.get("state") == "CONVERTED"
        and e.get("score", 0) >= args.threshold
        and not e.get("playability", {}).get("rejection_signals")
    ]
    # Prefer larger grids within a source when scores are close (more play value).
    for e in candidates:
        e["_key"] = (e["score"], e["grid_width"])

    by_source: dict[str, list] = defaultdict(list)
    for e in candidates:
        by_source[e["source_asset_id"]].append(e)

    # Phase 1: best per source (max variety).
    selected: list[dict] = []
    for source, entries in by_source.items():
        entries.sort(key=lambda x: (-x["score"], -x["grid_width"]))
        selected.extend(entries[:1])

    # Phase 2: fill tier caps with additional grids (max_per_source total).
    per_source_count: dict[str, int] = defaultdict(int)
    for e in selected:
        per_source_count[e["source_asset_id"]] += 1
    by_tier: dict[str, list] = defaultdict(list)
    for e in selected:
        by_tier[tier_of(e["grid_width"])].append(e)
    for tier in by_tier:
        by_tier[tier].sort(key=lambda x: -x["score"])

    # Fill each tier to its cap from remaining candidates.
    remaining = sorted(
        [e for e in candidates if e not in selected],
        key=lambda x: (-x["score"], -x["grid_width"]),
    )
    for tier, cap in TIER_CAPS.items():
        have = len(by_tier.get(tier, []))
        for e in remaining:
            if have >= cap:
                break
            if tier_of(e["grid_width"]) != tier:
                continue
            if per_source_count[e["source_asset_id"]] >= args.max_per_source:
                continue
            by_tier[tier].append(e)
            per_source_count[e["source_asset_id"]] += 1
            have += 1

    final: list[dict] = []
    for tier, cap in TIER_CAPS.items():
        final.extend(by_tier.get(tier, [])[:cap])

    decisions = [
        {
            "id": e["derived_asset_id"],
            "decision": "APPROVED",
            "notes": f"curated: score {e['score']}, tier {tier_of(e['grid_width'])}, source {e['source_asset_id']}",
        }
        for e in final
    ]

    from collections import Counter

    tier_counts = Counter(tier_of(e["grid_width"]) for e in final)
    print(f"[curate] selected {len(final)} of {len(candidates)} candidates")
    for tier in TIER_CAPS:
        print(f"  {tier}: {tier_counts.get(tier, 0)}")

    if args.write:
        save_jsonl(OUT, decisions)
        print(f"[curate] wrote {OUT}")


if __name__ == "__main__":
    main()
