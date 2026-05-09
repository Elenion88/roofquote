#!/usr/bin/env python3
"""Extract polygons for a single state — runs as a worker for parallel extraction.

Usage: python3 extract_one_state.py <STATE_NAME>
Output: data/msbuildings/extracted/<state>-results.json
"""
import json, math, sys, zipfile
from pathlib import Path
from collections import defaultdict
import ijson

DATA_DIR = Path("/home/kokomo/dev/roofquote/data/msbuildings")
EVAL_PATH = Path("/home/kokomo/dev/roofquote/eval/addresses.json")
OUT_DIR = Path("/home/kokomo/dev/roofquote/data/msbuildings/extracted")
OUT_DIR.mkdir(exist_ok=True)

STATE_FOR_ADDRESS = {
    "test-thornton-co":           "Colorado",
    "test-springfield-mo-1":      "Missouri",
    "test-houston-tx":            "Texas",
    "test-springfield-mo-2":      "Missouri",
    "test-newport-news-va":       "Virginia",
    "ex-humble-tx":               "Texas",
    "ex-spring-tx":               "Texas",
    "ex-cape-coral-fl":           "Florida",
    "ex-orland-park-il":          "Illinois",
    "ex-nixa-mo":                 "Missouri",
}

def state_for(rec):
    if rec["id"] in STATE_FOR_ADDRESS: return STATE_FOR_ADDRESS[rec["id"]]
    pid = rec.get("parentId")
    if pid in STATE_FOR_ADDRESS: return STATE_FOR_ADDRESS[pid]
    raise ValueError(f"no state for {rec['id']}")

records = json.loads(EVAL_PATH.read_text())

target_state = sys.argv[1]
recs_for_state = [r for r in records if state_for(r) == target_state]
print(f"[{target_state}] {len(recs_for_state)} addresses to match")

zip_path = DATA_DIR / f"{target_state}.geojson.zip"
if not zip_path.exists():
    print(f"[{target_state}] missing zip {zip_path}", file=sys.stderr)
    sys.exit(1)

PAD_DEG = 0.0018
bboxes = [(r, r["lng"]-PAD_DEG, r["lat"]-PAD_DEG, r["lng"]+PAD_DEG, r["lat"]+PAD_DEG) for r in recs_for_state]

def haversine_m(lat1, lng1, lat2, lng2):
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2-lat1); dl = math.radians(lng2-lng1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(a))

def polygon_area_m2_lonlat(coords):
    if len(coords) < 3: return 0
    lat0 = sum(c[1] for c in coords) / len(coords)
    R = 6371000
    cos_lat = math.cos(math.radians(lat0))
    pts = [(R * math.radians(c[0]) * cos_lat, R * math.radians(c[1])) for c in coords]
    a = 0
    for i in range(len(pts)):
        x1, y1 = pts[i]; x2, y2 = pts[(i+1) % len(pts)]
        a += x1*y2 - x2*y1
    return abs(a) / 2

candidates = {r["id"]: [] for r in recs_for_state}

with zipfile.ZipFile(zip_path) as zf:
    names = [n for n in zf.namelist() if n.endswith(".geojson")]
    with zf.open(names[0]) as f:
        n_features = 0
        for feat in ijson.items(f, "features.item"):
            n_features += 1
            if n_features % 2000000 == 0:
                print(f"[{target_state}] {n_features:,} scanned, {sum(len(c) for c in candidates.values())} matches…")
            geom = feat.get("geometry") or {}
            if geom.get("type") not in ("Polygon", "MultiPolygon"):
                continue
            if geom["type"] == "Polygon":
                coords = [(float(c[0]), float(c[1])) for c in geom["coordinates"][0]]
            else:
                ring = max(geom["coordinates"], key=lambda p: len(p[0]))[0]
                coords = [(float(c[0]), float(c[1])) for c in ring]
            lons = [c[0] for c in coords]; lats = [c[1] for c in coords]
            fb_min_lon, fb_max_lon = min(lons), max(lons)
            fb_min_lat, fb_max_lat = min(lats), max(lats)
            for rec, b_min_lon, b_min_lat, b_max_lon, b_max_lat in bboxes:
                if fb_max_lon < b_min_lon or fb_min_lon > b_max_lon: continue
                if fb_max_lat < b_min_lat or fb_min_lat > b_max_lat: continue
                candidates[rec["id"]].append(coords)
        print(f"[{target_state}] DONE — {n_features:,} features scanned")

# Pick best candidate per record
results = []
for r in recs_for_state:
    cands = candidates[r["id"]]
    if not cands:
        results.append({**{k: r[k] for k in ("id","address","lat","lng","kind")}, "msbuildings": None})
        print(f"[{target_state}]   {r['id']:<26} NO POLYGON")
        continue
    scored = []
    for coords in cands:
        cx = sum(c[0] for c in coords) / len(coords)
        cy = sum(c[1] for c in coords) / len(coords)
        d = haversine_m(r["lat"], r["lng"], cy, cx)
        a = polygon_area_m2_lonlat(coords)
        scored.append((d, a, coords))
    scored = [s for s in scored if 50 < s[1] < 2500]
    if not scored:
        results.append({**{k: r[k] for k in ("id","address","lat","lng","kind")}, "msbuildings": None})
        print(f"[{target_state}]   {r['id']:<26} no residential-sized polygons")
        continue
    scored.sort()
    d, a, coords = scored[0]
    results.append({
        **{k: r[k] for k in ("id","address","lat","lng","kind")},
        "msbuildings": {
            "centroidDist_m": round(d, 2),
            "footprint_m2": round(a, 2),
            "footprint_sqft": round(a * 10.7639, 1),
            "polygon_lonlat": coords,
            "n_candidates": len(cands),
        },
    })
    print(f"[{target_state}]   {r['id']:<26} dist={d:5.1f}m  fp={a*10.7639:>5.0f}sqft  ({len(cands)} candidates)")

out_path = OUT_DIR / f"{target_state}-results.json"
out_path.write_text(json.dumps(results, indent=2))
print(f"[{target_state}] wrote {len(results)} records to {out_path}")
