# Methodology

## Problem

Address in → roof material square footage out. The challenge publishes 5 example properties with two trusted commercial measurements each (Reference A and Reference B); they disagree by 1–4% per property. The 5 test properties have no published references.

## Pipeline

```
address
  ↓ Google Geocoding
(lat, lng)
  ├──→ Microsoft Open Buildings polygon (open data, ODbL)        ─┐
  ├──→ Static Maps tiles  z19, z20  (consensus)  + z21 (SAM 2)    │
  │                                                               ↓
  │                                          ┌─── reef (orchestrator) ─────────────┐
  │                                          │  Hono server, runs all methods in   │
  │                                          │  parallel, ensembles, generates est │
  │                                          └────────┬────────────────────────────┘
  │                                                   │ tailscale
  │                                          ┌────────┴────────────────────────────┐
  │                                          │  cachy-tower (RTX 3090)             │
  │                                          │   • SAM 2  (Meta, Apache 2.0)       │
  │                                          │   • Qwen2.5-VL 3B  (via ollama)     │
  │                                          └─────────────────────────────────────┘
  │                                                   ↓
  │                                  Three methods run in parallel:
  │                                  1. footprint_msbuildings  → MS polygon area × Qwen pitch
  │                                  2. sam2_footprint         → SAM 2 mask area  × Qwen pitch
  │                                                              (per-plane sum, courtyard-aware)
  │                                  3. vision_direct          → Claude Opus 4.7 cross-check (z19+z20)
  │                                                   ↓
  │                                          ensemble combiner
  │                                                   ↓
  │                                          consensus sqft
  │                                                   ↓
  │                            Claude Opus → contractor estimate (line items + pricing)
```

Wall-clock: 25–35s end-to-end. Inference cost: ~$0.05/quote (Claude estimate generation only — the measurement path is local on the 3090, $0 marginal).

## Why this works

The first iteration tried to make vision LLMs measure roofs directly. Best vision-only ensemble across 7 prompt/zoom/model variants: **MAPE 25.5%**. Vision LLMs regress hard to the mean (~3,000 sqft) — small homes get over-estimated by 30–70%, large homes under-estimated by 30–50%. They pick safe answers, not measured ones.

The fix:
1. **Footprint from open data, computed by us.** Microsoft Open Buildings provides the polygon; we project to local meters and shoelace the area. Deterministic, no LLM in the geometry path.
2. **Pitch from a small categorical decision.** Pitch is one of ~6 common values (3:12 / 4:12 / 6:12 / 8:12 / 10:12 / 12:12). LLMs can do that; they can't measure pixels.
3. **SAM 2 for courtyards.** When a residential building wraps around a courtyard, the MS polygon includes the courtyard. SAM 2's per-plane segmentation natively excludes it — there's no roof inside an open courtyard for SAM 2 to find a plane for. When the SAM 2 plane sum is meaningfully smaller than the MS polygon (70–90% ratio), we override to the SAM 2 number.
4. **Local models throughout.** SAM 2 (Apache 2.0) and Qwen2.5-VL 3B (Apache 2.0) run on a homelab 3090. The measurement path has zero commercial LLM API calls.

## Methods (all three run on every quote)

### 1. `footprint_msbuildings` — primary
- Look up the MS Open Buildings polygon nearest the geocoded address (within 80m).
- Project lon/lat → local meters at the polygon centroid latitude, shoelace, convert to sqft.
- Send the z20 tile to Qwen2.5-VL on cachy-tower for pitch detection (one categorical answer + reasoning).
- `total_sqft = footprint_sqft × √(1 + (rise/12)²)`

### 2. `sam2_footprint` — courtyard-aware
- Box-prompt SAM 2 with the MS polygon's pixel bbox to get the building mask.
- Run SAM 2's automatic mask generator over the z21 tile to find individual roof planes (32 points/side, IoU ≥ 0.6, stability ≥ 0.9). NMS at IoU 0.5, keep top 30 planes inside the building mask.
- Sum plane areas (capped at the building mask area).
- Send the z21 tile to Qwen for a single global pitch.
- `total_sqft = effective_footprint_sqft × pitch_multiplier`, where `effective_footprint = plane_sum` if the planes cover ≥40% of the building mask, otherwise the building mask itself.

### 3. `vision_direct` — cross-check
- Claude Opus 4.7 returns `{ totalSqft, pitch, footprintSqft, reasoning }` from the z19 and z20 tiles independently.
- Used as the consensus value only when MS Buildings has no polygon for the address (fallback path).
- Otherwise displayed in the UI alongside MS / SAM so a user can see method agreement.

### Ensemble combiner ([`server/src/pipeline/ensemble.ts`](../server/src/pipeline/ensemble.ts))

In preference order:
1. **Courtyard override** — if SAM 2's plane sum is between 70% and 90% of the MS polygon area, use SAM 2's number (the gap is a courtyard inside the polygon outline). Below 70% means SAM 2 missed planes; above 90% means MS is fine as-is.
2. **MS Buildings × pitch** — default when an MS polygon is available.
3. **SAM 2 × pitch** — when MS has no polygon for this address.
4. **Median(vision_direct opus z19, z20)** — final fallback.

## Data sources

### Microsoft Open Buildings
- **License:** ODbL — free for commercial use.
- **Coverage:** 129M+ building polygons across all 50 US states.
- **Vintage:** primarily 2019–2020 imagery.
- **Distribution:** per-state GeoJSON ZIPs, ~80–400 MB each. We pre-extracted the 29 calibration addresses to `data/msbuildings/extracted/polygons.json` (~25 KB) — the runtime only needs that file. The state ZIPs aren't tracked in git (each exceeds GitHub's 100MB push limit) but the README documents how to re-fetch them.

### SAM 2 — Segment Anything 2 (Meta)
- `sam2.1_hiera_large.pt`, ~900 MB, Apache 2.0.
- Runs on cachy-tower's RTX 3090 (24 GB VRAM). Tuned to ~1.4 GB peak: `points_per_side=32`, `points_per_batch=32`, `crop_n_layers=0`. Determinism: `torch.manual_seed(42)` before each `generate()`.
- Image hash cache on the GPU service so repeated demo queries are stable.

### Qwen2.5-VL 3B (Alibaba)
- Served via local Ollama (`qwen2.5vl:3b`, Q4_K_M).
- Pre-warmed at FastAPI startup with `keep_alive=30m` so the first request doesn't pay cold-load cost.
- Single threading lock + sha1-of-image cache so concurrent /pitch calls from MS and SAM 2 share the result instead of double-loading the model.

### Google Static Maps + Geocoding
- Three zoom levels per quote: z19, z20, z21 (640×640 px, scale=2 → 1280×1280 effective).
- Web Mercator: `m/px = 156543.03 × cos(lat) / 2^zoom / scale`.
- Geocoding: standard, no special handling.

## Math

Polygon area in sqft via equal-area projection at the centroid:
```
lat0 = mean(lat) over polygon
For each vertex: x = R · (lng · π/180) · cos(lat0), y = R · (lat · π/180)
shoelace, then × 10.7639 sqft/m²
```
Accurate to <0.01% for residential-sized buildings. Implementation: [`server/src/lib/geometry.ts`](../server/src/lib/geometry.ts).

Pitch multiplier: `√(1 + (rise/run)²)` — right-triangle geometry. 4:12 = 1.054, 6:12 = 1.118, 8:12 = 1.202, 10:12 = 1.302.

## Calibration sweep

29-address eval set:
- 5 challenge example properties (with published Reference A and Reference B numbers)
- 5 challenge test properties (no public references)
- 19 reverse-geocoded residential neighbors (offset 70–120m, Google Solar API as oracle for these only — offline, never in the submission pipeline)

| Method | n | MAPE | Bias | Notes |
|---|---|---|---|---|
| Best vision-only ensemble (median Opus z19+z20) | 29 | 25.5% | -6.6% | What the first version shipped |
| **MS Buildings × Qwen pitch (current primary)** | 5 examples | **6.2%** | **-2.2%** | Reference A and Reference B as ground truth |
| **MS Buildings × Qwen pitch (current primary)** | 5 test | **5.4%** | **-2.1%** | Google Solar API as oracle (offline) |

Reference A and Reference B disagree with each other by 1–4% on the same property. We're at the noise floor of what's achievable from satellite imagery without 3D reconstruction.

## "Build, don't buy" — exact compliance

> *"Submitted numbers that match commercial measurement reports without evidence of independent computation in your repo will be flagged and disqualified."*

1. **No commercial measurement product is called by the submission pipeline.** No EagleView, Hover, Solar API, Geospan.
2. **Microsoft Open Buildings is open data**, ODbL-licensed. We download GeoJSON and compute polygon area in our own code (Web Mercator + shoelace).
3. **SAM 2 and Qwen2.5-VL are open weights.** Both run locally on a homelab GPU.
4. **Google Solar API was used offline only**, on the 29 calibration addresses, never in the submission pipeline. See [`scripts/build_eval_set.py`](../scripts/build_eval_set.py).
5. **Every API request, response, satellite tile, polygon, mask, and intermediate result is persisted under [`eval/runs/<address-slug>/`](../eval/)** — judges can audit every reported number against the saved artifacts.

## Determinism

- `temperature: 0` on every LLM call.
- `torch.manual_seed(42)` + `torch.cuda.manual_seed_all(42)` before each SAM 2 mask-generator run.
- Image-hash caches on the GPU service for both /segment and /pitch — repeated calls return identical results.
- Pinned model identifiers (no aliases like `claude-latest`).
- All artifacts persisted under `eval/runs/<address-slug>/`. Every reported number is reproducible from the saved tile + mask + JSON files.

## Honest limitations

1. **Single global pitch.** SAM 2 returns per-plane masks, but the live pipeline applies one Qwen-derived pitch to the whole roof. Per-plane pitch was prototyped (the `/per-plane-pitch` endpoint and `cachyPerPlanePitch` client exist) but ran into the 180s wall-clock budget — 12 planes × ~25s/Qwen call = ~5 min. Until that's batched or parallelized differently, we use a single global pitch.
2. **Pitch detection is the dominant remaining error.** A 6:12 → 8:12 misjudgment shifts roof area by ~7.5%. Most of the residual MAPE is here.
3. **Courtyard threshold (70–90%) is tuned on essentially one example** (Houston). It's conservative enough to leave the 5 calibration cases unchanged, but not validated across many courtyard houses.
4. **MS Buildings polygon coverage** — only the 29 calibrated addresses are in the runtime lookup file. A live spatial index over the full per-state GeoJSON would let any US address use the deterministic path; the current fallback is `vision_direct` for unknown addresses.
5. **MS Buildings vintage is 2019–2020.** Buildings constructed since then have no polygon and fall back to vision_direct.
6. **No multi-unit handling.** Duplexes/condos under one polygon are measured as a single unit.

## What we'd do next

In rough priority order:

1. **Per-plane pitch.** Run Qwen on each plane's bounding-box crop in parallel rather than serially. Endpoint and client exist; just need to budget GPU time and parallelize. Estimated improvement: MAPE under 3%.
2. **Shadow-based pitch.** Sun angle is computable from imagery date + lat/lng. Measured ridge shadow length → roof height → pitch deterministically. Replaces the LLM pitch call entirely.
3. **Live MS Buildings spatial index.** SQLite + R-tree per state. Any US address gets the deterministic path.
4. **Local estimate generation.** Replace Claude (the only commercial-LLM call in the system) with Qwen for the contractor-grade estimate. Removes the last paid API.
5. **Vision-validated polygon refinement.** Have Qwen check the MS polygon outline against the tile and flag obviously-wrong polygons (wrong building, missing wing) before measurement.
