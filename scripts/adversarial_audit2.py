#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Part 2: duplicates, preview presence, OGA/PD scrutiny."""
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

# ---- preview presence ----
previews_dir = os.path.join(BASE, "previews")
missing_previews = [d["derived_asset_id"] for d in approved if not os.path.exists(os.path.join(previews_dir, d["derived_asset_id"] + ".png"))]
print("approved missing preview PNG:", len(missing_previews), missing_previews[:10])

# ---- sha256 duplicates among SOURCES used by approved ----
print("\n===== SHA256 DUPLICATES =====")
sha_map = collections.defaultdict(list)
for s in sources:
    sha = s.get("source_file_sha256")
    if sha:
        sha_map[sha].append(s["source_asset_id"])
hard_dups = {sha: ids for sha, ids in sha_map.items() if len(ids) > 1}
print(f"sha256 collision groups: {len(hard_dups)}")
for sha, ids in sorted(hard_dups.items()):
    # only report if any used by approved
    used = [i for i in ids if i in {d['source_asset_id'] for d in approved}]
    titles = collections.Counter(src_by_id[i].get("source_title") for i in ids)
    print(f"  sha={sha[:12]} ids={ids} used_by_approved={used} titles={dict(titles)}")

# ---- also check source_file_sha256 missing ----
no_sha = [s["source_asset_id"] for s in sources if not s.get("source_file_sha256")]
print("sources missing sha256:", len(no_sha), no_sha[:10])

# ---- pack-level dup: same download_pack_zip + same download_file_in_pack ----
print("\n===== SAME PACK FILE (double-download candidates) =====")
pack_map = collections.defaultdict(list)
for s in sources:
    key = (s.get("download_pack_zip"), s.get("download_file_in_pack"))
    if key[0] and key[1]:
        pack_map[key].append(s["source_asset_id"])
pack_dups = {k: v for k, v in pack_map.items() if len(v) > 1}
print(f"same (pack,file) groups: {len(pack_dups)}")
for (pack, f), ids in sorted(pack_dups.items()):
    used = [i for i in ids if i in {d['source_asset_id'] for d in approved}]
    print(f"  {pack}/{f}: {ids} used_by_approved={used}")

# ---- OGA + PD sources detail ----
print("\n===== OGA & PD SOURCE DETAIL =====")
for s in sources:
    if "opengameart" in (s.get("source_url") or "") or s.get("license_verdict") == "APPROVED_PUBLIC_DOMAIN":
        print(json.dumps({k: s.get(k) for k in ["source_asset_id", "source_title", "source_creator", "source_url", "download_url", "license_type", "license_url", "license_text_snapshot", "attribution_required", "commercial_use", "derivative_use", "redistribution_constraints", "license_verdict", "public_domain_status"]}, ensure_ascii=False))

# ---- review-decisions file ----
rd_path = os.path.join(BASE, "review-decisions.jsonl")
if os.path.exists(rd_path):
    rds = load_jsonl(rd_path)
    print(f"\nreview-decisions: {len(rds)} rows")
    keys = set()
    for r in rds:
        keys.update(r.keys())
    print("keys:", keys)
    states = collections.Counter(r.get("decision") or r.get("state") or r.get("verdict") for r in rds)
    print("decisions:", dict(states))
    # print first row
    if rds:
        print("sample:", json.dumps(rds[0], ensure_ascii=False)[:800])
else:
    print("\nreview-decisions.jsonl NOT FOUND")
