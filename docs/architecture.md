# Architecture

## Request flow

```
POST /api/quote { address }
  ↓
Geocode (Google Geocoding) → lat/lng
  ↓
Static Maps tiles (z=19, z=20, z=21) → cached on disk
  ↓
Run methods in parallel:
  - Vision-direct (Claude)
  - Vision-polygon (Claude)
  - Multi-zoom (Claude × 3 zooms)
  - Multi-model (Claude + Gemini + GPT-4o)
  - Overture footprint (if available)
  ↓
ensemble.ts → consensus sqft
  ↓
estimate.ts (Claude with structured output) → line items + materials + labor + pricing
  ↓
PDF (server-side render) + /q/<id> web view
```

## Stack

- Server: Hono + better-sqlite3 + Node 25
- Web: React 19 + Vite 6 + Tailwind v4
- Vision: OpenRouter (Claude Opus 4.7, Gemini 2.5 Pro, GPT-4o)
- Data: Google Static Maps + Google Geocoding + Overture (offline)
- Hosting: reef.tailnet via cloudflared tunnel → roofquote.kokomo.quest
