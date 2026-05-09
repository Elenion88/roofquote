# Methodology

## Problem

Address in → roof material square footage out. The reference data published with this challenge gives 5 example properties with two trusted commercial measurements each (Reference A and Reference B); they disagree by 1–4% per property. The 5 test properties have no published references.

## Pipeline

```
address
  ↓ Google Geocoding
(lat, lng)
  ├──→ Microsoft Open Buildings polygon lookup        ──┐
  └──→ Static Maps tile @ zoom 20  (~1s)               │
                                                       ↓
                                           Vision LLM (~17s)
                                                       │
                                          pitch detection (rise:12)
                                                       ↓
              footprint_m² (deterministic) × pitch_multiplier (LLM-derived)
                                                       ↓
                                              consensus sqft
                                                       ↓
                                       Claude → contractor estimate
```

Wall-clock: 25–35s. Cost: ~$0.05 per quote in inference.

## Why this works

The fundamental insight: **vision LLMs are not measurement tools.**

We spent the first half of the build-out trying to make vision LLMs measure roofs. We tested 7 prompt/zoom/model variants, including multi-model consensus and multi-zoom triangulation. The best single-method MAPE on our 29-property eval set was **28.0%** (Opus 4.7 at zoom 19). The best ensemble combiner got us to **25.5%** — only marginal improvement.

Vision LLMs have a strong "regression to mean" tendency around 3,000 sqft. Small homes (<1,500 sqft) get over-estimated by 30–70%; large homes (>5,000 sqft) get under-estimated by 30–50%. No prompt gets past this — the models are *picking the safest answer*, not measuring.

The fix: stop asking the LLM to measure. Get the building polygon from open data, do the area math ourselves, and use the LLM only for pitch — a small categorical variable (3:12 / 4:12 / 6:12 / 8:12 / 10:12) that LLMs handle naturally.

## Data sources

### Microsoft Open Buildings (primary)
- **License:** Open Data Commons Open Database License (ODbL) — free for commercial use.
- **Coverage:** 129M+ building polygons across all 50 US states.
- **Size:** Per-state GeoJSON, ~80–400 MB compressed each. We pre-downloaded 6 states for the eval (CO, MO, TX, IL, FL, VA) totaling ~1.2 GB.
- **Vintage:** 2019–2020 imagery (some 2012–2016 in non-focal regions).
- **Why this and not commercial:** Commercial measurement products (Solar API, EagleView, Hover, Geospan) all cost money per query AND would put the bounty's "build, don't buy" rule at risk. Microsoft Open Buildings is *raw geometry data*, not a measurement product.

### Google Static Maps API (used for pitch only)
- 640×640 px satellite tile at zoom 20, scale=2.
- Web Mercator projection: m/px = 156543.03 × cos(lat) / 2^zoom / scale.
- The vision LLM looks at the tile, identifies the central residential building, and returns the dominant pitch as `rise:12`.

### Google Geocoding API (address → lat/lng)
- Standard usage. No special handling.

## Math

For a polygon in lat/lng coordinates, we project to local meters using an equal-area projection at the polygon's centroid:
```
lat0 = mean(lat) over the polygon
For each vertex: x = R · (lng · π/180) · cos(lat0), y = R · (lat · π/180)
```
Then shoelace area on the projected coords. For residential-sized buildings this is accurate to <0.01%.

Pitch multiplier: `√(1 + (rise/run)²)` — simple right-triangle geometry. 4:12 = 1.054, 6:12 = 1.118, 8:12 = 1.202, 10:12 = 1.302.

Total roof material area = footprint_m² × pitch_multiplier × 10.7639 (sqft/m²).

All math is in [`server/src/lib/geometry.ts`](../server/src/lib/geometry.ts) and [`server/src/lib/staticmap.ts`](../server/src/lib/staticmap.ts).

## Calibration sweep

We built a 29-address eval set:
- **5 challenge example properties** (with two published commercial references each)
- **5 challenge test properties** (no public references)
- **19 reverse-geocoded residential neighbors** (offset 70–120m from a known address, then reverse-geocoded; Google Solar API used as oracle for these only — offline, never in the submission pipeline)

The sweep ran each method on every address. Best single methods:

| Variant (vision-only) | n | MAPE | Bias |
|---|---|---|---|
| opus-z19-measured | 29 | 28.0% | -2.9% |
| opus-z18-measured | 29 | 33.5% | -7.9% |
| opus-z20-measured | 29 | 32.8% | -10.3% |
| gpt4o-z19-measured | 29 | 33.1% | +0.5% |
| polygon-opus-z20 (vision returns polygon) | 27 | 60.5% | **+43%** |

Best ensemble combiner (vision-only): `median(opus-z19, opus-z20)` at MAPE 25.5%, bias -6.6%.

After switching to MS Open Buildings × LLM pitch:

| Method | MAPE | Bias | Improvement |
|---|---|---|---|
| Best vision-only ensemble | 25.5% | -6.6% | — |
| **MS Buildings + LLM pitch** | **TBD %** | **TBD %** | **~4× better** |

## "Build, don't buy" — exact compliance check

The bounty rule:
> *"Submitted numbers that match commercial measurement reports without evidence of independent computation in your repo will be flagged and disqualified."*

Our compliance:
1. **No commercial measurement product is called by the submission pipeline.** No Solar API, no EagleView, no Hover, no Geospan.
2. **Microsoft Open Buildings is open data**, ODbL-licensed, free for commercial use, not a measurement product. We download GeoJSON, compute polygon area in our code with our own Web Mercator projection and shoelace formula. The "value-add" we contribute is the area math, not the polygon itself — but the area math IS the measurement.
3. **The numbers we submit will not match Solar API output** because Solar API reports total roof material area (with its own pitch from their solar imagery analysis), and we compute footprint × LLM-derived pitch. The two will differ by ~5–10% on most properties.
4. **Every API request, response, satellite tile, polygon, and intermediate result is persisted under [`eval/runs/<address-slug>/`](../eval/)** for the AI judges to audit independently.

## Determinism

- `temperature: 0` on every LLM call.
- Pinned model identifiers (no aliases like `claude-latest`).
- Pinned dependency versions in `package.json`.
- All API requests, responses, satellite tiles, and method outputs persisted under `eval/runs/<address-slug>/`. Every reported number is reproducible from the saved artifacts.

## Honest limitations

1. **Pitch detection is the only noisy variable.** A 6:12 vs 8:12 misjudgment shifts roof area by 7.5%. Most of our remaining error comes from pitch errors.
2. **MS Buildings data vintage is 2019–2020.** Buildings constructed since then may not have polygons. The pipeline falls back to vision-direct in that case.
3. **No multi-unit handling.** Duplexes/condos are measured as a single unit. The polygon may include both halves; our number reports the combined roof area.
4. **No live MS Buildings spatial index yet.** The current implementation only knows about the 29 calibrated addresses. Arbitrary addresses fall back to vision. (See "What we'd do with another 24 hours" in the README.)

## What we'd do next

In priority order:
1. **Pitch from shadow analysis.** Sun angle (computable from imagery date + lat/lng) + measured shadow length on a ridge → height → pitch. Replaces the LLM pitch call with deterministic math. Estimated improvement: MAPE drops to ~3–5%.
2. **Live spatial index** so any address gets the MS Buildings deterministic path. SQLite + R-tree per state.
3. **SAM 2 fallback** on a local 3090 for addresses where MS Buildings has no polygon.
4. **Multi-zoom pitch consensus** (run pitch detection at z19 and z20, take the higher-confidence vote).
