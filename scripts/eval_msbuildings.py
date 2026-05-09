#!/usr/bin/env python3
"""Evaluate footprint_msbuildings method on the full eval set by hitting our /api/quote endpoint."""
import json, urllib.request, time, statistics
from pathlib import Path

BASE = "http://localhost:4006"
EVAL = Path("/home/kokomo/dev/roofquote/eval/addresses.json")
OUT  = Path("/home/kokomo/dev/roofquote/eval/msbuildings-eval.json")

records = json.loads(EVAL.read_text())

def best_ref(rec):
    if rec.get("refA") and rec.get("refB"): return (rec["refA"] + rec["refB"]) / 2
    return rec["solarOracle"]["areaSqft"]

results = []
print(f"{'id':<26} {'ref':>5}  {'fp_sqft':>7} {'pitch':>5}  {'totalSqft':>8} {'Δ%':>7}  source")
print("-" * 92)
for rec in records:
    ref = best_ref(rec)
    body = json.dumps({"address": rec["address"]}).encode()
    req = urllib.request.Request(f"{BASE}/api/quote", data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            d = json.loads(r.read())
    except Exception as e:
        print(f"  {rec['id']:<26} ERR {e}")
        continue

    consensus = d.get("consensusSqft")
    combiner = d.get("combiner")
    ms_result = next((m for m in d.get("results", []) if m["method"] == "footprint_msbuildings"), None)

    fp = ms_result.get("footprintSqft") if ms_result else None
    pitch = ms_result.get("pitchRatio") if ms_result else None
    pitch_str = f"{int(round(pitch*12))}:12" if pitch else "?"

    delta = (consensus - ref) / ref * 100 if consensus and ref else None
    source = "MS"  if (combiner or "").startswith("footprint") else ("vision" if combiner else "?")
    print(f"  {rec['id']:<26} {ref:>5.0f}  {(fp or 0):>7.0f} {pitch_str:>5}  {(consensus or 0):>8.0f} {(delta or 0):>+6.1f}%  {source}")
    results.append({
        "id": rec["id"],
        "kind": rec["kind"],
        "address": rec["address"],
        "ref": ref,
        "consensus": consensus,
        "combiner": combiner,
        "ms_footprint_sqft": fp,
        "ms_pitch_ratio": pitch,
        "ms_total_sqft": ms_result.get("totalSqft") if ms_result else None,
        "ms_error": ms_result.get("errorMessage") if ms_result else None,
        "delta_pct": delta,
    })

OUT.write_text(json.dumps(results, indent=2))
print(f"\nSaved to {OUT}")

# Summary stats
ms_used = [r for r in results if r["combiner"] and r["combiner"].startswith("footprint")]
fall = [r for r in results if r["combiner"] and not r["combiner"].startswith("footprint")]

if ms_used:
    errs = [r["delta_pct"] for r in ms_used if r["delta_pct"] is not None]
    print(f"\n=== MS Buildings path (n={len(ms_used)}) ===")
    print(f"  MAPE: {statistics.mean(abs(e) for e in errs):.1f}%")
    print(f"  Bias: {statistics.mean(errs):+.1f}%")
    print(f"  p90:  {sorted(abs(e) for e in errs)[int(len(errs)*0.9) if len(errs)>=10 else -1]:.1f}%")

if fall:
    errs = [r["delta_pct"] for r in fall if r["delta_pct"] is not None]
    print(f"\n=== Vision fallback (n={len(fall)}) ===")
    if errs:
        print(f"  MAPE: {statistics.mean(abs(e) for e in errs):.1f}%")
        print(f"  Bias: {statistics.mean(errs):+.1f}%")
