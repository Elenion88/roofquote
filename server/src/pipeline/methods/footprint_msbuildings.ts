import { openrouterChat, pngToDataUrl } from '../../lib/openrouter.ts';
import { extractJson } from '../../lib/json.ts';
import { lookupPolygon } from '../../lib/msbuildings.ts';
import { pitchMultiplier } from '../../lib/geometry.ts';
import { streetviewPitch } from './streetview_pitch.ts';
import type { MethodResult } from '../types.ts';

const PITCH_PROMPT = (p: { lat: number; lng: number; zoom: number }) => `
Top-down satellite tile of a residential property at lat=${p.lat}, lng=${p.lng}. Zoom ${p.zoom}.

Estimate the dominant roof pitch of the central dwelling as rise:12.

Common values:
- 3:12 = nearly flat (modern, southwestern)
- 4:12 = walkable low slope
- 6:12 = standard residential (most common nationally)
- 8:12 = steep (snowy regions, newer construction)
- 10:12 = very steep
- 12:12 = extremely steep

Use shadows, ridge sharpness, and the appearance of slopes to infer the actual pitch.

Return ONLY JSON:
{
  "pitch": "<rise:12 e.g. '6:12'>",
  "confidence": "low" | "medium" | "high",
  "reasoning": "<one sentence>"
}
`.trim();

async function aerialPitch(args: {
  pngBytes: Uint8Array;
  lat: number;
  lng: number;
  zoom: number;
  model: string;
}): Promise<{ rise: number; confidence: 'low' | 'medium' | 'high' | 'unknown'; reasoning: string; source: string }> {
  try {
    const r = await openrouterChat({
      model: args.model,
      temperature: 0,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a roofing measurement expert. Return ONLY valid JSON.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: PITCH_PROMPT(args) },
            { type: 'image_url', image_url: { url: pngToDataUrl(args.pngBytes), detail: 'high' } },
          ],
        },
      ],
    });
    const text = r.choices[0]?.message?.content ?? '';
    const json = extractJson<{ pitch: string; confidence: string; reasoning: string }>(text);
    const pm = String(json.pitch ?? '6:12').match(/^(\d+):12$/);
    const rise = pm ? parseInt(pm[1], 10) : 6;
    const c = ['low', 'medium', 'high'].includes(json.confidence) ? (json.confidence as any) : 'medium';
    return { rise, confidence: c, reasoning: json.reasoning ?? '', source: `aerial-z${args.zoom}` };
  } catch (err: any) {
    return { rise: 6, confidence: 'unknown', reasoning: String(err?.message ?? err), source: `aerial-z${args.zoom}` };
  }
}

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1, unknown: 0 } as const;

/**
 * Footprint-based measurement.
 *  - Footprint polygon comes from Microsoft Open Buildings (deterministic).
 *  - Pitch is consensus across THREE independent vision signals:
 *      1. Aerial view at zoom 19
 *      2. Aerial view at zoom 20
 *      3. Street-level side view (from Google Street View, when available)
 *    The street-level side view is the most reliable (gable angle directly
 *    visible) and gets priority weight when available with high/medium confidence.
 *  - Roof area = footprint × pitch_multiplier.
 */
export async function footprintMSBuildings(args: {
  z19PngBytes: Uint8Array;
  z20PngBytes: Uint8Array;
  lat: number;
  lng: number;
  model?: string;
}): Promise<MethodResult & { footprintSqft: number; pitchSources?: any[] }> {
  const start = Date.now();
  const model = args.model ?? 'anthropic/claude-opus-4-7';

  const hit = lookupPolygon(args.lat, args.lng);
  if (!hit) {
    return {
      method: 'footprint_msbuildings',
      model,
      totalSqft: null,
      footprintSqft: 0,
      durationMs: Date.now() - start,
      errorMessage: 'no MS Buildings polygon for this address',
    };
  }

  // 3 pitch signals in parallel
  const [aerial19, aerial20, streetview] = await Promise.all([
    aerialPitch({ pngBytes: args.z19PngBytes, lat: args.lat, lng: args.lng, zoom: 19, model }),
    aerialPitch({ pngBytes: args.z20PngBytes, lat: args.lat, lng: args.lng, zoom: 20, model }),
    streetviewPitch({ lat: args.lat, lng: args.lng, model }),
  ]);

  // Combine pitch signals.
  // Strategy: street-level (when high or medium confidence) wins.
  // Otherwise: median of the three by rise.
  let pitchRise = 6;
  let chosenSource = 'aerial-fallback';
  const allSources = [
    aerial19,
    aerial20,
    {
      rise: streetview.pitchRise,
      confidence: streetview.confidence,
      reasoning: streetview.reasoning,
      source: streetview.errorMessage ? `streetview (unavailable: ${streetview.errorMessage})` : 'streetview',
    },
  ];

  if (streetview.errorMessage == null && (streetview.confidence === 'high' || streetview.confidence === 'medium')) {
    pitchRise = streetview.pitchRise;
    chosenSource = `streetview (${streetview.confidence})`;
  } else {
    // Median of valid (non-unknown) sources
    const valid = allSources.filter((s) => s.confidence !== 'unknown');
    if (valid.length === 0) {
      pitchRise = 6;
      chosenSource = 'default 6:12';
    } else {
      const sorted = [...valid].sort((a, b) => a.rise - b.rise);
      pitchRise = sorted[Math.floor(sorted.length / 2)].rise;
      chosenSource = `median across ${valid.length} aerial signals`;
    }
  }

  const mult = pitchMultiplier(pitchRise);
  const totalSqft = Math.round(hit.footprintSqft * mult);

  const reasoning = `MS Buildings polygon (${hit.footprintM2.toFixed(0)} m², ${hit.centroidDistM.toFixed(1)} m from address) × pitch ${pitchRise}:12 mult ${mult.toFixed(3)}. Sources: aerial-z19=${aerial19.rise}:12 (${aerial19.confidence}), aerial-z20=${aerial20.rise}:12 (${aerial20.confidence}), streetview=${streetview.errorMessage ? 'n/a' : `${streetview.pitchRise}:12 (${streetview.confidence})`}. Chose: ${chosenSource}.`;

  return {
    method: 'footprint_msbuildings',
    model,
    totalSqft,
    footprintSqft: Math.round(hit.footprintSqft),
    pitchRatio: pitchRise / 12,
    reasoning,
    durationMs: Date.now() - start,
    pitchSources: allSources,
    raw: { hit, pitchRise, chosenSource, allSources, streetview },
  };
}
