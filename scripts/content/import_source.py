#!/usr/bin/env python3
"""Splint Content Factory — source import pipeline.

Usage:
  python scripts/content/import_source.py <source-manifest.jsonl> [options]

Stages (each idempotent, state stored in the manifest):
  DISCOVERED        -> record exists with license metadata
  DOWNLOADED        -> file downloaded + sha256 verified
  LICENSE_VERIFIED  -> verdict is production-ready
  CONVERTED         -> size candidates generated + scored
  QUALITY_REVIEW    -> human review decides APPROVED / REJECTED

Options:
  --workdir DIR       staging directory (default data/content-staging)
  --grids LIST        comma-separated candidate grid sizes
  --palettes LIST     comma-separated palette sizes (per grid tier)
  --max-sources N     process at most N sources (sampling)
  --only STATE        only process sources at or before STATE
  --convert           run download+convert+score in one pass
  --skip-download     use already-downloaded files
  --report            print a funnel summary at the end
  --review FILE       apply human review decisions (JSONL: id, decision, notes)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "content"))

from content_lib import (  # noqa: E402
    PRODUCTION_READY_VERDICTS,
    STAGES,
    convert_template,
    download_file,
    load_jsonl,
    now_utc,
    playability_score,
    save_jsonl,
    sha256_bytes,
    validate_image_file,
)

DEFAULT_GRIDS = [32, 64, 128, 256, 512]
DEFAULT_PALETTES = {
    12: 8,
    16: 8,
    24: 10,
    32: 10,
    48: 12,
    64: 12,
    96: 14,
    128: 16,
    192: 18,
    256: 20,
    384: 24,
    512: 28,
    600: 28,
    800: 32,
    1024: 32,
    1200: 36,
}

# Grid tiers -> candidate sizes per source category (curators may override).
TIER_GRIDS = {
    "small": [12, 16, 24, 32],
    "medium": [48, 64, 96, 128, 192],
    "large": [256, 384, 512, 600],
    "masterpiece": [800, 1024, 1200],
}


def stage_index(record: dict) -> int:
    return STAGES.index(record.get("state", "DISCOVERED"))


def run_download(source_manifest: Path, workdir: Path, max_sources: int | None, only: str | None, skip_download: bool) -> list[dict]:
    records = load_jsonl(source_manifest)
    if max_sources:
        records = records[:max_sources]
    target_index = STAGES.index(only) if only else STAGES.index("LICENSE_VERIFIED")

    changed = 0
    for record in records:
        if stage_index(record) >= target_index and not only:
            continue
        record.setdefault("state", "DISCOVERED")

        # License gate: only production-ready verdicts proceed to download.
        verdict = record.get("license_verdict", "REVIEW_REQUIRED")
        if verdict not in PRODUCTION_READY_VERDICTS:
            record["state"] = "REJECTED"
            record.setdefault("rejection_reasons", []).append(f"license verdict {verdict} not production-ready")
            continue

        if record.get("state") == "DISCOVERED" or not record.get("source_file_sha256") or not skip_download:
            try:
                result = download_file(record["download_url"], workdir / record["source_asset_id"])
            except Exception as exc:  # noqa: BLE001 - surface any download failure
                record["state"] = "REJECTED"
                record.setdefault("rejection_reasons", []).append(f"download failed: {exc}")
                changed += 1
                continue
            try:
                dims = validate_image_file(Path(result["path"]))
            except Exception as exc:  # noqa: BLE001
                record["state"] = "REJECTED"
                record.setdefault("rejection_reasons", []).append(f"image validation failed: {exc}")
                changed += 1
                continue

            data = Path(result["path"]).read_bytes()
            record["source_file_sha256"] = sha256_bytes(data)
            record["source_file_path"] = result["path"]
            record["source_dimensions"] = f"{dims['width']}x{dims['height']}"
            record["source_format"] = dims["format"]
            record["download_verified_at"] = now_utc()
            record["state"] = "DOWNLOADED"
            changed += 1

        if verdict in PRODUCTION_READY_VERDICTS and record.get("source_file_sha256"):
            record["state"] = "LICENSE_VERIFIED"

    save_jsonl(source_manifest, records)
    print(f"[download] {changed} sources processed; states: {sum(1 for r in records if r['state'] == 'LICENSE_VERIFIED')} verified")
    return records


def run_convert(
    source_manifest: Path,
    derived_manifest: Path,
    workdir: Path,
    grids: list[int],
    palettes: dict[int, int],
    only: str | None,
) -> list[dict]:
    records = load_jsonl(source_manifest)
    derived = load_jsonl(derived_manifest)
    derived_by_key = {(d["source_asset_id"], d["grid_width"], d["palette_size"]): d for d in derived}
    target_index = STAGES.index(only) if only else STAGES.index("CONVERTED")

    for record in records:
        if record.get("state") != "LICENSE_VERIFIED":
            continue
        source_path = Path(record.get("source_file_path", ""))
        if not source_path.exists():
            record["state"] = "REJECTED"
            record.setdefault("rejection_reasons", []).append("source file missing")
            continue

        # Select candidate sizes from the source's tier (curator override allowed).
        tier = record.get("content_tier", "medium")
        tier_sizes = record.get("candidate_sizes") or TIER_GRIDS.get(tier, TIER_GRIDS["medium"])
        # Tier sizes win when explicitly requested; else intersect with --grids.
        if tier in TIER_GRIDS or record.get("candidate_sizes"):
            candidates = tier_sizes
        else:
            candidates = [g for g in grids if g in tier_sizes]

        for grid in candidates:
            palette_size = palettes.get(grid, 16)
            key = (record["source_asset_id"], grid, palette_size)
            existing = derived_by_key.get(key)
            if existing and existing.get("state") in ("CONVERTED", "APPROVED", "REJECTED", "QUALITY_REVIEW"):
                continue

            try:
                template = convert_template(source_path, grid, palette_size, crop=record.get("crop"))
            except Exception as exc:  # noqa: BLE001
                entry = {
                    "derived_asset_id": f"{record['source_asset_id']}_g{grid}",
                    "source_asset_id": record["source_asset_id"],
                    "grid_width": grid,
                    "grid_height": grid,
                    "palette_size": palette_size,
                    "state": "REJECTED",
                    "rejection_reasons": [f"conversion failed: {exc}"],
                    "created_at": now_utc(),
                }
                derived_by_key[key] = entry
                continue

            score = playability_score(grid, grid, template["palette"], template["cells"], source_path=source_path)
            entry = {
                "derived_asset_id": f"{record['source_asset_id']}_g{grid}",
                "source_asset_id": record["source_asset_id"],
                "pipeline_version": "1.0.0",
                "grid_width": grid,
                "grid_height": grid,
                "palette_size": palette_size,
                "conversion_parameters": {"cleanup": True, "enhance": 1.08, "quantize": "MAXCOVERAGE", "resample": "BOX"},
                "state": "CONVERTED",
                "score": score["score"],
                "difficulty": score["difficulty"],
                "estimated_taps": score["estimated_taps"],
                "playability": score,
                "template": template,
                "created_at": now_utc(),
            }
            derived_by_key[key] = entry

    save_jsonl(derived_manifest, [derived_by_key[k] for k in sorted(derived_by_key)])
    converted = [d for d in derived_by_key.values() if d.get("state") == "CONVERTED"]
    print(f"[convert] {len(converted)} converted candidates across {len(records)} verified sources")
    return converted


def run_report(source_manifest: Path, derived_manifest: Path) -> None:
    sources = load_jsonl(source_manifest)
    derived = load_jsonl(derived_manifest)
    by_state = {}
    for record in sources:
        by_state[record.get("state", "DISCOVERED")] = by_state.get(record.get("state", "DISCOVERED"), 0) + 1
    approved = [d for d in derived if d.get("state") == "APPROVED"]
    print("\n=== FUNNEL ===")
    for stage in STAGES:
        if by_state.get(stage):
            print(f"  {stage}: {by_state[stage]}")
    print(f"  derived candidates (CONVERTED): {sum(1 for d in derived if d.get('state') == 'CONVERTED')}")
    print(f"  derived candidates (APPROVED): {len(approved)}")
    scores = [d["score"] for d in derived if d.get("state") == "CONVERTED"]
    if scores:
        print(f"  score distribution: min {min(scores)} / median {sorted(scores)[len(scores)//2]} / max {max(scores)}")


def apply_review(derived_manifest: Path, review_file: Path) -> int:
    """Apply human review decisions: JSONL with {id, decision, notes}.

    decision: APPROVED | REJECTED. Approved entries are marked QUALITY_REVIEW->APPROVED.
    """
    decisions = load_jsonl(review_file)
    derived = load_jsonl(derived_manifest)
    by_id = {d["derived_asset_id"]: d for d in derived}
    changed = 0
    for decision in decisions:
        entry = by_id.get(decision.get("id"))
        if not entry:
            print(f"[review] WARN: unknown derived_asset_id {decision.get('id')}")
            continue
        if decision.get("decision") == "APPROVED":
            entry["state"] = "APPROVED"
            entry["review_notes"] = decision.get("notes", "")
            entry["approved_at"] = now_utc()
        elif decision.get("decision") == "REJECTED":
            entry["state"] = "REJECTED"
            entry.setdefault("rejection_reasons", []).append(decision.get("notes", "human review rejection"))
        changed += 1
    save_jsonl(derived_manifest, derived)
    print(f"[review] applied {changed} decisions")
    return changed


def main() -> None:
    parser = argparse.ArgumentParser(description="Splint content import pipeline")
    parser.add_argument("manifest", type=Path, help="source manifest JSONL")
    parser.add_argument("--workdir", type=Path, default=ROOT / "data" / "content-staging")
    parser.add_argument("--grids", default=",".join(str(g) for g in DEFAULT_GRIDS))
    parser.add_argument("--palettes", default="")
    parser.add_argument("--max-sources", type=int, default=None)
    parser.add_argument("--only", default=None, choices=STAGES)
    parser.add_argument("--convert", action="store_true")
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--review", type=Path, default=None)
    args = parser.parse_args()

    grids = [int(g) for g in args.grids.split(",") if g]
    palettes = DEFAULT_PALETTES
    if args.palettes:
        parsed = {}
        for pair in args.palettes.split(","):
            grid, count = pair.split(":")
            parsed[int(grid)] = int(count)
        palettes = {**DEFAULT_PALETTES, **parsed}

    derived_manifest = ROOT / "data" / "content" / "derived-manifest.jsonl"

    if args.review:
        apply_review(derived_manifest, args.review)
        return

    if args.convert:
        run_download(args.manifest, args.workdir, args.max_sources, args.only, args.skip_download)
        run_convert(args.manifest, derived_manifest, args.workdir, grids, palettes, args.only)
    elif args.only == "DOWNLOADED" or args.only == "LICENSE_VERIFIED":
        run_download(args.manifest, args.workdir, args.max_sources, args.only, args.skip_download)
    else:
        run_convert(args.manifest, derived_manifest, args.workdir, grids, palettes, args.only)

    if args.report:
        run_report(args.manifest, derived_manifest)


if __name__ == "__main__":
    main()
