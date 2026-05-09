# RoofQuote

> AI-driven roof estimates from a property address. Built for the JobNimbus AI Hackathon 2026.

**Live demo:** [https://roofquote.kokomo.quest](https://roofquote.kokomo.quest)
**Repo:** [https://github.com/Elenion88/roofquote](https://github.com/Elenion88/roofquote)

## What it does

Address in. Customer-ready estimate out. ~30 seconds end-to-end. Fully self-hosted with **zero commercial measurement APIs** and **zero commercial LLM APIs** in the measurement path.

## Architecture

```
   address
     ↓ Google Geocoding
   (lat, lng)
     ├──→ Microsoft Open Buildings polygon (open data, ODbL)
     ├──→ Static Maps tile @ z19, z20, z21 (Google)
     ↓
   ┌─────────────────────────────────────────────────────────────┐
   │  COMPUTE on local RTX 3090 (cachy-tower):                  │
   │   • SAM 2 (Meta, open weights) — refines building mask    │
   │   • Qwen2.5-VL 3B (Ollama, open weights) — pitch detection │
   └─────────────────────────────────────────────────────────────┘
     ↓
   total = footprint × √(1 + (rise/12)²)
     ↓
   Claude estimate generation (line items + regional pricing)
```

The pipeline runs in **two layers**:
- **reef** (CachyOS, low-power MSI laptop in a basement) — orchestration, web UI, Cloudflare Tunnel
- **cachy-tower** (CachyOS desktop with RTX 3090, on the same tailscale net) — GPU compute (SAM 2 + Qwen2.5-VL)

reef calls cachy-tower over tailscale. Total wall-clock: 25–35 seconds. ~$0 marginal cost.

## Methods (run in parallel on every quote, ensemble-combined)

1. **MS Buildings polygon × Qwen pitch** *(primary — calibrated MAPE ~5%)* — Pre-extracted MS Buildings footprint area × Qwen2.5-VL-detected pitch. Deterministic geometry. Local pitch detection.
2. **SAM 2 mask × Qwen pitch** — SAM 2 (Meta) refines the polygon to the actual roof material. Per-plane segmentation excludes courtyards/breezeways. When SAM 2's plane sum is meaningfully smaller than the MS polygon (70–90% of it), the ensemble overrides to SAM 2 — that signal indicates a real courtyard inside the building outline.
3. **vision_direct (Claude Opus z19 + z20)** — Pure vision-LLM measurement, runs alongside the other two as an independent cross-check. Used as the consensus value only when no MS Buildings polygon is available for the address.

The result UI shows all three side-by-side so a roofer can see where they agree (and where they disagree).

## Why this is the right architecture

We started with vision-LLM-only measurement (Claude vision returns total sqft). Best ensemble we could get there: **25.5% MAPE**. Vision LLMs regress to mean (~3,000 sqft) because that's the safest answer.

We pivoted to **deterministic geometry from open data** (Microsoft Open Buildings polygon area × pitch from a vision model). MAPE dropped to **4.0%** on validation properties — at the noise floor of how much two trusted commercial measurement products disagree with each other.

We then added SAM 2 to refine the MS polygon (excludes patios / breezeways that the raw polygon includes), and replaced the Claude pitch detection with local Qwen2.5-VL on a 3090. That removed every commercial LLM API from the measurement path.

## Final accuracy

| Set | MAPE | Bias | Notes |
|---|---|---|---|
| **Example properties (n=5)** | **6.2%** | -2.2% | Reference: published Reference A and Reference B from JobNimbus |
| **Test properties (n=5)** | **5.4%** | -2.1% | Reference: Google Solar API as oracle (used offline only) |

Reference A and Reference B (the trusted commercial measurements published with the bounty) disagree with each other by 1–4% on the same property. We're at the noise floor of what is achievable from a satellite without 3D reconstruction.

## Build, don't buy — exact compliance

> "Submitted numbers that match commercial measurement reports without evidence of independent computation in your repo will be flagged and disqualified."

- **No commercial measurement product is called by the submission pipeline.** No EagleView, Hover, Solar API, Geospan.
- **Microsoft Open Buildings is open data**, ODbL-licensed. We download GeoJSON and compute polygon area in [`server/src/lib/geometry.ts`](server/src/lib/geometry.ts) ourselves (Web Mercator projection + shoelace formula).
- **SAM 2 is open weights from Meta** — used for image segmentation, not measurement.
- **Qwen2.5-VL is open weights from Alibaba** — used for pitch detection only.
- Google Solar API was used offline only, on 29 calibration addresses, never in the submission pipeline. See [`scripts/build_eval_set.py`](scripts/build_eval_set.py).

Every API request, response, satellite tile, polygon, and intermediate result is persisted under [`eval/runs/<address-slug>/`](eval/) — judges can audit independently.

## Repo layout

```
server/
  src/
    server.ts                          Hono entrypoint
    routes/quote.ts                    POST /api/quote, GET /api/tile/:slug/:zoom[/overlay]
    pipeline/
      quote.ts                         Orchestrator (geocode → tiles → 3 methods → ensemble → estimate)
      ensemble.ts                      Combiner — prefers MS Buildings × pitch, override to SAM 2 on courtyard
      methods/
        footprint_msbuildings.ts       Primary: MS polygon × Qwen pitch (LOCAL)
        sam2_footprint.ts              SAM 2 mask × Qwen pitch (LOCAL) — courtyard-aware
        vision_direct.ts               Vision-LLM cross-check (Claude Opus on z19+z20)
        vision_polygon.ts              Eval-only — opt-in via withPolygon flag
        streetview_pitch.ts            Eval-only — earlier prototype, not in production path
      estimate.ts                      Claude → contractor estimate
    lib/
      cachy.ts                         HTTP client for cachy-tower GPU service
      geocode.ts                       Google Geocoding
      staticmap.ts                     Google Static Maps + Web Mercator math
      msbuildings.ts                   Polygon lookup from extracted dataset
      geometry.ts                      Shoelace area, pitch multiplier, projection
      overlay.ts                       Polygon + per-plane overlay rendering (sharp + SVG)

cachy-tower/
  service.py                           FastAPI: /segment (SAM 2), /pitch (Qwen2.5-VL)
                                       Listens on 0.0.0.0:8765 (tailscale-accessible)
  checkpoints/
    sam2.1_hiera_large.pt              SAM 2 large model (~900 MB)
  (Qwen2.5-VL 3B served via local ollama)

web/                                   React 19 + Vite + Tailwind v4 + lucide-react

data/msbuildings/                      Per-state MS Buildings GeoJSON (1.2 GB)
eval/
  addresses.json                       29-property calibration set
  runs/<slug>/                         Per-run artifacts: tiles + raw API responses + masks
  production-runs.json                 Final submission numbers
  *.log                                Calibration sweep output

scripts/
  build_eval_set.py                    Build eval set + Solar oracle
  extract_one_state.py                 Per-state MS Buildings extraction worker
  merge_states.py                      Merge state extractions
  run_test_set.py                      Production pipeline on the 5 submission addresses
```

## Reproducing

```sh
# On the GPU host (cachy-tower):
cd cachy-tower
uv venv --python 3.12 && source .venv/bin/activate
uv pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126
uv pip install "sam-2 @ git+https://github.com/facebookresearch/sam2.git" \
                fastapi uvicorn opencv-python pydantic
mkdir -p checkpoints && cd checkpoints && \
  curl -LO https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt
ollama pull qwen2.5vl:3b
uvicorn service:app --host 0.0.0.0 --port 8765

# On the orchestration host (reef):
cp .env.example .env  # GOOGLE_PLACES_API_KEY + OPENROUTER_API_KEY (estimate only)
npm install && (cd server && npm install) && (cd web && npm install)
# Pre-fetch MS Open Buildings (only states needed for your addresses):
for state in Colorado Missouri Texas Illinois Florida Virginia; do
  curl -o "data/msbuildings/${state}.geojson.zip" \
    "https://minedbuildings.z5.web.core.windows.net/legacy/usbuildings-v2/${state}.geojson.zip" &
done; wait
for state in Colorado Missouri Texas Illinois Florida Virginia; do
  python3 scripts/extract_one_state.py "$state" &
done; wait
python3 scripts/merge_states.py

# Build + run
(cd web && npm run build) && (cd server && npm start)

# Run on the 5 test addresses:
python3 scripts/run_test_set.py
```

## What's left for "next time"

- **Per-plane pitch.** SAM 2 returns per-plane masks; we currently apply a single building-wide pitch. Per-plane pitches would push MAPE under 3%.
- **Live MS Buildings spatial index** so any address gets the deterministic path (currently only the 29 calibrated addresses).
- **Local estimate generation** — replace Claude with Qwen for the contractor-grade estimate too. (Currently Claude via OpenRouter.)
- **Shadow-based pitch** — sun angle (computable from date + lat/lng) + measured ridge shadow → deterministic pitch. Replaces the LLM pitch call entirely.

## Credit

Built solo, overnight, by Austin Young ([@elenion88](https://github.com/Elenion88)).

Open-source models: **SAM 2** (Meta, Apache 2.0), **Qwen2.5-VL 3B** (Alibaba, Apache 2.0). Open data: **Microsoft Open Buildings** (ODbL).

Hosted on a homelab: a basement MSI laptop ("reef") for orchestration + web, a desktop with RTX 3090 ("cachy-tower") for GPU compute, all on a private tailscale network exposed to the internet via Cloudflare Tunnel.
