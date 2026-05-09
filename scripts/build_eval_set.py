#!/usr/bin/env python3
"""
Build expanded eval set: take the 10 known addresses, generate ~15 additional
neighbor addresses by offsetting ~80m and reverse-geocoding, then run Solar API
on all to get oracle sqft.

Saves to /home/kokomo/dev/roofquote/eval/addresses.json
"""
import json, math, os, random, urllib.parse, urllib.request
from pathlib import Path

KEY = os.environ["GOOGLE_PLACES_API_KEY"]
random.seed(42)  # deterministic offsets

# Known addresses with their best-known reference (or None)
KNOWN = [
    # 5 example properties (refs from benchmark-measurements.md)
    {"id": "ex-humble-tx",          "address": "21106 Kenswick Meadows Ct, Humble, TX 77338",   "refA": 2443, "refB": 2343, "kind": "example"},
    {"id": "ex-spring-tx",          "address": "5914 Copper Lilly Lane, Spring, TX 77389",      "refA": 4391, "refB": 4296, "kind": "example"},
    {"id": "ex-cape-coral-fl",      "address": "122 NW 13th Ave, Cape Coral, FL 33993",         "refA": 2917, "refB": 2851, "kind": "example"},
    {"id": "ex-orland-park-il",     "address": "14132 Trenton Ave, Orland Park, IL 60462",      "refA": 2990, "refB": 2935, "kind": "example"},
    {"id": "ex-nixa-mo",            "address": "835 S Cobble Creek, Nixa, MO 65714",            "refA": 3070, "refB": 3017, "kind": "example"},
    # 5 test properties (no published reference)
    {"id": "test-thornton-co",      "address": "3561 E 102nd Ct, Thornton, CO 80229",           "kind": "test"},
    {"id": "test-springfield-mo-1", "address": "1612 S Canton Ave, Springfield, MO 65802",      "kind": "test"},
    {"id": "test-houston-tx",       "address": "6310 Laguna Bay Court, Houston, TX 77041",      "kind": "test"},
    {"id": "test-springfield-mo-2", "address": "3820 E Rosebrier St, Springfield, MO 65809",    "kind": "test"},
    {"id": "test-newport-news-va",  "address": "1261 20th Street, Newport News, VA 23607",      "kind": "test"},
]

def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "roofquote/0.1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def geocode(address):
    url = "https://maps.googleapis.com/maps/api/geocode/json?" + urllib.parse.urlencode({"address": address, "key": KEY})
    d = get_json(url)
    if d.get("status") != "OK": return None
    r = d["results"][0]
    return {"lat": r["geometry"]["location"]["lat"], "lng": r["geometry"]["location"]["lng"], "formatted": r["formatted_address"]}

def reverse_geocode(lat, lng):
    url = "https://maps.googleapis.com/maps/api/geocode/json?" + urllib.parse.urlencode({"latlng": f"{lat},{lng}", "key": KEY, "result_type": "street_address"})
    d = get_json(url)
    if d.get("status") != "OK" or not d.get("results"): return None
    r = d["results"][0]
    return {"lat": lat, "lng": lng, "formatted": r["formatted_address"]}

def solar(lat, lng):
    url = "https://solar.googleapis.com/v1/buildingInsights:findClosest?" + urllib.parse.urlencode({"location.latitude": lat, "location.longitude": lng, "key": KEY})
    d = get_json(url)
    err = d.get("error", {}).get("message")
    if err: return {"error": err}
    sp = d.get("solarPotential", {})
    rs = sp.get("wholeRoofStats", {})
    m2 = rs.get("areaMeters2", 0)
    return {
        "areaMeters2": m2,
        "areaSqft": round(m2 * 10.7639, 1),
        "segments": len(sp.get("roofSegmentStats", [])),
        "imageryQuality": sp.get("imageryQuality"),
        "imageryDate": sp.get("imageryDate"),
        "centerLat": sp.get("center", {}).get("latitude"),
        "centerLng": sp.get("center", {}).get("longitude"),
    }

def offset_meters(lat, lng, dnorth_m, deast_m):
    R = 6371000
    lat2 = lat + (dnorth_m / R) * (180 / math.pi)
    lng2 = lng + (deast_m / (R * math.cos(lat * math.pi / 180))) * (180 / math.pi)
    return lat2, lng2

# ─ resolve known addresses ─
print("=== Known addresses ===")
records = []
for k in KNOWN:
    g = geocode(k["address"])
    if not g:
        print(f"  ! skip {k['id']} (geocode failed)")
        continue
    s = solar(g["lat"], g["lng"])
    rec = {**k, "lat": g["lat"], "lng": g["lng"], "formatted": g["formatted"], "solarOracle": s}
    records.append(rec)
    sa = s.get("areaSqft", "ERR")
    print(f"  {k['id']:<24} {g['formatted'][:40]:<40} oracle={sa}")

# ─ generate neighbors ─
print("\n=== Generating neighbor addresses ===")
neighbors = []
NEIGHBORS_PER_KNOWN = 2  # 10 known × 2 = 20 attempts → ~15 valid
seen_addresses = {r["formatted"] for r in records}
for r in records:
    for i in range(NEIGHBORS_PER_KNOWN):
        # offset ~70-120m in a random direction
        angle = random.uniform(0, 2 * math.pi)
        dist = random.uniform(70, 120)
        dn, de = dist * math.cos(angle), dist * math.sin(angle)
        nlat, nlng = offset_meters(r["lat"], r["lng"], dn, de)
        rev = reverse_geocode(nlat, nlng)
        if not rev or rev["formatted"] in seen_addresses:
            print(f"  ! skip neighbor of {r['id']} #{i}")
            continue
        seen_addresses.add(rev["formatted"])
        s = solar(nlat, nlng)
        if "error" in s or s.get("areaSqft", 0) < 800 or s.get("areaSqft", 0) > 10000:
            print(f"  ! reject neighbor of {r['id']} #{i}: solar={s}")
            continue
        nid = f"nb-{r['id'].split('-', 1)[-1]}-{i}"
        nrec = {
            "id": nid,
            "address": rev["formatted"],
            "lat": nlat, "lng": nlng,
            "formatted": rev["formatted"],
            "kind": "neighbor",
            "parentId": r["id"],
            "solarOracle": s,
        }
        neighbors.append(nrec)
        print(f"  {nid:<24} {rev['formatted'][:40]:<40} oracle={s.get('areaSqft')}")

records.extend(neighbors)

out_path = Path("/home/kokomo/dev/roofquote/eval/addresses.json")
out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(json.dumps(records, indent=2))
print(f"\nWrote {len(records)} records to {out_path}")
print(f"  examples: {sum(1 for r in records if r['kind']=='example')}")
print(f"  tests:    {sum(1 for r in records if r['kind']=='test')}")
print(f"  neighbors:{sum(1 for r in records if r['kind']=='neighbor')}")
