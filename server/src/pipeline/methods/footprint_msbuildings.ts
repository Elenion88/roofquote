import { openrouterChat, pngToDataUrl } from '../../lib/openrouter.ts';
import { extractJson } from '../../lib/json.ts';
import { lookupPolygon } from '../../lib/msbuildings.ts';
import { pitchMultiplier, M2_TO_SQFT } from '../../lib/geometry.ts';
import type { MethodResult } from '../types.ts';

const PITCH_PROMPT = (p: { lat: number; lng: number }) => `
Image is a top-down satellite tile centered on lat=${p.lat}, lng=${p.lng}.
Your ONLY task: estimate the dominant roof pitch of the central residential dwelling.

Roof pitch is expressed as rise:12. Common residential pitches:
- 3:12 = very low slope (modern, ranch)
- 4:12 = walkable low slope (mid-century, southern US)
- 6:12 = standard residential (most common)
- 8:12 = steep (newer construction, snowy regions)
- 10:12 or steeper = very steep (Victorian, mountain regions)

Look at:
- Visible ridge lines and gables
- Shadow patterns on roof planes
- How sharp/distinct the roof edges are (steeper roofs cast more shadow)

Return ONLY JSON:
{
  "pitch": "<x:12 e.g. '6:12'>",
  "confidence": "low" | "medium" | "high",
  "reasoning": "<one sentence>"
}
`.trim();

/**
 * Footprint-based measurement.
 * Footprint comes from Microsoft Buildings (deterministic).
 * Pitch comes from a vision LLM (the only noisy variable).
 * Roof area = footprint × pitch_multiplier.
 */
export async function footprintMSBuildings(args: {
  pngBytes: Uint8Array;
  lat: number;
  lng: number;
  model?: string;
}): Promise<MethodResult & { footprintSqft: number; pitchSource?: string }> {
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

  // Pitch from vision
  let pitchRise = 6; // default 6:12
  let pitchReason = 'default fallback';
  try {
    const r = await openrouterChat({
      model,
      temperature: 0,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a roofing-measurement expert. Return ONLY valid JSON.' },
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
    if (pm) pitchRise = parseInt(pm[1], 10);
    pitchReason = json.reasoning ?? '';
  } catch (err: any) {
    return {
      method: 'footprint_msbuildings',
      model,
      totalSqft: null,
      footprintSqft: hit.footprintSqft,
      durationMs: Date.now() - start,
      errorMessage: `pitch detection failed: ${err?.message ?? err}`,
    };
  }

  const mult = pitchMultiplier(pitchRise);
  const totalSqft = Math.round(hit.footprintSqft * mult);

  return {
    method: 'footprint_msbuildings',
    model,
    totalSqft,
    footprintSqft: Math.round(hit.footprintSqft),
    pitchRatio: pitchRise / 12,
    reasoning: `MS Buildings polygon (${hit.footprintM2.toFixed(0)}m², centroid ${hit.centroidDistM.toFixed(1)}m from address) × pitch ${pitchRise}:12 (${mult.toFixed(3)}). ${pitchReason}`,
    durationMs: Date.now() - start,
    pitchSource: 'vision',
    raw: { hit, pitchRise, pitchReason },
  };
}
