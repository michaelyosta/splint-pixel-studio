#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Adversarial audit of Splint seed catalog."""
import json, random, sys, collections, hashlib, os

BASE = r"C:\Users\misa\Desktop\splint-content-factory\data\content"

def load_jsonl(path):
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows

derived = load_jsonl(os.path.join(BASE, "derived-manifest.jsonl"))
sources = load_jsonl(os.path.join(BASE, "source-manifest.jsonl"))

print("== COUNTS ==")
print("derived total:", len(derived))
print("source total:", len(sources))

states = collections.Counter(d.get("state") for d in derived)
print("derived states:", dict(states))

# unique derived ids
ids = [d["derived_asset_id"] for d in derived]
print("unique derived ids:", len(set(ids)), "dups:", len(ids) - len(set(ids)))
if len(ids) != len(set(ids)):
    dups = [i for i, c in collections.Counter(ids).items() if c > 1]
    print("DUPLICATE derived ids:", dups)

src_ids = [s["source_asset_id"] for s in sources]
print("unique source ids:", len(set(src_ids)), "dups:", len(src_ids) - len(set(src_ids)))
if len(src_ids) != len(set(src_ids)):
    dups = [i for i, c in collections.Counter(src_ids).items() if c > 1]
    print("DUPLICATE source ids:", dups)

src_by_id = {s["source_asset_id"]: s for s in sources}

approved = [d for d in derived if d.get("state") == "APPROVED"]
print("\nAPPROVED count:", len(approved))

# Check approved ids referenced in source manifest
missing_src = [d["derived_asset_id"] for d in approved if d["source_asset_id"] not in src_by_id]
print("approved with missing source:", len(missing_src), missing_src[:20])

# ============ LICENSE AUDIT ============
print("\n===== LICENSE AUDIT =====")
REQUIRED_FIELDS = ["source_url", "download_url", "license_type", "license_url",
                   "attribution_required", "commercial_use", "derivative_use"]
ALLOWED_VERDICTS = {"APPROVED_CC0", "APPROVED_PUBLIC_DOMAIN"}

license_fails = []
for d in approved:
    did = d["derived_asset_id"]
    sid = d["source_asset_id"]
    s = src_by_id.get(sid)
    reasons = []
    if s is None:
        license_fails.append((did, sid, "SOURCE MISSING from source-manifest"))
        continue
    verdict = s.get("license_verdict")
    if verdict not in ALLOWED_VERDICTS:
        reasons.append(f"verdict={verdict!r} not in {ALLOWED_VERDICTS}")
    for fld in REQUIRED_FIELDS:
        if fld not in s or s[fld] is None or s[fld] == "":
            reasons.append(f"missing field {fld}")
    # contradictions
    lt = (s.get("license_type") or "").upper()
    cu = s.get("commercial_use")
    du = s.get("derivative_use")
    if "NC" in lt and cu is True:
        reasons.append(f"license {lt} but commercial_use=True")
    if "BY" in lt and s.get("attribution_required") is False and "CC0" not in lt:
        reasons.append(f"license {lt} but attribution_required=False")
    # CC0 with attribution_required=True is a contradiction too
    if "CC0" in lt and s.get("attribution_required") is True:
        reasons.append(f"license CC0 but attribution_required=True")
    if "PUBLIC DOMAIN" in lt.upper() and s.get("public_domain_status") is False and "CC0" not in lt:
        reasons.append("public_domain_status=False but license_type PD")
    # verdict vs license_type consistency
    if verdict == "APPROVED_CC0" and "CC0" not in lt and "PUBLIC DOMAIN" not in lt.upper():
        reasons.append(f"verdict APPROVED_CC0 but license_type={lt!r}")
    if verdict == "APPROVED_PUBLIC_DOMAIN" and "CC0" not in lt and "PUBLIC DOMAIN" not in lt.upper() and lt not in ("PD", "PUBLIC DOMAIN"):
        reasons.append(f"verdict APPROVED_PUBLIC_DOMAIN but license_type={lt!r}")
    if reasons:
        license_fails.append((did, sid, "; ".join(reasons)))

print(f"License FAILs: {len(license_fails)}")
for did, sid, r in license_fails:
    print(f"  FAIL {did} (src={sid}): {r}")

# verdict distribution among approved
vd = collections.Counter(src_by_id[d["source_asset_id"]].get("license_verdict") for d in approved if d["source_asset_id"] in src_by_id)
print("verdict distribution among approved:", dict(vd))

# license_type distribution
ld = collections.Counter(src_by_id[d["source_asset_id"]].get("license_type") for d in approved if d["source_asset_id"] in src_by_id)
print("license_type distribution:", dict(ld))

# source institution distribution
inst = collections.Counter(src_by_id[d["source_asset_id"]].get("source_institution") for d in approved if d["source_asset_id"] in src_by_id)
print("institution distribution:", dict(inst))
