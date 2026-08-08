#!/usr/bin/env python3
"""Splint Art Director — review gallery for artwork families.

Reads data/content/artwork-families.jsonl, renders one preview per chosen
resolution, and writes a static HTML gallery grouped by verdict:
  PASS (>=1 resolution chosen) and FAIL (source rejected by gates).
"""

from __future__ import annotations

import html
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "content"))

from content_lib import load_jsonl  # noqa: E402

FAMILIES = ROOT / "data" / "content" / "artwork-families.jsonl"
PREVIEW_DIR = ROOT / "data" / "content" / "family-previews"
OUT = ROOT / "data" / "content" / "artwork-gallery.html"


def render_preview(template, out_path, size: int = 384):
    from PIL import Image

    width, height = template["width"], template["height"]
    palette = template["palette"]
    cells = template["cells"]

    def parse(hex_color):
        hex_color = hex_color.lstrip("#")
        return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))

    img = Image.new("RGB", (width, height))
    img.putdata([parse(palette[c]) for c in cells])
    img.resize((size, size), Image.Resampling.NEAREST).save(out_path, optimize=True)


def main() -> None:
    families = load_jsonl(FAMILIES)
    if not families:
        print("[gallery] no families yet")
        return

    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    passed, failed = [], []
    for f in families:
        if f.get("chosen_resolutions"):
            passed.append(f)
        else:
            failed.append(f)

    def card(f: dict) -> str:
        src = html.escape(f.get("source_title", f["source_asset_id"]))
        sq = f.get("source_quality", {})
        res = f.get("chosen_resolutions", [])
        imgs = ""
        for r in res:
            pid = f"{f['source_asset_id']}_g{r['grid']}"
            render_preview(r["template"], PREVIEW_DIR / f"{pid}.png")
            imgs += (
                f"<div class='res'><img src='family-previews/{pid}.png'>"
                f"<div class='cap'>g{r['grid']} · gate {r['gate_score']} "
                f"(S{r['source_quality']}/C{r['conversion_quality']}/G{r['game_quality']})"
                f" · {r['difficulty']} · taps {r['estimated_taps']}</div></div>"
            )
        notes = html.escape("; ".join(sq.get("notes", [])))
        return (
            f"<div class='card'><div class='src'>{src}<br>"
            f"<span class='sq'>source Q {sq.get('score', '?')} · {f.get('content_tier')} · "
            f"{f.get('license_type')}</span></div>"
            f"<div class='reswrap'>{imgs}</div>"
            f"<div class='notes'>{notes}</div></div>"
        )

    def fail_card(f: dict) -> str:
        sq = f.get("source_quality", {})
        notes = html.escape("; ".join(sq.get("notes", [])))
        return (
            f"<div class='card fail'><div class='src'>"
            f"{html.escape(f.get('source_title', f['source_asset_id']))}</div>"
            f"<div class='notes'>source Q {sq.get('score', '?')} — {notes}</div></div>"
        )

    body = f"<h2>PASS — {len(passed)} families ({sum(len(f['chosen_resolutions']) for f in passed)} resolutions)</h2>"
    body += "<div class='grid'>" + "".join(card(f) for f in sorted(passed, key=lambda f: -f['chosen_resolutions'][0]['gate_score'])) + "</div>"
    body += f"<h2>FAIL — {len(failed)} families (no passing resolution)</h2>"
    body += "<div class='grid'>" + "".join(fail_card(f) for f in failed) + "</div>"

    page = f"""<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<title>Splint Artwork Gallery — Art Director</title><style>
body {{ font-family: system-ui, sans-serif; background: #0b131a; color: #dce6ee; margin: 0; padding: 24px; }}
h2 {{ font-size: 18px; margin-top: 32px; color: #9fb8c8; }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }}
.card {{ background: #131f2a; border: 1px solid #22384a; border-radius: 10px; padding: 12px; }}
.card.fail {{ opacity: 0.6; }}
.src {{ font-weight: 700; font-size: 13px; margin-bottom: 8px; }}
.sq {{ color: #8fb3c8; font-weight: 400; font-size: 11px; }}
.reswrap {{ display: flex; gap: 8px; flex-wrap: wrap; }}
.res img {{ width: 140px; image-rendering: pixelated; border-radius: 6px; }}
.cap {{ font-size: 10px; color: #9fb8c8; margin-top: 4px; }}
.notes {{ font-size: 11px; color: #ff8f66; margin-top: 8px; }}
</style></head><body><h1>Splint Artwork Gallery — Art Director ({len(families)} families)</h1>
{body}</body></html>"""
    OUT.write_text(page, encoding="utf-8")
    print(f"[gallery] {len(passed)} pass / {len(failed)} fail -> {OUT}")


if __name__ == "__main__":
    main()
