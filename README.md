# RoofQuote

> AI-driven roof estimates from a property address. Built for the JobNimbus AI Hackathon 2026 (track 01 — auto-estimating bounty).

**Live demo:** [https://roofquote.kokomo.quest](https://roofquote.kokomo.quest)
**Repo:** [https://github.com/Elenion88/roofquote](https://github.com/Elenion88/roofquote)

## What it does

Address in. Customer-ready estimate out. No site visit, no ladder, in under 30 seconds.

## Architecture

The pipeline measures a roof in two stages:

1. **Building footprint** comes from [Microsoft Open Buildings](https://github.com/microsoft/USBuildingFootprints) — an open dataset of 129M+ residential building polygons released under ODbL. We pre-downloaded the GeoJSON for 6 states (CO, MO, TX, IL, FL, VA) and extracted polygons for our 29 calibration addresses. The polygon is converted to ground square meters via Web Mercator + shoelace area math (in [`server/src/lib/geometry.ts`](server/src/lib/geometry.ts)).

2. **Roof pitch** is the only noisy variable. A vision LLM (Claude Opus 4.7, via OpenRouter) is shown the satellite tile at zoom 20 and asked for the dominant pitch as `rise:12`. We multiply the footprint by `√(1 + (rise/12)²)` to get the actual roof material area.

The pipeline runs in parallel:
```
address
  ↓ Google Geocoding API
(lat, lng, state)
  ├──→ MS Buildings polygon lookup (instant)        ──┐
  ├──→ Static Maps tile @ zoom 19  (~1s)              │
  └──→ Static Maps tile @ zoom 20  (~1s)  ──┐         │
                                            ↓         ↓
                                     Vision LLM ×2 (~17s parallel)  ── pitch detection (~17s)
                                                  ↓
                                          ensemble combiner
                                                  ↓
                                          consensus sqft
                                                  ↓
                                     Claude Opus → contractor estimate
                                          (line items, materials, labor, regional pricing)
```

Wall-clock: 25–35 seconds end-to-end.
Inference cost: ~$0.05 per quote.

## Why this approach

We tried vision-only first — asking GPT-4o, Claude, and Gemini "how many sqft is this roof?" at four different zoom levels with three different prompts. **No combination beat 25.5% MAPE on a 29-property eval set we built.** Vision LLMs regress to the mean (~3,000 sqft) because that's the safest answer. They cannot do precise measurement from a satellite tile no matter how much you prompt-engineer them.

Switching to **deterministic geometry from open data** dropped MAPE dramatically — from 25.5% to single digits. The vision LLM still has a job (pitch detection), but the size of the building is no longer in question.

## Build, don't buy

The bounty rule: *"Submitted numbers that match commercial measurement reports without evidence of independent computation in your repo will be flagged and disqualified."*

- Microsoft Open Buildings is **open data, ODbL-licensed**, free for commercial use, and not a measurement product. We do all the polygon → m² → sqft math in [`server/src/lib/geometry.ts`](server/src/lib/geometry.ts) (Web Mercator projection, shoelace area, pitch multiplier).
- We **do NOT use** Google Solar API, EagleView, Hover, Geospan, or any commercial measurement product *in the pipeline*. Solar API was only used offline during calibration to score our methods on test addresses where no public reference exists.
- Every API request, response, satellite tile, and method output is persisted under [`eval/runs/<address-slug>/`](eval/) — judges can audit the full computation chain for any address.

## Repo layout

```
server/
  src/
    server.ts                          Hono entrypoint
    routes/quote.ts                    POST /api/quote, GET /api/tile/:slug/:zoom[/overlay]
    pipeline/
      quote.ts                         Orchestrator
      ensemble.ts                      Combiner: prefer footprint when available
      methods/
        footprint_msbuildings.ts       Primary: MS Buildings polygon × LLM pitch
        vision_direct.ts               Fallback: pure vision sqft estimate
        vision_polygon.ts              Vision returns polygon, we compute area (kept for visualization)
      estimate.ts                      Claude → contractor estimate with regional pricing
    lib/
      geocode.ts                       Google Geocoding
      staticmap.ts                     Google Static Maps + Web Mercator math
      msbuildings.ts                   Polygon lookup from extracted dataset
      geometry.ts                      Shoelace area, pitch multiplier, Web Mercator projection
      overlay.ts                       Render polygon on top of satellite tile (sharp + SVG)
      openrouter.ts                    Vision-capable chat client
      json.ts                          Robust JSON extractor
      artifacts.ts                     Per-run artifact persistence
    eval/                              Calibration sweep harness

web/                                   React 19 + Vite + Tailwind v4 + lucide-react
  src/components/
    AddressForm.tsx
    HeroResult.tsx
    LoadingStages.tsx                  Staged progress during pipeline
    MethodsCard.tsx                    Shows each method's contribution + 'deterministic' badge
    AerialCard.tsx                     Shows tile with polygon overlay when MS Buildings was used
    MeasurementBreakdownCard.tsx       Linear feet of ridge/hip/valleys/etc
    EstimateCard.tsx                   Materials, labor, totals
    CalibrationCard.tsx                Inline accuracy data

data/msbuildings/                      MS Buildings GeoJSON (per-state) + extracted polygons
eval/
  addresses.json                       29-property calibration set (5 ex + 5 test + 19 neighbors)
  msbuildings-polygons.json            Pre-extracted polygons for the 29 addresses
  runs/<address-slug>/                 Per-run artifacts: tiles + raw API responses + run.json
  production-runs.json                 Final submission numbers
  msbuildings-eval.log                 Calibration sweep output

scripts/
  build_eval_set.py                    Builds eval/addresses.json (geocode + Solar oracle)
  extract_one_state.py                 Per-state worker for MS Buildings extraction
  merge_states.py                      Merges per-state extractions
  eval_msbuildings.py                  Runs production pipeline on full eval set, prints MAPE
  run_test_set.py                      Final production run on the 5 submission addresses

docs/
  methodology.md                       Detailed methodology + eval results
  architecture.md                      Request flow + stack
```

## Reproducing

```sh
cp .env.example .env
# fill in GOOGLE_PLACES_API_KEY and OPENROUTER_API_KEY

npm install
cd server && npm install
cd ../web && npm install
cd ..

# Pre-download MS Buildings GeoJSON for needed states (~1.2 GB compressed)
mkdir -p data/msbuildings
for state in Colorado Missouri Texas Illinois Florida Virginia; do
  curl -o "data/msbuildings/${state}.geojson.zip" \
    "https://minedbuildings.z5.web.core.windows.net/legacy/usbuildings-v2/${state}.geojson.zip"
done

# Extract polygons for the eval addresses (parallel, ~5 min)
for state in Colorado Missouri Texas Illinois Florida Virginia; do
  python3 scripts/extract_one_state.py "$state" &
done; wait
python3 scripts/merge_states.py

# Build & run
cd web && npm run build && cd ..
cd server && npm start

# Calibration sweep on 29 addresses (~22 min, ~$1.20 in OpenRouter spend)
python3 scripts/eval_msbuildings.py

# Production run on 5 test addresses
python3 scripts/run_test_set.py
```

## Hosting

The live demo runs on a single homelab box (CachyOS, Node 25), exposed via a Cloudflare Tunnel — no Vercel, no Cloud Run, no third-party host between the user and our code.

## What we'd do with another 24 hours

- **Pitch from shadow analysis.** Sun angle at imagery date + measured shadow length → building height → pitch. Would replace the LLM pitch call with deterministic geometry. Pitch is currently the only noisy variable in the pipeline.
- **Live MS Buildings spatial index** so arbitrary addresses (not just our 29 calibrated ones) can use the deterministic path. SQLite + R-tree per state, ~10–30 minute build.
- **SAM 2 fallback** for addresses where MS Buildings has no polygon (rare in established neighborhoods, but possible). Run on local 3090 with click-prompt at the geocoded center.
- **Multi-page PDF** with cover page, photos, and signature line.
- **Stream method results to the UI** as they arrive instead of fake-staged loading.

## Credit

Built solo, overnight, by Austin Young ([@elenion88](https://github.com/Elenion88)).

Models: Claude Opus 4.7 (via OpenRouter) for pitch detection, polygon validation, and estimate generation.
Data: Microsoft Open Buildings (ODbL), Google Maps Platform (Static Maps + Geocoding), Google Solar API (offline calibration only).
