#!/usr/bin/env python3
"""Run the production /api/quote pipeline on the 5 test addresses + 5 examples for sanity check."""
import json, urllib.request, urllib.parse, time, os
from pathlib import Path

BASE = "http://localhost:4006"

ADDRESSES = [
    # Test set (the actual submission targets)
    ("test", "3561 E 102nd Ct, Thornton, CO 80229"),
    ("test", "1612 S Canton Ave, Springfield, MO 65802"),
    ("test", "6310 Laguna Bay Court, Houston, TX 77041"),
    ("test", "3820 E Rosebrier St, Springfield, MO 65809"),
    ("test", "1261 20th Street, Newport News, VA 23607"),
    # Examples (for sanity check)
    ("example", "21106 Kenswick Meadows Ct, Humble, TX 77338"),
    ("example", "5914 Copper Lilly Lane, Spring, TX 77389"),
    ("example", "122 NW 13th Ave, Cape Coral, FL 33993"),
    ("example", "14132 Trenton Ave, Orland Park, IL 60462"),
    ("example", "835 S Cobble Creek, Nixa, MO 65714"),
]

REFS = {
    "21106 Kenswick Meadows Ct, Humble, TX 77338":   (2443, 2343),
    "5914 Copper Lilly Lane, Spring, TX 77389":      (4391, 4296),
    "122 NW 13th Ave, Cape Coral, FL 33993":         (2917, 2851),
    "14132 Trenton Ave, Orland Park, IL 60462":      (2990, 2935),
    "835 S Cobble Creek, Nixa, MO 65714":            (3070, 3017),
}

# Solar oracle (we computed earlier)
ORACLE = {
    "3561 E 102nd Ct, Thornton, CO 80229":           2081,
    "1612 S Canton Ave, Springfield, MO 65802":      2757,
    "6310 Laguna Bay Court, Houston, TX 77041":      4186,
    "3820 E Rosebrier St, Springfield, MO 65809":    5566,
    "1261 20th Street, Newport News, VA 23607":      6118,
}

results = []
for kind, addr in ADDRESSES:
    print(f"\n── {kind}: {addr} ──")
    body = json.dumps({"address": addr}).encode()
    req = urllib.request.Request(
        f"{BASE}/api/quote",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            d = json.loads(r.read())
    except Exception as e:
        print(f"  ! {e}")
        continue
    elapsed = time.time() - t0
    cs = d.get("consensusSqft")
    print(f"  consensus: {cs} sqft  ({elapsed:.1f}s)")
    for m in d.get("results", []):
        print(f"    z{m.get('zoom')}={m.get('totalSqft')}sqft ({m['model']})")
    e = d.get("estimate")
    if e:
        print(f"  estimate total: ${e['total']:,.0f}  ({e['region']['city']}, {e['region']['state']}, {e['region']['pricingTier']} tier)")

    refA = refB = oracle = None
    if addr in REFS:
        refA, refB = REFS[addr]
        print(f"  ref A: {refA}  ref B: {refB}  Δvs avg: {(cs - (refA+refB)/2)/((refA+refB)/2)*100:+.1f}%")
    if addr in ORACLE:
        oracle = ORACLE[addr]
        print(f"  solar oracle: {oracle}  Δ: {(cs-oracle)/oracle*100:+.1f}%")

    results.append({
        "kind": kind,
        "address": addr,
        "consensusSqft": cs,
        "elapsed_s": elapsed,
        "estimate_total": e["total"] if e else None,
        "refA": refA,
        "refB": refB,
        "oracle": oracle,
    })

out = Path("/home/kokomo/dev/roofquote/eval/production-runs.json")
out.write_text(json.dumps(results, indent=2))
print(f"\nSaved to {out}")

# Print final submission table
print("\n" + "=" * 70)
print("SUBMISSION NUMBERS (5 test addresses, total sqft)")
print("=" * 70)
for r in results:
    if r["kind"] == "test":
        oracle_part = f"  oracle={r['oracle']}  Δ={(r['consensusSqft']-r['oracle'])/r['oracle']*100:+.1f}%" if r["oracle"] else ""
        print(f"  {r['address']:<50}  {r['consensusSqft']:>5} sqft{oracle_part}")
