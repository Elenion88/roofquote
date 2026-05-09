# Methodology

## Why an ensemble?

The reference data published with this challenge shows that two trusted commercial measurement products disagree by 1–4% on the same property. Any single measurement method has irreducible variance. We treat measurement as an estimation problem and combine multiple independent estimators.

## Methods

### 1. Vision-direct
- Input: 640×640 satellite tile from Google Static Maps API at zoom 20, centered on geocoded address.
- Vision LLM (Claude Opus 4.7 via OpenRouter) is given the tile and asked: "What is the total roof area in square feet?" with structured-output JSON schema.
- Temperature 0. Same prompt every run.

### 2. Vision-polygon
- Same input tile.
- Vision LLM returns roof outline as a list of {x, y} pixel coordinates.
- We project pixels → ground meters using the known scale at zoom 20 and the latitude (`m/px = 156543.03 × cos(lat) / 2^zoom`).
- Polygon shoelace area → footprint m² → multiply by pitch multiplier (vision-derived) → roof sqft.

### 3. Multi-zoom triangulation
- Three tiles per address: zooms 19, 20, 21.
- Method 2 run at each zoom.
- Final value = median of the three.
- Damps single-zoom errors (object obscured at one zoom may be visible at another).

### 4. Multi-model consensus
- Methods 1 and 2 run on three vision providers via OpenRouter (Claude Opus 4.7, Gemini 2.5 Pro, GPT-4o).
- Six measurements per property; we take the trimmed mean (drop high+low, average middle).

### 5. Opportunistic Overture footprint
- Overture Maps via DuckDB+S3 (run offline once, cached locally).
- For any address with a polygon within 5 m and a non-NaN area, use that as a deterministic footprint.
- Pitch multiplier from vision.

## Ensemble combiner

Weighted median of available method outputs. Weights tuned by minimizing MAPE on the 5 example properties against the average of Reference A and Reference B.

## Solar API as oracle (offline, NOT in submission pipeline)

Google Solar API returns roof area within 2% of the published reference data on 4/5 example properties (worst case 8%). We use it offline only — to calibrate methods and sanity-check our test-property numbers — never as a submitted measurement.

## Determinism

- Temperature 0 on every LLM call.
- Pinned model versions (no aliases).
- Saved per-run artifacts under `eval/runs/<address>/` (raw API responses, satellite tiles).
- Pinned dependency versions in package.json.
