import { openrouterChat, pngToDataUrl } from '../../lib/openrouter.ts';
import { extractJson } from '../../lib/json.ts';
import { lookupPolygon } from '../../lib/msbuildings.ts';
import { pitchMultiplier } from '../../lib/geometry.ts';
import type { MethodResult } from '../types.ts';

const PITCH_PROMPT = (p: { lat: number; lng: number; state?: string; zoom: number }) => `
Top-down satellite tile of a residential property at lat=${p.lat}, lng=${p.lng}. Zoom ${p.zoom}.

Estimate the dominant roof pitch of the central dwelling as rise:12.

Common pitches by region:
- Southern/southwestern US (TX, FL, AZ, CA, GA): often 4:12 to 6:12 (low to standard)
- Midwestern US (IL, MO, IN, OH): typically 6:12 (standard)
- Western mountain (CO, UT, NM, WY): typically 6:12 to 8:12 (steeper for snow)
- Northeastern US (NY, MA, NH, VT, ME): 8:12 to 12:12 (steep for snow)

Use shadows, ridge sharpness, and the appearance of slopes to infer the actual pitch.
- Sharp ridges with strong shadow lines = steep (8:12+)
- Soft, almost-flat appearance = low (3:12-4:12)
- Moderate shadow with visible slope = standard (6:12)

Return ONLY JSON:
{
  "pitch": "<rise:12 e.g. '6:12'>",
  "confidence": "low" | "medium" | "high",
  "reasoning": "<one sentence>"
}
`.trim();

async function detectPitch(args: {
  pngBytes: Uint8Array;
  lat: number;
  lng: number;
  zoom: number;
  model: string;
}): Promise<{ rise: number; confidence: string; reasoning: string }> {
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
  return { rise, confidence: json.confidence ?? 'medium', reasoning: json.reasoning ?? '' };
}

/**
 * Footprint-based measurement.
 *  - Footprint polygon comes from Microsoft Open Buildings (deterministic).
 *  - Pitch is the median of vision-LLM detections across two zooms (z19 + z20).
 *  - Roof area = footprint × pitch_multiplier.
 */
export async function footprintMSBuildings(args: {
  z19PngBytes: Uint8Array;
  z20PngBytes: Uint8Array;
  lat: number;
  lng: number;
  model?: string;
}): Promise<MethodResult & { footprintSqft: number }> {
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

  // Multi-zoom pitch detection (parallel)
  let pitchRise = 6;
  let pitchReason = 'default 6:12';
  try {
    const [p19, p20] = await Promise.all([
      detectPitch({ pngBytes: args.z19PngBytes, lat: args.lat, lng: args.lng, zoom: 19, model }),
      detectPitch({ pngBytes: args.z20PngBytes, lat: args.lat, lng: args.lng, zoom: 20, model }),
    ]);
    // Median (round half up): if z19 and z20 disagree, take the higher-confidence one
    if (p19.rise === p20.rise) {
      pitchRise = p19.rise;
    } else {
      // If different, prefer the higher-confidence reading; if equal, take median
      const order = { high: 3, medium: 2, low: 1 } as const;
      if ((order[p19.confidence as keyof typeof order] ?? 2) > (order[p20.confidence as keyof typeof order] ?? 2)) {
        pitchRise = p19.rise;
      } else if ((order[p19.confidence as keyof typeof order] ?? 2) < (order[p20.confidence as keyof typeof order] ?? 2)) {
        pitchRise = p20.rise;
      } else {
        // average and round
        pitchRise = Math.round((p19.rise + p20.rise) / 2);
      }
    }
    pitchReason = `z19→${p19.rise}:12 (${p19.confidence}); z20→${p20.rise}:12 (${p20.confidence}); chose ${pitchRise}:12. ${p20.reasoning}`;
  } catch (err: any) {
    pitchReason = `pitch detection error: ${err?.message ?? err}`;
  }

  const mult = pitchMultiplier(pitchRise);
  const totalSqft = Math.round(hit.footprintSqft * mult);

  return {
    method: 'footprint_msbuildings',
    model,
    totalSqft,
    footprintSqft: Math.round(hit.footprintSqft),
    pitchRatio: pitchRise / 12,
    reasoning: `Microsoft Open Buildings polygon (${hit.footprintM2.toFixed(0)} m² footprint, ${hit.centroidDistM.toFixed(1)} m from address) × pitch ${pitchRise}:12 multiplier ${mult.toFixed(3)}. ${pitchReason}`,
    durationMs: Date.now() - start,
    raw: { hit, pitchRise, pitchReason },
  };
}
