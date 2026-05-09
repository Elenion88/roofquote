#!/usr/bin/env python3
"""Merge per-state extraction results into one polygons.json."""
import json
from pathlib import Path

OUT_DIR = Path("/home/kokomo/dev/roofquote/data/msbuildings/extracted")
EVAL_PATH = Path("/home/kokomo/dev/roofquote/eval/addresses.json")

records = json.loads(EVAL_PATH.read_text())
by_id = {r["id"]: None for r in records}

for f in OUT_DIR.glob("*-results.json"):
    state_results = json.loads(f.read_text())
    for r in state_results:
        by_id[r["id"]] = r

# Build merged list in original order
merged = []
for r in records:
    base = {k: r[k] for k in ("id", "address", "lat", "lng", "kind")}
    state_record = by_id.get(r["id"])
    if state_record:
        base["msbuildings"] = state_record.get("msbuildings")
    else:
        base["msbuildings"] = None
    merged.append(base)

out = OUT_DIR / "polygons.json"
out.write_text(json.dumps(merged, indent=2))

hits = sum(1 for r in merged if r.get("msbuildings"))
print(f"Wrote {len(merged)} records, {hits} with polygons ({hits/len(merged)*100:.0f}%)")

# Per-kind breakdown
for kind in ("test", "example", "neighbor"):
    sub = [r for r in merged if r["kind"] == kind]
    h = sum(1 for r in sub if r.get("msbuildings"))
    print(f"  {kind}: {h}/{len(sub)}")

# List misses
print()
print("MISSES (no polygon found):")
for r in merged:
    if not r.get("msbuildings"):
        print(f"  {r['id']:<26}  {r['address']}")
