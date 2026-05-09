# Methodology

## Problem

Address in → roof material square footage out. The reference data published with this challenge gives us 5 example properties with two trusted commercial measurements each (Reference A and Reference B). They disagree by 1–4% per property. The 5 test properties have no published references.

## Pipeline

```
address
  ↓ geocode (Google)
lat/lng
  ↓ Static Maps API at zoom 19 AND zoom 20 (parallel)
two satellite tiles, each 1280×1280 px (scale=2)
  ↓ Vision LLM (Claude Opus 4.7 via OpenRouter), in parallel
two sqft estimates
  ↓ ensemble.ts → median()
consensus sqft
  ↓ Claude Opus 4.7 with structured output
estimate (line items, materials, labor, regional pricing)
```

Total wall-clock: 18–28 seconds per quote. Cost: ~$0.05 in inference.

## Why this exact configuration

We tried 7 single-method variants on a 29-property eval set:

| Variant | Model | Zoom | Prompt | n | MAPE | Bias |
|---|---|---|---|---|---|---|
| opus-z19-measured | Opus 4.7 | 19 | "measured" prompt | 29 | **28.0%** | -2.9% |
| opus-z20-measured | Opus 4.7 | 20 | "measured" prompt | 29 | 32.8% | -10.3% |
| opus-z18-measured | Opus 4.7 | 18 | "measured" prompt | 29 | 33.5% | -7.9% |
| opus-z21-measured | Opus 4.7 | 21 | "measured" prompt | 29 | 43.4% | -7.8% |
| opus-z20-careful | Opus 4.7 | 20 | "careful" prompt | 29 | 30.9% | -9.2% |
| opus-z20-default | Opus 4.7 | 20 | "default" prompt | 29 | 33.8% | -17.7% |
| gpt4o-z19-measured | GPT-4o | 19 | "measured" prompt | 29 | 33.1% | +0.5% |

We then tried 8 ensemble combiners:

| Combiner | n | MAPE | Bias |
|---|---|---|---|
| **median(z19, z20)** | **29** | **25.5%** | **-6.6%** |
| mean(z19, z20) | 29 | 25.5% | -6.6% |
| drop-low(z18..z21 + gpt4o) | 29 | 27.1% | +0.9% |
| median(z18, z19, z20, z21) | 29 | 27.3% | -7.8% |
| mean(z18, z19, z20) | 29 | 27.5% | -7.0% |
| median(opus-z19, opus-z20, gpt4o-z19) | 29 | 28.5% | -1.0% |
| z19 only | 29 | 28.0% | -2.9% |
| median(opus-z19, gpt4o-z19) | 29 | 30.4% | -1.2% |

`median(z19, z20)` wins on MAPE and is also the cheapest at 2 LLM calls. Adding more zooms or other models does not help — the dominant error source is the vision model's per-property variance, not zoom-specific bias.

## Why we did NOT use Solar API in the pipeline

Google Solar API returns roof area within 2% of the published references on 4 of 5 example properties (worst case 8%). It would be the most accurate single source by far.

But the bounty rules state: *"Submitted numbers that match commercial measurement reports without evidence of independent computation in your repo will be flagged and disqualified."*

Solar API is, functionally, a commercial roof measurement product. Including its number directly in our submission would be "buying."

Instead we use Solar API exactly as we use Reference A and Reference B: as **calibration oracle**. It's how we know our methods' MAPE on the test properties (where no published reference exists). It's run by [`scripts/build_eval_set.py`](../scripts/build_eval_set.py) once, offline, and the result is checked into [`eval/addresses.json`](../eval/addresses.json). No request to Solar API is made by `runQuote()`.

## Why we expanded the eval set to 29 properties

The 5 example properties give us 10 measurements (Reference A and B for each). With only 10, MAPE estimates have wide confidence intervals — hard to tell if a 30% variant is meaningfully different from a 28% variant.

We auto-generated 19 additional addresses by reverse-geocoding points 70–120m from each known address (real residential neighbors, in similar climates and build styles). For each, Solar API gives an oracle measurement. Range: 1,008 to 8,320 sqft. This is enough to score variants against each other and pick the best one with confidence.

Code: [`scripts/build_eval_set.py`](../scripts/build_eval_set.py). Saved set: [`eval/addresses.json`](../eval/addresses.json).

## What we excluded and why

**Method 2 (vision_polygon)** was implemented but excluded from the consensus. The model returns a roof outline as pixel coords, we compute polygon area with our own shoelace + Web Mercator math, and multiply by a pitch factor. On the eval set it overestimates by 60–88% — the model includes adjacent driveways, pool decks, and sometimes neighboring buildings. The code is retained ([`server/src/pipeline/methods/vision_polygon.ts`](../server/src/pipeline/methods/vision_polygon.ts)) and exposed as an opt-in via `withPolygon: true` for future tuning.

**Multi-model consensus** was implemented and tested. GPT-4o regresses to a small set of values (2,800 / 3,200 sqft) and adding it to the consensus increased MAPE. Sonnet/Gemini hit JSON parsing or rate-limit issues during eval. Decision: keep the demo capability (`withDemoModels: true`) for showing model disagreement on stage, but don't use it in the consensus.

**Building footprint datasets (Microsoft Buildings, Overture Maps).** Microsoft Buildings is per-state download (gigabytes); Overture via DuckDB-on-S3 took 2 minutes per address with frequent NaN areas. Neither is a viable source for a production address-in pipeline.

## Determinism

- `temperature: 0` on every LLM call.
- Pinned model strings (no aliases like `claude-latest`).
- Pinned dependency versions in `package.json`.
- All API requests, responses, satellite tiles, and method outputs persisted under `eval/runs/<address-slug>/`. Every reported number is reproducible from the saved artifacts.

## Honest limitations

- **MAPE 25.5%** means about 1 in 4 estimates is more than 25% off. This is too high for a real contracting workflow without human review. The biggest errors come from very small homes (<1,500 sqft, where vision model has a ~1,800 sqft floor) and very large homes (>6,000 sqft, where it has a ~4,000 sqft ceiling). A two-pass approach (pre-classify size, then measure at appropriate zoom) would likely fix this.
- **Pitch is the noisiest variable.** Vision model often guesses 6:12 by default. Real pitch detection from a top-down image is genuinely hard without shadow analysis.
- **No handling of multi-unit buildings.** Duplexes get measured as a single unit.
