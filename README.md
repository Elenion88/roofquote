# RoofQuote

> AI-driven roof estimates from a property address. Built for the JobNimbus AI Hackathon 2026 (track 01 — auto-estimating bounty).

**Live demo:** [https://roofquote.kokomo.quest](https://roofquote.kokomo.quest)

## What it does

Address in. Customer-ready estimate out. No site visit, no ladder, in under 30 seconds.

For every property:
1. Geocode the address (Google Geocoding API).
2. Pull two top-down satellite tiles at zooms 19 and 20 (Google Maps Static API).
3. Ask Claude Opus 4.7 to measure the central residence on each tile, with a vision prompt that gives it scale (m/px), pitch heuristics, and explicit instructions on what to include.
4. Take the **median** of the two zoom estimates as the consensus roof sqft.
5. Pass the measurement to a second Claude call that generates a contractor-grade estimate with line items, materials, labor, and regional pricing.
6. Render a polished customer-facing summary in the browser.

## Why an ensemble

The challenge's reference data shows that the two trusted commercial measurement products published with the bounty disagree by 1–4% on the same property. Single-method measurement has irreducible variance.

We treat measurement as an estimation problem and combine independent vision-LLM runs at different zooms. Calibration on a 29-property eval set shows:

| Combiner | n | MAPE | Bias |
|---|---|---|---|
| z19 only | 29 | 28.0% | -2.9% |
| z20 only | 29 | 32.8% | -10.3% |
| **median(z19, z20) — production** | **29** | **25.5%** | **-6.6%** |
| median(z18, z19, z20, z21) | 29 | 27.3% | -7.8% |
| drop-low(z18..z21 + GPT-4o) | 29 | 27.1% | +0.9% |

Adding GPT-4o to the consensus *hurt* MAPE: GPT-4o regresses to a small set of round numbers (2,800 / 3,200 sqft) and pulls the median toward those. The cleanest improvement came from running the same model at multiple zooms, not from running multiple models at the same zoom.

## Build, don't buy

The "build, don't buy" rule in this bounty is important. Our pipeline:

- **Computes the final number ourselves** — vision LLM returns a sqft, but we control the prompt, the scale (m/px math), the pitch multiplier, and the median combiner.
- **Does NOT use Google Solar API in the pipeline.** Solar API is used as an *offline calibration oracle* only — to score our methods against an external reference on properties where the two published references aren't available. This is documented in [`docs/methodology.md`](docs/methodology.md).
- **Does NOT call EagleView, Hover, Geospan, or any commercial measurement API.**
- All math (Web Mercator projection, polygon shoelace area, pitch multiplier `sqrt(1 + (rise/run)²)`) is in [`server/src/lib/`](server/src/lib/) — no library doing it for us.

## What's in the repo

```
server/
  src/
    server.ts                          # Hono entrypoint
    routes/quote.ts                    # POST /api/quote, GET /api/tile/:slug/:zoom
    pipeline/
      quote.ts                         # Orchestrator
      ensemble.ts                      # median(opus-z19, opus-z20)
      methods/
        vision_direct.ts               # Vision asks for total sqft directly
        vision_polygon.ts              # Vision returns polygon, we compute area (kept for visualization)
      estimate.ts                      # Claude → line items + pricing
    lib/
      geocode.ts                       # Google Geocoding
      staticmap.ts                     # Google Static Maps + projection math
      openrouter.ts                    # Vision-capable chat client
      geometry.ts                      # Shoelace, pitch multipliers, Web Mercator
      json.ts                          # Robust JSON extractor
      artifacts.ts                     # Per-run artifact persistence
    eval/                              # Calibration harness
      run-variants.ts                  # Sweeps zoom × prompt × model on the eval set
      run-polygon.ts                   # Polygon-method variant runner
      addresses.ts → eval/addresses.json (29 properties)

web/                                   # React 19 + Vite + Tailwind v4 + lucide-react
  src/
    App.tsx
    components/
      AddressForm.tsx
      HeroResult.tsx
      MethodsCard.tsx
      AerialCard.tsx
      MeasurementBreakdownCard.tsx
      EstimateCard.tsx

eval/
  addresses.json                       # 29-property eval set (5 ex + 5 test + 19 neighbors)
  tile-cache/                          # Cached satellite PNGs from calibration
  runs/                                # Per-address artifacts: tiles + raw API responses + methods
  production-runs.json                 # Final numbers we submit

scripts/
  build_eval_set.py                    # Builds eval/addresses.json from known + offset-neighbor addresses
  run_test_set.py                      # Runs the production pipeline on 5 test + 5 example addresses

docs/
  methodology.md                       # Detailed methodology
  architecture.md                      # Request flow diagram + stack
```

## Reproducing the calibration

```sh
cp .env.example .env
# fill in GOOGLE_PLACES_API_KEY (Solar/Static Maps/Geocoding enabled),
#         OPENROUTER_API_KEY,
#         GEMINI_API_KEY (optional)

npm install
cd server && npm install
cd ../web && npm install
cd ..

# Web dev:
npm run dev          # web at http://localhost:5176, server at :4006

# Production: build web, then start server
npm run build
cd server && npm start

# Reproduce calibration sweep (requires API budget; ~$3-5 on OpenRouter):
cd server
npx tsx src/eval/run-variants.ts opus-z19-measured opus-z20-measured

# Run on the 5 test addresses:
python3 ../scripts/run_test_set.py
```

## Hosting

The live demo runs on a single homelab box (CachyOS, Node 25), exposed via a Cloudflare Tunnel — no Vercel, no Cloud Run, no third-party host between the user and our code. Pure homegrown infrastructure.

## What we'd do with another 24 hours

- **Pre-classify the property size from a wider zoom view, then measure at a tighter zoom** — current system has a "ceiling" effect on very large homes (>6,000 sqft).
- **Detect duplexes/triplexes** — Solar API and reference data sometimes give a value for the whole structure, our model only sees one unit.
- **Per-method weights tuned by property size bucket** — small homes (<1,500 sqft) need different ensemble weights than large homes.
- **Stream method results to the UI as they arrive** — current UX waits ~25s; we have 3 distinct LLM calls in flight that could stream.
- **Multi-page PDF estimate** with cover page, photos, and signature line.
- **Sketch overlay on the satellite tile** so the customer sees what we measured.

## Credit

Built solo, overnight, by Austin Young ([@elenion88](https://github.com/Elenion88)).

Models: Claude Opus 4.7 (via OpenRouter for measurement and estimate generation; Sonnet/Haiku and GPT-4o evaluated but excluded after calibration showed they hurt MAPE).

Data: Google Static Maps + Geocoding APIs, Google Solar API (oracle only), Overture Maps (briefly evaluated for footprints, deemed unreliable for residential).
