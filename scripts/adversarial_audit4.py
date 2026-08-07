#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Part 4: visual audit — render templates, stats, degenerate detection, preview integrity."""
import json, os, random, collections
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

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def render_cells(d, scale=8):
    """Render template cells to an RGB array at w*scale x h*scale (nearest)."""
    tpl = d["template"]
    w, h = tpl["width"], tpl["height"]
    pal = [hex_to_rgb(c) for c in tpl["palette"]]
    cells = tpl["cells"]
    arr = np.zeros((h * scale, w * scale, 3), dtype=np.uint8)
    for y in range(h):
        for x in range(w):
            c = pal[cells[y * w + x]]
            arr[y*scale:(y+1)*scale, x*scale:(x+1)*scale] = c
    return arr

def region_stats(cells, w, h):
    """Compute largest region ratio via BFS on 4-connectivity with same color."""
    visited = np.zeros((h, w), dtype=bool)
    arr = np.array(cells, dtype=np.int32).reshape(h, w)
    sizes = []
    for y in range(h):
        for x in range(w):
            if visited[y, x]:
                continue
            # BFS
            color = arr[y, x]
            stack = [(y, x)]
            visited[y, x] = True
            size = 0
            while stack:
                cy, cx = stack.pop()
                size += 1
                for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                    ny, nx = cy+dy, cx+dx
                    if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and arr[ny, nx] == color:
                        visited[ny, nx] = True
                        stack.append((ny, nx))
            sizes.append(size)
    sizes.sort(reverse=True)
    total = w * h
    largest = sizes[0] / total if sizes else 0
    # top color coverage (most common color ignoring nothing)
    cnt = collections.Counter(arr.flatten().tolist())
    top_color = cnt.most_common(1)[0]
    return largest, top_color[1] / total, len(sizes), sizes

def analyze(d):
    did = d["derived_asset_id"]
    tpl = d["template"]
    w, h = tpl["width"], tpl["height"]
    cells = tpl["cells"]
    largest, topcov, nreg, sizes = region_stats(cells, w, h)
    # palette usage
    used = len(set(cells))
    # preview check
    prev_path = os.path.join(PREV, did + ".png")
    prev_ok = os.path.exists(prev_path)
    prev_info = None
    if prev_ok:
        im = Image.open(prev_path).convert("RGB")
        a = np.asarray(im, dtype=np.uint8)
        prev_info = {
            "size": im.size,
            "mean": float(a.mean()),
            "std": float(a.std()),
            "dark_frac": float((a.mean(axis=2) < 64).mean()),
            "unique_colors": len(np.unique(a.reshape(-1, 3), axis=0)),
        }
        # render template at 8x and resize to 512 to compare roughly
        r = render_cells(d, 8)
        r_im = Image.fromarray(r).resize((512, 512), Image.NEAREST)
        p_im = im.resize((512, 512))
        diff = np.abs(np.asarray(r_im, dtype=np.int16) - np.asarray(p_im, dtype=np.int16))
        prev_info["render_diff_mean"] = float(diff.mean())
        prev_info["render_diff_max"] = float(diff.max())
    return {
        "id": did, "grid": w, "pal": len(tpl["palette"]), "used_colors": used,
        "score": d["score"], "diff": d["difficulty"],
        "largest": largest, "topcov": topcov, "nregions": nreg,
        "small_regions_lt9": sum(1 for s in sizes if s < 9) / len(sizes) if sizes else 0,
        "prev": prev_info,
    }

# ---- sample 20 random (seeded) + all masterpiece ----
random.seed(20260807)
approved_ids = [d["derived_asset_id"] for d in approved]
sample = random.sample(approved_ids, 20)
masterpieces = [d["derived_asset_id"] for d in approved if d["grid_width"] >= 600]
audit_ids = sorted(set(sample + masterpieces))
print("random 20:", sorted(sample))
print("masterpiece (grid>=600):", sorted(masterpieces))
print("total to audit:", len(audit_ids))

by_id = {d["derived_asset_id"]: d for d in approved}
results = []
for did in audit_ids:
    r = analyze(by_id[did])
    results.append(r)

print("\n{:<42s} {:>4s} {:>4s} {:>5s} {:>6s} {:>8s} {:>8s} {:>7s} {:>6s} {:>7s} {:>8s}".format(
    "id", "grid", "used", "score", "diff", "largest", "topcov", "nreg", "l<9", "mean", "render"))
for r in results:
    p = r["prev"] or {}
    print("{:<42s} {:>4d} {:>4d} {:>5.1f} {:>6s} {:>8.3f} {:>8.3f} {:>7d} {:>6.2f} {:>7.1f} {:>8.1f}".format(
        r["id"][:42], r["grid"], r["used_colors"], r["score"], r["diff"],
        r["largest"], r["topcov"], r["nregions"], r["small_regions_lt9"],
        p.get("mean", -1), p.get("render_diff_mean", -1)))

# ---- degenerate flags over ALL approved ----
print("\n== DEGENERATE FLAGS (all approved) ==")
flags = []
for d in approved:
    r = analyze(d)
    problems = []
    if r["nregions"] <= 15 and r["grid"] >= 96:
        problems.append(f"only {r['nregions']} regions on grid {r['grid']}")
    if r["largest"] > 0.85:
        problems.append(f"largest region {r['largest']:.3f}")
    if r["topcov"] > 0.85:
        problems.append(f"top color covers {r['topcov']:.3f}")
    if r["largest"] > 0.5 and r["grid"] >= 600:
        problems.append(f"masterpiece: largest {r['largest']:.3f} (giant zone)")
    if r["used_colors"] <= 4:
        problems.append(f"only {r['used_colors']} colors used")
    if problems:
        flags.append((r["id"], "; ".join(problems)))
for fid, p in flags:
    print(f"  {fid}: {p}")
print("flagged:", len(flags))
