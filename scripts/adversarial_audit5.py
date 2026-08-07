#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Part 5: palette bloat, grid_fit, Met records, contact sheets."""
import json, os, collections
import numpy as np
from PIL import Image

BASE = r"C:\Users\misa\Desktop\splint-content-factory\data\content"
PREV = os.path.join(BASE, "previews")

def load_jsonl(path):
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows

derived = load_jsonl(os.path.join(BASE, "derived-manifest.jsonl"))
sources = load_jsonl(os.path.join(BASE, "source-manifest.jsonl"))
src_by_id = {s["source_asset_id"]: s for s in sources}
approved = [d for d in derived if d.get("state") == "APPROVED"]
approved.sort(key=lambda d: d["derived_asset_id"])

# ---- palette bloat ----
print("== PALETTE BLOAT (palette_size field vs template palette len vs colors used) ==")
bloat = []
for d in approved:
    tpl = d["template"]
    pal_len = len(tpl["palette"])
    used = len(set(tpl["cells"]))
    ps = d.get("palette_size", 0)
    if pal_len != ps:
        bloat.append((d["derived_asset_id"], f"palette_size field {ps} != template palette {pal_len}"))
    if used < pal_len * 0.6:
        bloat.append((d["derived_asset_id"], f"only {used}/{pal_len} palette colors used"))
for did, msg in bloat:
    print(f"  {did}: {msg}")
print("bloat flags:", len(bloat))

# ---- grid_fit check ----
print("\n== GRID_FIT CHECK (source grid_fit vs chosen grid) ==")
def parse_grid_fit(gf):
    if not gf:
        return None
    gf = gf.replace(" ", "")
    if "-" in gf:
        a, b = gf.split("-")
        return (int(a), int(b))
    return None

gfit_fails = []
for d in approved:
    s = src_by_id[d["source_asset_id"]]
    gf = parse_grid_fit(s.get("grid_fit"))
    if gf:
        lo, hi = gf
        # grid should be within [lo, hi] OR a reasonable multiple
        if not (lo <= d["grid_width"] <= hi or (d["grid_width"] % lo == 0 and d["grid_width"] <= hi * 4)):
            gfit_fails.append((d["derived_asset_id"], s["source_asset_id"], s.get("grid_fit"), d["grid_width"]))
print("grid_fit fails:", len(gfit_fails))
for f in gfit_fails:
    print("  ", f)

# grid_fit distribution
gfs = collections.Counter(src_by_id[d["source_asset_id"]].get("grid_fit") for d in approved)
print("grid_fit values:", dict(gfs))

# ---- Met record sample ----
print("\n== MET RECORD SAMPLE (met-192770) ==")
print(json.dumps(src_by_id["met-192770"], ensure_ascii=False, indent=1))

# ---- unused colors per Met masterpiece ----
print("\n== Met/NASA masterpiece palette usage ==")
for d in approved:
    if d["grid_width"] >= 600:
        used = len(set(d["template"]["cells"]))
        pal = len(d["template"]["palette"])
        print(f"  {d['derived_asset_id']}: {used}/{pal} colors used, palette_size field={d.get('palette_size')}")

# ---- contact sheets ----
def make_sheet(ids, name, cols=6):
    ids = [i for i in ids if os.path.exists(os.path.join(PREV, i + ".png"))]
    rows = (len(ids) + cols - 1) // cols
    th = 256
    sheet = Image.new("RGB", (cols * th, rows * th + 40), "white")
    from PIL import ImageDraw
    dr = ImageDraw.Draw(sheet)
    for idx, did in enumerate(ids):
        im = Image.open(os.path.join(PREV, did + ".png")).resize((th, th))
        x, y = (idx % cols) * th, (idx // cols) * th + 40
        sheet.paste(im, (x, y))
        dr.text((x + 2, y + 2), did[:24], fill="black")
    out = os.path.join(BASE, f"contact_{name}.png")
    sheet.save(out)
    print("saved", out, sheet.size)
    return out

# masterpiece sheet
mp_ids = sorted(d["derived_asset_id"] for d in approved if d["grid_width"] >= 600)
make_sheet(mp_ids, "masterpieces", cols=5)
# degenerate kenney food/bag sheet
deg_ids = [d["derived_asset_id"] for d in approved if d["source_asset_id"].startswith("kenney-food-kit-bacon") or d["source_asset_id"].startswith("kenney-food-kit-bag")]
make_sheet(deg_ids, "kenney_food_degenerate", cols=4)
# tiny tiles sheet (first 12)
tiny_ids = [d["derived_asset_id"] for d in approved if d["source_asset_id"].startswith("kenney-tiny-")][:12]
make_sheet(tiny_ids, "tiny_tiles", cols=6)
# NASA sheet
nasa_ids = [d["derived_asset_id"] for d in approved if d["source_asset_id"].startswith("nasa-")]
make_sheet(nasa_ids, "nasa", cols=4)
# elephants/pandas sheet
anim_ids = [d["derived_asset_id"] for d in approved if d["source_asset_id"] in ("kenney-animal-pack-elephant","kenney-animal-pack-panda","kenney-animal-pack-hippo","kenney-animal-pack-pig","kenney-animal-pack-penguin")]
make_sheet(anim_ids, "animals", cols=5)
# met masterpieces sheet
met_ids = [d["derived_asset_id"] for d in approved if d["source_asset_id"].startswith("met-") and d["grid_width"] >= 600]
make_sheet(met_ids, "met_masterpieces", cols=4)
