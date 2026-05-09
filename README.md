# RoofQuote — AI-driven roof estimates from a property address

Built for the JobNimbus AI Hackathon 2026 (track 01 — auto-estimating bounty).

## What it does

Address in → ensemble of independent measurement methods → consensus roof sqft + line items → polished customer-facing estimate (web + PDF).

## Methods (ensemble)

1. **Vision-direct** — Static Maps satellite tile + a vision LLM asks "what is the total roof sqft?"
2. **Vision-polygon** — Same tile + vision LLM returns roof outline as pixel polygon; we project to ground area + apply pitch.
3. **Multi-zoom triangulation** — Same address rendered at zooms 19/20/21; vision polygon at each, projected and averaged.
4. **Multi-model consensus** — Methods 1+2 run on Claude / Gemini / GPT-4o (via OpenRouter); trimmed mean.
5. *(Opportunistic)* **Overture footprint × LLM pitch** — when Overture has a clean polygon for the address, use it as a deterministic footprint.

Each method runs independently, and `ensemble.ts` combines them via weighted median. Weights are tuned offline against the 5 example properties (where ground-truth references are known) and Google Solar API as a third reference.

## Build / run

```sh
cp .env.example .env
# fill in GOOGLE_PLACES_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY
npm install
cd server && npm install
cd ../web && npm install
cd ..
npm run dev
```

Web dev server: http://localhost:5176
API: http://localhost:4006/api/health

## Repo layout

```
server/   Hono + better-sqlite3 — pipeline orchestration + API
web/      React + Vite + Tailwind — address input + estimate viewer
docs/     Methodology notes, calibration tables
scripts/  Eval harness (Solar API oracle, calibration)
```
