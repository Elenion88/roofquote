import { openrouterChat, pngToDataUrl } from '../../lib/openrouter.ts';
import { extractJson } from '../../lib/json.ts';
import { lookupPolygon } from '../../lib/msbuildings.ts';
import { pitchMultiplier } from '../../lib/geometry.ts';
import type { MethodResult } from '../types.ts';

const PITCH_PROMPT = (p: { lat: number; lng: number }) => `
You are looking at a top-down satellite tile of a residential property at lat=${p.lat}, lng=${p.lng}.

Your only task: estimate the dominant roof pitch of the central dwelling as rise:12.

Common values:
- 3:12 = nearly flat (modern, southwestern)
- 4:12 = walkable low slope
- 6:12 = standard residential (most common nationally)
- 8:12 = steep (snowy regions, newer construction)
- 10:12 = very steep (Victorian, mountain)
- 12:12 = extremely steep (rare residential)

Use shadows, ridge sharpness, and the appearance of slopes to infer.

Return ONLY JSON:
{
  "pitch": "<rise:12 e.g. '6:12'>",
  "reasoning": "<one sentence>"
}
`.trim();

/**
 * Footprint-based measurement.
 *  - Footprint polygon comes from Microsoft Open Buildings (deterministic).
 *  - Pitch comes from a vision LLM (the only noisy variable).
 *  - Roof area = footprint × pitch_multiplier.
 */
export async function footprintMSBuildings(args: {
  pngBytes: Uint8Array;
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

  // Pitch detection from satellite tile
  let pitchRise = 6;
  let pitchReason = 'default 6:12';
  try {
    const r = await openrouterChat({
      model,
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
    const json = extractJson<{ pitch: string; reasoning: string }>(text);
    const pm = String(json.pitch ?? '6:12').match(/^(\d+):12$/);
    if (pm) pitchRise = parseInt(pm[1], 10);
    pitchReason = json.reasoning ?? '';
  } catch (err: any) {
    // Fall through with default pitch
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
    reasoning: `Microsoft Open Buildings polygon (${hit.footprintM2.toFixed(0)} m² footprint, ${hit.centroidDistM.toFixed(1)} m from address) × pitch multiplier ${mult.toFixed(3)} (${pitchRise}:12). ${pitchReason}`,
    durationMs: Date.now() - start,
    raw: { hit, pitchRise, pitchReason },
  };
}
