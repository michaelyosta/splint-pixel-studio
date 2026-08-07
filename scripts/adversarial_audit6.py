#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Part 6: final adversarial checks."""
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

# 1. bacon background color
print("== bacon/bag palettes ==")
for d in approved:
    if d["source_asset_id"] in ("kenney-food-kit-bacon-raw", "kenney-food-kit-bacon", "kenney-food-kit-bag"):
        tpl = d["template"]
        cnt = collections.Counter(tpl["cells"])
        top = cnt.most_common(1)[0][0]
        print(f"  {d['derived_asset_id']}: palette={tpl['palette']} top_color={tpl['palette'][top]} covers {cnt[top]/len(tpl['cells']):.2f}")

# 2. Met creation_date (PD risk)
print("\n== Met sources used by approved: creation_date ==")
for d in approved:
    s = src_by_id[d["source_asset_id"]]
    if s.get("source_institution") == "The Metropolitan Museum of Art":
        print(f"  {s['source_asset_id']}: '{s.get('creation_date')}' | {s['source_title'][:50]}")

# 3. missing fields in derived approved records
print("\n== derived field completeness ==")
REQ_D = ["derived_asset_id", "source_asset_id", "grid_width", "grid_height", "palette_size",
         "score", "difficulty", "playability", "template"]
missing = []
for d in approved:
    for f in REQ_D:
        if f not in d:
            missing.append((d["derived_asset_id"], f))
print("missing derived fields:", len(missing), missing[:10])
# playability subfields
missing_p = []
for d in approved:
    p = d.get("playability", {})
    for f in ["score", "difficulty", "regions", "rejection_signals"]:
        if f not in p:
            missing_p.append((d["derived_asset_id"], "playability." + f))
    r = p.get("regions", {})
    for f in ["component_count", "component_count_per_10k", "singleton_ratio", "tiny_component_ratio", "largest_region_ratio"]:
        if f not in r:
            missing_p.append((d["derived_asset_id"], "regions." + f))
print("missing playability fields:", len(missing_p), missing_p[:10])

# 4. rejection_signals non-empty?
rs = [d["derived_asset_id"] for d in approved if d.get("playability", {}).get("rejection_signals")]
print("\nnon-empty rejection_signals in approved:", rs)

# 5. source state
states = collections.Counter(src_by_id[d["source_asset_id"]].get("state") for d in approved)
print("source states for approved:", dict(states))

# 6. Kenney license check — one Kenney source with license_type + verdict
print("\n== Kenney sample ==")
k = src_by_id["kenney-animal-pack-elephant"]
print(json.dumps({kk: k.get(kk) for kk in ["source_asset_id","source_title","source_url","download_url","download_pack_zip","download_file_in_pack","download_pack_sha256","license_type","license_url","license_text_snapshot","attribution_required","commercial_use","derivative_use","license_verdict","public_domain_status","grid_fit","content_tier"]}, ensure_ascii=False, indent=1))

# 7. CMA sample
print("\n== CMA sample ==")
c = src_by_id["cma-flower-anemone"]
print(json.dumps({kk: c.get(kk) for kk in ["source_asset_id","source_title","source_url","download_url","license_type","license_url","license_text_snapshot","attribution_required","commercial_use","derivative_use","license_verdict","public_domain_status"]}, ensure_ascii=False, indent=1))

# 8. score floor — lowest approved
print("\n== lowest scores ==")
for d in sorted(approved, key=lambda x: x["score"])[:6]:
    print(f"  {d['derived_asset_id']}: {d['score']}")

# 9. estimated_taps sanity
taps = [(d["derived_asset_id"], d.get("estimated_taps"), d["grid_width"]) for d in approved if d.get("estimated_taps", 0) < 10]
print("\nassets with estimated_taps<10:", taps[:20])
