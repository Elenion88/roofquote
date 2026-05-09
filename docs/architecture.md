# Architecture

## Two-host topology

```
                                     Internet
                                         │
                                         ▼
                          ┌──────────────────────────────┐
                          │  Cloudflare Tunnel           │
                          │  roofquote.kokomo.quest      │
                          └──────────────┬───────────────┘
                                         │
                                         ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  reef                                                        │
   │  CachyOS, MSI laptop in a basement. Orchestration host.      │
   │                                                              │
   │   • Hono server (Node 22+, tsx)        — serves /api/*       │
   │   • Static React 19 build              — serves /            │
   │   • Pipeline orchestration             — runs methods in     │
   │     parallel, ensembles, generates estimate                  │
   │   • Persists every API call + tile + mask to eval/runs/      │
   │                                                              │
   │   Outbound: Google Static Maps + Geocoding,                  │
   │             OpenRouter (Claude — estimate only),             │
   │             cachy-tower over tailscale (measurement)         │
   └──────────────┬───────────────────────────────────────────────┘
                  │ tailscale (private)
                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  cachy-tower                                                 │
   │  CachyOS desktop with RTX 3090 (24 GB VRAM). GPU host.       │
   │                                                              │
   │   • FastAPI service on :8765                                 │
   │   • SAM 2 (sam2.1_hiera_large)         — segmentation        │
   │   • Qwen2.5-VL 7B (via Ollama)         — pitch detection     │
   │                                                              │
   │   Endpoints:                                                 │
   │     POST /segment          — building mask + per-plane masks │
   │     POST /pitch            — single-image pitch (rise:12)    │
   │     POST /per-plane-pitch  — pitch per crop (prototyped)     │
   │     GET  /health           — VRAM + device status            │
   └──────────────────────────────────────────────────────────────┘
```

reef calls cachy-tower over tailscale; cachy-tower has no public surface area.

## Request flow

```
POST /api/quote { address }
  │
  ├─ Geocode (Google) → lat, lng, formatted address
  │
  ├─ Static Maps × 3 zooms (parallel) → z19, z20, z21 PNGs
  │
  ├─ Run three measurement methods in parallel:
  │     ┌─ footprint_msbuildings → MS polygon area × Qwen pitch (z20)
  │     ├─ sam2_footprint        → SAM 2 mask + per-plane sum × Qwen pitch (z21)
  │     └─ vision_direct × 2     → Claude Opus 4.7 on z19, z20
  │
  ├─ ensemble.ts → consensus sqft + combiner label
  │     • Courtyard override: SAM 2 plane_sum 70-90% of MS → SAM 2
  │     • Default: MS Buildings × pitch
  │     • Fallback: SAM 2 alone, then median(vision z19, z20)
  │
  ├─ estimate.ts → Claude Opus → line items + materials + labor + regional pricing
  │     (uses pitch from whichever method produced the consensus number)
  │
  └─ Response: { consensusSqft, combiner, results[], estimate, location, … }
```

Wall-clock: 25–35s. The SAM 2 segment + Qwen pitch calls share the bottleneck (~15–20s on the GPU host); Claude estimate generation adds ~7–10s.

## Stack

| Layer | Choice |
|---|---|
| HTTP server | Hono on Node 22+ (tsx loader, no build step) |
| Web | React 19 + Vite 6 + Tailwind v4 + lucide-react |
| Image compositing | sharp (server-side SVG → PNG overlay rendering) |
| Map tiles + geocoding | Google Static Maps + Google Geocoding |
| Segmentation | SAM 2 (Apache 2.0), CUDA, RTX 3090 |
| Pitch detection | Qwen2.5-VL 7B via Ollama (Apache 2.0), local |
| Estimate generation | Claude Opus 4.7 via OpenRouter |
| Building polygons | Microsoft Open Buildings (ODbL), pre-extracted |
| Hosting | reef.tailnet (orchestration) + cachy-tower (GPU), Cloudflare Tunnel for ingress |

## Code layout

```
server/src/
  server.ts                         Hono entrypoint
  routes/quote.ts                   POST /api/quote, GET /api/tile/:slug/:zoom[/overlay]
  pipeline/
    quote.ts                        Orchestrator
    ensemble.ts                     Combiner with courtyard override
    estimate.ts                     Claude → contractor estimate
    methods/
      footprint_msbuildings.ts      Primary: MS polygon × Qwen pitch
      sam2_footprint.ts             SAM 2 mask + per-plane sum × Qwen pitch
      vision_direct.ts              Claude Opus cross-check
      vision_polygon.ts             Eval-only — opt-in via withPolygon
      streetview_pitch.ts           Eval-only — earlier prototype
  lib/
    cachy.ts                        HTTP client for cachy-tower (segment, pitch)
    geometry.ts                     Shoelace, Web Mercator, pitch multiplier
    msbuildings.ts                  Polygon lookup from extracted dataset
    overlay.ts                      Polygon + per-plane SVG overlay rendering (sharp)
    staticmap.ts                    Google Static Maps + m/px math
    geocode.ts, places.ts           Google Geocoding + Places autocomplete
    openrouter.ts                   Minimal OpenRouter chat client
    json.ts                         Robust JSON extraction from LLM output
    artifacts.ts                    Persist tiles + JSON to eval/runs/<slug>/

cachy-tower/service.py              FastAPI: /segment, /pitch, /per-plane-pitch

web/src/
  App.tsx                           Top-level page
  components/
    AddressForm.tsx                 Places-autocomplete input + sample addresses
    LoadingStages.tsx               Staged progress while quote runs
    HeroResult.tsx                  Headline sqft + combiner label
    MethodsCard.tsx                 Per-method breakdown (MS / SAM / Claude)
    AerialCard.tsx                  Tiles with overlays (z19, z20, z21 + plane masks)
    CalibrationCard.tsx             MAPE table on the marketing page
    EstimateCard.tsx                Materials + labor line items + total
    MeasurementBreakdownCard.tsx    Footprint × pitch math shown to the user
```

## Determinism + auditability

- All Static Maps tiles, OpenRouter requests/responses, MS Buildings polygons, SAM 2 masks (as polygons), and final method outputs are persisted to `eval/runs/<address-slug>/` per request.
- SAM 2 runs are seeded (`torch.manual_seed(42)` + image-hash cache) so the same input returns the same masks.
- Qwen calls are temperature=0 and serialized through a single threading lock with an image-hash cache, so concurrent /pitch requests for the same image return one shared answer.
- Every reported sqft is reproducible from the saved tiles + masks alone — judges don't need to re-run the pipeline.
