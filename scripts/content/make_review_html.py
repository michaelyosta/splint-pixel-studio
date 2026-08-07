#!/usr/bin/env python3
"""Splint Content Factory — preview + review gallery generation.

Usage:
  python scripts/content/make_review_html.py [--limit N] [--source data/content/source-manifest.jsonl]

Reads the derived manifest and renders:
  * data/content/previews/<derived_id>.png       (512px nearest-neighbor)
  * data/content/review-gallery.html              (grouped APPROVE / REVIEW / REJECT)
"""

from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "content"))

from content_lib import load_jsonl  # noqa: E402

PREVIEW_DIR = ROOT / "data" / "content" / "previews"


def render_preview(template: dict, out_path: Path, size: int = 512) -> None:
    """Nearest-neighbor upscale of the template grid (matches production preview)."""
    from PIL import Image

    width, height = template["width"], template["height"]
    palette = template["palette"]
    cells = template["cells"]
    img = Image.new("RGB", (width, height))
    img.putdata([_parse_hex(palette[c]) for c in cells])
    img.resize((size, size), Image.Resampling.NEAREST).save(out_path, optimize=True)


def _parse_hex(hex_color: str) -> tuple:
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))


def build_gallery(source_records: list[dict], derived_records: list[dict], limit: int | None) -> str:
    source_by_id = {r["source_asset_id"]: r for r in source_records}
    ordered = sorted(
        [d for d in derived_records if d.get("state") != "REJECTED"],
        key=lambda d: (d.get("state") != "APPROVED", -d.get("score", 0)),
    )
    if limit:
        ordered = ordered[:limit]

    groups = {"APPROVED": [], "QUALITY_REVIEW": [], "CONVERTED": []}
    for d in ordered:
        groups[d.get("state", "CONVERTED")].append(d)

    def card(d: dict) -> str:
        src = source_by_id.get(d["source_asset_id"], {})
        play = d.get("playability", {})
        preview = f"previews/{d['derived_asset_id']}.png"
        signals = play.get("rejection_signals", [])
        warnings = "<br>".join(html.escape(s) for s in signals) if signals else "<span class='ok'>no warnings</span>"
        license_ = html.escape(src.get("license_type", "?"))
        verdict = html.escape(src.get("license_verdict", "?"))
        return f"""
        <div class="card {'approved' if d.get('state') == 'APPROVED' else ''}">
          <img loading="lazy" src="{preview}" alt="{html.escape(d['derived_asset_id'])}">
          <div class="meta">
            <div class="title">{html.escape(d['derived_asset_id'])}</div>
            <div class="grid">{d['grid_width']}&times;{d['grid_height']} · {d['palette_size']} colors</div>
            <div class="score">score <b>{d.get('score', '?')}</b> · {html.escape(d.get('difficulty', '?'))}</div>
            <div class="src">src: {html.escape(src.get('source_title', d['source_asset_id']))}</div>
            <div class="lic">{license_} [{verdict}]</div>
            <div class="warn">{warnings}</div>
            <div class="taps">taps≈{d.get('estimated_taps', '?')} · frag {play.get('regions', {}).get('tiny_component_ratio', '?')}</div>
          </div>
        </div>"""

    sections = ""
    for label in ("APPROVED", "QUALITY_REVIEW", "CONVERTED"):
        items = groups.get(label, [])
        if items:
            sections += f"<h2>{label} ({len(items)})</h2><div class='grid-wrap'>" + "".join(card(d) for d in items) + "</div>"

    return f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<title>Splint Content Review Gallery</title>
<style>
  body {{ font-family: system-ui, sans-serif; background: #0b131a; color: #dce6ee; margin: 0; padding: 24px; }}
  h1 {{ font-size: 20px; }} h2 {{ font-size: 16px; margin-top: 32px; color: #9fb8c8; }}
  .grid-wrap {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }}
  .card {{ background: #131f2a; border: 1px solid #22384a; border-radius: 10px; padding: 10px; }}
  .card.approved {{ border-color: #3fae5a; }}
  .card img {{ width: 100%; image-rendering: pixelated; border-radius: 6px; }}
  .meta {{ font-size: 11px; line-height: 1.45; margin-top: 8px; }}
  .title {{ font-weight: 700; }} .score b {{ color: #ffd866; }}
  .warn {{ color: #ff8f66; }} .ok {{ color: #6fce8f; }}
  .lic {{ color: #8fb3c8; }} .src {{ color: #c8d8e4; }}
</style></head><body>
<h1>Splint Content Review Gallery — {len(ordered)} candidates</h1>
{sections}
</body></html>"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT / "data" / "content" / "source-manifest.jsonl")
    parser.add_argument("--derived", type=Path, default=ROOT / "data" / "content" / "derived-manifest.jsonl")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    sources = load_jsonl(args.source)
    derived = load_jsonl(args.derived)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    rendered = 0
    for d in derived:
        template = d.get("template")
        if not template:
            continue
        render_preview(template, PREVIEW_DIR / f"{d['derived_asset_id']}.png")
        rendered += 1

    gallery = build_gallery(sources, derived, args.limit)
    (ROOT / "data" / "content" / "review-gallery.html").write_text(gallery, encoding="utf-8")
    print(f"[gallery] {rendered} previews rendered; review-gallery.html written")


if __name__ == "__main__":
    main()
