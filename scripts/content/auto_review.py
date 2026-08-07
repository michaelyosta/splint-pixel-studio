#!/usr/bin/env python3
"""Splint Content Factory — auto-review: propose APPROVED/REJECTED decisions.

Usage:
  python scripts/content/auto_review.py [--threshold 60] [--write]

Reads derived-manifest.jsonl and writes data/content/review-decisions.jsonl
with machine-proposed decisions:
  APPROVED  - score >= threshold, no rejection signals
  REJECTED  - score < 45 or >= 2 rejection signals
  REVIEW    - everything in between (human decides)

Human then edits review-decisions.jsonl and applies with:
  python scripts/content/import_source.py <manifest> --review review-decisions.jsonl
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "content"))

from content_lib import load_jsonl, save_jsonl  # noqa: E402

DERIVED = ROOT / "data" / "content" / "derived-manifest.jsonl"
OUT = ROOT / "data" / "content" / "review-decisions.jsonl"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, default=60.0)
    parser.add_argument("--write", action="store_true", help="write decisions file")
    parser.add_argument("--derived", type=Path, default=DERIVED)
    args = parser.parse_args()

    derived = load_jsonl(args.derived)
    if not derived:
        print("[auto-review] derived manifest is empty")
        return

    decisions = []
    for entry in derived:
        if entry.get("state") != "CONVERTED":
            continue
        score = entry.get("score", 0)
        signals = entry.get("playability", {}).get("rejection_signals", [])
        if score >= args.threshold and not signals:
            decision = "APPROVED"
            notes = f"auto: score {score}, no rejection signals"
        elif score < 45 or len(signals) >= 2:
            decision = "REJECTED"
            notes = f"auto: score {score}, signals: {signals}"
        else:
            decision = "REVIEW"
            notes = f"score {score}, signals: {signals}"
        decisions.append({"id": entry["derived_asset_id"], "decision": decision, "notes": notes})

    approved = sum(1 for d in decisions if d["decision"] == "APPROVED")
    rejected = sum(1 for d in decisions if d["decision"] == "REJECTED")
    review = sum(1 for d in decisions if d["decision"] == "REVIEW")
    print(f"[auto-review] {len(decisions)} candidates: {approved} APPROVED, {rejected} REJECTED, {review} REVIEW")

    if args.write:
        save_jsonl(OUT, decisions)
        print(f"[auto-review] wrote {OUT}")


if __name__ == "__main__":
    main()
