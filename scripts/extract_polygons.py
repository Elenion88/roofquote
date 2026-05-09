#!/usr/bin/env python3
"""
Extract Microsoft Buildings polygons near our eval addresses, using ijson
for streaming. Fast and correct.

Output: data/msbuildings/extracted/polygons.json
        and data/msbuildings/extracted/<state>-bbox.geojson  (for arbitrary-address queries)
"""
import json, math, sys, zipfile
from pathlib import Path
from collections import defaultdict
import ijson
from shapely.geometry import shape, Point
from shapely.geometry.polygon import Polygon

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
by_state = defaultdict(list)
for r in records:
    by_state[state_for(r)].append(r)

print(f"Loaded {len(records)} records across {len(by_state)} states")

def haversine_m(lat1, lng1, lat2, lng2):
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2-lat1); dl = math.radians(lng2-lng1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(a))

def polygon_area_m2_lonlat(coords):
    """Equal-area projection at centroid lat, then shoelace."""
    if len(coords) < 3: return 0
    lat0 = sum(c[1] for c in coords) / len(coords)
    R = 6371000
    cos_lat = math.cos(math.radians(lat0))
    pts = []
    for c in coords:
        x = R * math.radians(c[0]) * cos_lat
        y = R * math.radians(c[1])
        pts.append((x, y))
    a = 0
    for i in range(len(pts)):
        x1, y1 = pts[i]; x2, y2 = pts[(i+1) % len(pts)]
        a += x1*y2 - x2*y1
    return abs(a) / 2

# For each state, compute the union bbox we need to scan.
# Add 200m padding so we catch the right polygon even for off-center geocodes.
PAD_DEG = 0.0018  # ~200m at temperate latitudes

results = {r["id"]: None for r in records}

for state, recs in by_state.items():
    zip_path = DATA_DIR / f"{state}.geojson.zip"
    if not zip_path.exists():
        print(f"!! {zip_path} missing — skipping")
        continue
    print(f"\n── {state}: {zip_path.stat().st_size/1024/1024:.0f} MB, {len(recs)} addresses ──")

    # Compute per-record bboxes for filtering
    bboxes = [(r, r["lng"]-PAD_DEG, r["lat"]-PAD_DEG, r["lng"]+PAD_DEG, r["lat"]+PAD_DEG) for r in recs]

    candidates = {r["id"]: [] for r in recs}

    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if n.endswith(".geojson")]
        if not names:
            print(f"  no .geojson in zip"); continue
        with zf.open(names[0]) as f:
            n_features = 0
            n_matches = 0
            for feat in ijson.items(f, "features.item"):
                n_features += 1
                if n_features % 1000000 == 0:
                    print(f"    {n_features:>10,} scanned, {n_matches} matches…")
                geom = feat.get("geometry") or {}
                if geom.get("type") not in ("Polygon", "MultiPolygon"):
                    continue
                # Compute polygon outer ring quickly without shapely first
                if geom["type"] == "Polygon":
                    coords = geom["coordinates"][0]
                else:
                    coords = max(geom["coordinates"], key=lambda p: len(p[0]))[0]
                lons = [c[0] for c in coords]; lats = [c[1] for c in coords]
                fb_min_lon, fb_max_lon = min(lons), max(lons)
                fb_min_lat, fb_max_lat = min(lats), max(lats)
                # Check overlap with any record bbox
                for rec, b_min_lon, b_min_lat, b_max_lon, b_max_lat in bboxes:
                    if fb_max_lon < b_min_lon or fb_min_lon > b_max_lon: continue
                    if fb_max_lat < b_min_lat or fb_min_lat > b_max_lat: continue
                    candidates[rec["id"]].append(coords)
                    n_matches += 1

            print(f"  total: {n_features:,} features, {n_matches} candidate matches")

    # Pick best candidate per record
    for r in recs:
        cands = candidates[r["id"]]
        if not cands:
            print(f"  {r['id']:<26} NO POLYGON")
            continue
        scored = []
        for coords in cands:
            cx = sum(c[0] for c in coords) / len(coords)
            cy = sum(c[1] for c in coords) / len(coords)
            d = haversine_m(r["lat"], r["lng"], cy, cx)
            a = polygon_area_m2_lonlat(coords)
            scored.append((d, a, coords))
        scored.sort()
        # pick polygon whose footprint is residential-sized (60-1500 m²) AND closest
        scored = [s for s in scored if 50 < s[1] < 2500]
        if not scored:
            print(f"  {r['id']:<26} candidates exist but none are residential-sized")
            continue
        d, a, coords = scored[0]
        results[r["id"]] = {
            "centroidDist_m": round(d, 2),
            "footprint_m2": round(a, 2),
            "footprint_sqft": round(a * 10.7639, 1),
            "polygon_lonlat": coords,
            "n_candidates": len(cands),
        }
        print(f"  {r['id']:<26} dist={d:5.1f}m  fp={a*10.7639:>5.0f}sqft  ({len(cands)} candidates)")

# Merge with addresses
out_records = []
for r in records:
    out_records.append({
        **{k: r[k] for k in ("id", "address", "lat", "lng", "kind")},
        "msbuildings": results[r["id"]],
    })

out_path = OUT_DIR / "polygons.json"
out_path.write_text(json.dumps(out_records, indent=2))
print(f"\nWrote {len(out_records)} records to {out_path}")
hits = sum(1 for r in out_records if r["msbuildings"])
print(f"  with polygon: {hits}/{len(out_records)} ({hits/len(out_records)*100:.0f}%)")
