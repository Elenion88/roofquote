import { openrouterChat, pngToDataUrl } from '../../lib/openrouter.ts';
import { extractJson } from '../../lib/json.ts';
import { lookupPolygon } from '../../lib/msbuildings.ts';
import { renderPolygonOverlay } from '../../lib/overlay.ts';
import { pitchMultiplier, M2_TO_SQFT, metersPerPixel as mppFn } from '../../lib/geometry.ts';
import { metersPerPixel as smMpp } from '../../lib/staticmap.ts';
import type { MethodResult } from '../types.ts';

const VALIDATE_AND_PITCH_PROMPT = (p: { lat: number; lng: number }) => `
The image is a top-down satellite tile centered on lat=${p.lat}, lng=${p.lng}.
A green polygon has been overlaid on the image. The white pin marks the geocoded address center.

Your tasks:
1. VALIDATE: Does the green polygon outline the SINGLE primary residential dwelling at the center of the image? It should outline the main building only — not multiple buildings, not a detached garage, not a yard.
   - "yes" if the polygon is correct or close to correct (within ~10% of the actual roof outline)
   - "partial" if the polygon outlines the building but cuts off a wing/extension/porch
   - "wrong-building" if the polygon outlines the wrong structure (a neighbor, a shed, a school)
   - "missing-roof" if there's clearly a building visible at the pin that the polygon does not cover
2. PITCH: Estimate the dominant roof pitch as rise:12 (3:12, 4:12, 6:12, 8:12, 10:12, 12:12).

Return ONLY JSON:
{
  "validation": "yes" | "partial" | "wrong-building" | "missing-roof",
  "pitch": "<x:12>",
  "reasoning": "<one sentence explaining validation choice>"
}
`.trim();

export async function footprintMSBuildings(args: {
  pngBytes: Uint8Array;
  lat: number;
  lng: number;
  zoom: number;
  metersPerPixel: number;
  sizePx: number;
  model?: string;
}): Promise<MethodResult & { footprintSqft: number; validation?: string }> {
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

  // Render polygon overlay on the tile, then ask vision to validate + estimate pitch
  let validation = 'unknown';
  let pitchRise = 6;
  let pitchReason = 'default';
  try {
    const overlay = await renderPolygonOverlay({
      basePngBytes: args.pngBytes,
      centerLat: args.lat,
      centerLng: args.lng,
      metersPerPixel: args.metersPerPixel,
      imageWidthPx: args.sizePx,
      imageHeightPx: args.sizePx,
      polygonLonLat: hit.polygonLonLat,
    });
    const r = await openrouterChat({
      model,
      temperature: 0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a roofing-measurement expert. Return ONLY valid JSON.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: VALIDATE_AND_PITCH_PROMPT(args) },
            { type: 'image_url', image_url: { url: pngToDataUrl(new Uint8Array(overlay)), detail: 'high' } },
          ],
        },
      ],
    });
    const text = r.choices[0]?.message?.content ?? '';
    const json = extractJson<{ validation: string; pitch: string; reasoning: string }>(text);
    validation = json.validation ?? 'unknown';
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
      errorMessage: `validation/pitch failed: ${err?.message ?? err}`,
    };
  }

  // If polygon is wrong, return null so the pipeline falls back to vision_direct
  if (validation === 'wrong-building' || validation === 'missing-roof') {
    return {
      method: 'footprint_msbuildings',
      model,
      totalSqft: null,
      footprintSqft: hit.footprintSqft,
      pitchRatio: pitchRise / 12,
      reasoning: `MS Buildings polygon rejected by vision (${validation}). ${pitchReason}`,
      durationMs: Date.now() - start,
      errorMessage: `polygon validation: ${validation}`,
      raw: { hit, validation, pitchRise, pitchReason },
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
    reasoning: `MS Buildings polygon (${hit.footprintM2.toFixed(0)}m², ${hit.centroidDistM.toFixed(1)}m from address) ${validation === 'yes' ? '✓' : '~'} × pitch ${pitchRise}:12 (${mult.toFixed(3)}). ${pitchReason}`,
    durationMs: Date.now() - start,
    validation,
    raw: { hit, validation, pitchRise, pitchReason },
  };
}
