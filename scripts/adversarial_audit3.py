#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Part 3: approved list detail, tier limits check, difficulty sanity, integrity."""
import json, os, collections

BASE = r"C:\Users\misa\Desktop\splint-content-factory\data\content"

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

# ---- hard dup pair usage ----
print("== met-207157 / met-237451 (hard dup) usage ==")
for d in approved:
    if d["source_asset_id"] in ("met-207157", "met-237451"):
        s = src_by_id[d["source_asset_id"]]
        print(f"  {d['derived_asset_id']} <- {d['source_asset_id']} ({s['source_title']}) grid={d['grid_width']}x{d['grid_height']} score={d['score']}")

# ---- helix nebula pair usage ----
print("\n== helix nebula (PIA15658 vs PIA07902) usage ==")
for d in approved:
    if d["source_asset_id"] in ("nasa-PIA15658", "nasa-PIA07902"):
        s = src_by_id[d["source_asset_id"]]
        print(f"  {d['derived_asset_id']} <- {d['source_asset_id']} ({s['source_title']}) grid={d['grid_width']} score={d['score']}")

# ---- full approved table ----
print("\n== ALL APPROVED (id | src | inst | grid | pal | score | diff | tier-src | singleton | tiny | per10k) ==")
TIER_LIMITS = {
    "small":      {"singleton": 0.10, "tiny": 0.32, "per10k": 2000},
    "medium":     {"singleton": 0.07, "tiny": 0.28, "per10k": 900},
    "large":      {"singleton": 0.05, "tiny": 0.26, "per10k": 350},
    "masterpiece": {"singleton": 0.04, "tiny": 0.25, "per10k": 260},
}
tier_fails = []
integrity_fails = []
for d in approved:
    did = d["derived_asset_id"]
    s = src_by_id.get(d["source_asset_id"], {})
    regs = d.get("playability", {}).get("regions", {})
    sr = regs.get("singleton_ratio", 0)
    tr = regs.get("tiny_component_ratio", 0)
    per10k = regs.get("component_count_per_10k", 0)
    tier = s.get("content_tier", "?")
    lim = TIER_LIMITS.get(tier)
    ok = True
    failinfo = ""
    if lim:
        if sr >= lim["singleton"]:
            ok = False; failinfo += f" singleton {sr:.3f}>={lim['singleton']}"
        if tr >= lim["tiny"]:
            ok = False; failinfo += f" tiny {tr:.3f}>={lim['tiny']}"
        if per10k >= lim["per10k"]:
            ok = False; failinfo += f" per10k {per10k:.0f}>={lim['per10k']}"
    else:
        ok = False; failinfo = " no tier limits"
    if not ok:
        tier_fails.append((did, tier, sr, tr, per10k, failinfo))
    # integrity: cells length vs w*h
    tpl = d.get("template", {})
    cells = tpl.get("cells", [])
    w, h = tpl.get("width", 0), tpl.get("height", 0)
    if len(cells) != w * h:
        integrity_fails.append((did, len(cells), w * h))
    pal = tpl.get("palette", [])
    # palette index max < len(palette)
    if cells:
        mx = max(cells)
        if mx >= len(pal):
            integrity_fails.append((did, f"cell index {mx} >= palette len {len(pal)}"))
    print(f"  {did} | {d['source_asset_id'][:28]:28s} | {s.get('source_institution','?')[:12]:12s} | {d['grid_width']:4d} | {d.get('palette_size',0):2d} | {d['score']:5.1f} | {d['difficulty']:6s} | {tier:10s} | {sr:.3f} | {tr:.3f} | {per10k:.0f}")

print("\ntier limit FAILs:", len(tier_fails))
for f in tier_fails:
    print("  ", f)
print("\nintegrity FAILs:", len(integrity_fails))
for f in integrity_fails[:20]:
    print("  ", f)

# ---- difficulty vs grid sanity ----
print("\n== difficulty distribution by grid size ==")
for gw in sorted(set(d["grid_width"] for d in approved)):
    diffs = collections.Counter(d["difficulty"] for d in approved if d["grid_width"] == gw)
    print(f"  grid {gw}: {dict(diffs)}")

# ---- score distribution ----
scores = [d["score"] for d in approved]
print("\nscore min/max/mean:", min(scores), max(scores), sum(scores)/len(scores))

# ---- grid size distribution ----
print("grid sizes:", dict(collections.Counter(d["grid_width"] for d in approved)))

# ---- masterpiece candidates (grid >= 600) ----
print("\n== MASTERPIECE CANDIDATES (grid>=600) ==")
mps = [d for d in approved if d["grid_width"] >= 600]
print("count:", len(mps))
for d in sorted(mps, key=lambda x: -x["grid_width"]):
    s = src_by_id.get(d["source_asset_id"], {})
    regs = d.get("playability", {}).get("regions", {})
    print(f"  {d['derived_asset_id']} | {s.get('source_title','?')[:40]:40s} | grid {d['grid_width']}x{d['grid_height']} | pal {d.get('palette_size')} | score {d['score']} | diff {d['difficulty']} | regions {regs.get('component_count')} | largest {regs.get('largest_region_ratio')} | singleton {regs.get('singleton_ratio')} | tiny {regs.get('tiny_component_ratio')} | per10k {regs.get('component_count_per_10k')}")
