import { openrouterChat, pngToDataUrl } from '../../lib/openrouter.ts';
import { extractJson } from '../../lib/json.ts';
import type { MethodResult } from '../types.ts';

export type VisionDirectVariant = {
  id: string;
  model: string;
  promptVariant: 'default' | 'careful' | 'measured';
};

const PROMPTS = {
  // baseline
  default: (p: { lat: number; lng: number; metersPerPixel: number; sizePx: number }) => `
Image is a top-down satellite tile centered on lat=${p.lat}, lng=${p.lng}.
Image dimensions: ${p.sizePx}x${p.sizePx} pixels.
Each pixel covers ${p.metersPerPixel.toFixed(3)} ground meters horizontally (and the same vertically).

Identify the primary residential roof at the center (ignore neighbors, garages, sheds).
Estimate:
1. The roof's planar (sloped) area in square feet — actual roofing material, NOT footprint.
2. Dominant roof pitch as x:12 (assume 6:12 if uncertain).
3. Whether central building is partially obscured.

Return JSON:
{
  "totalSqft": <number, roof material area>,
  "pitch": "<x:12>",
  "footprintSqft": <number>,
  "obscured": <bool>,
  "reasoning": "<one sentence>"
}
`.trim(),

  // explicitly walk through measurement
  careful: (p: { lat: number; lng: number; metersPerPixel: number; sizePx: number }) => `
TOP-DOWN SATELLITE TILE at lat=${p.lat}, lng=${p.lng}, ${p.sizePx}x${p.sizePx} pixels, ${p.metersPerPixel.toFixed(3)} meters/pixel.

Step 1: Locate the SINGLE primary residential dwelling at the center. Do not include detached garages, sheds, pools, decks, or neighboring houses unless they share a roof line with the main house.
Step 2: Mentally trace the roof outline (drip edge / gutter line). Count pixels along width and length.
Step 3: Convert pixels to feet: 1 px = ${(p.metersPerPixel * 3.281).toFixed(3)} ft. Footprint = width_ft × length_ft (or sum sub-rectangles for complex L/T shapes).
Step 4: Estimate dominant pitch by looking at shadows, ridge lines, and visible slopes. Use 4:12 for ranch/modern, 6:12 default, 8:12 for steep gables.
Step 5: Multiply footprint by pitch factor: 4:12 → 1.054, 6:12 → 1.118, 8:12 → 1.202, 10:12 → 1.302, 12:12 → 1.414.

Return ONLY JSON:
{
  "totalSqft": <number>,
  "pitch": "<x:12>",
  "footprintSqft": <number>,
  "obscured": <bool>,
  "reasoning": "<one sentence describing footprint dimensions and pitch>"
}
`.trim(),

  // emphasize avoiding common errors
  measured: (p: { lat: number; lng: number; metersPerPixel: number; sizePx: number }) => `
You are estimating roof area for an insurance/contracting bid from a top-down satellite tile.

Tile metadata:
- Centered at lat=${p.lat}, lng=${p.lng}
- ${p.sizePx}×${p.sizePx} pixels
- Each pixel = ${p.metersPerPixel.toFixed(3)} m on the ground = ${(p.metersPerPixel * 3.281).toFixed(3)} ft
- Therefore 1 m² = ${(1 / (p.metersPerPixel ** 2)).toFixed(0)} pixels

PRINCIPLES (avoid common mistakes):
- The ANSWER is roof MATERIAL area, not building footprint. Apply pitch multiplier (1.05–1.30 typical).
- Include ALL connected roof planes of the central house (porches, additions, attached garage).
- EXCLUDE driveway, pool deck, neighboring houses, detached structures.
- Most US residential homes are 1500–4500 sqft of roof material.
- If a building looks too large for a single home, it may be a duplex/condo — measure all of it.

Return ONLY JSON (no prose):
{
  "totalSqft": <number — roof material area>,
  "pitch": "<x:12 e.g. '6:12'>",
  "footprintSqft": <number>,
  "obscured": <boolean>,
  "reasoning": "<one sentence: footprint shape, dimensions, pitch>"
}
`.trim(),
};

const SYSTEM = 'You are a roofing-measurement expert. Return ONLY valid JSON. No markdown, no prose outside JSON.';

export async function visionDirect(args: {
  pngBytes: Uint8Array;
  lat: number;
  lng: number;
  metersPerPixel: number;
  sizePx: number;
  model?: string;
  promptVariant?: keyof typeof PROMPTS;
}): Promise<MethodResult> {
  const start = Date.now();
  const model = args.model ?? 'anthropic/claude-opus-4-7';
  const promptVariant = args.promptVariant ?? 'default';
  try {
    const r = await openrouterChat({
      model,
      temperature: 0,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPTS[promptVariant](args) },
            { type: 'image_url', image_url: { url: pngToDataUrl(args.pngBytes), detail: 'high' } },
          ],
        },
      ],
    });
    const text = r.choices[0]?.message?.content ?? '';
    const json = extractJson<any>(text);
    const pm = String(json.pitch ?? '6:12').match(/^(\d+):12$/);
    const pitchRatio = pm ? parseInt(pm[1], 10) / 12 : 0.5;
    return {
      method: `vision_direct:${promptVariant}`,
      model,
      totalSqft: typeof json.totalSqft === 'number' ? json.totalSqft : null,
      footprintSqft: typeof json.footprintSqft === 'number' ? json.footprintSqft : null,
      pitchRatio,
      reasoning: String(json.reasoning ?? ''),
      durationMs: Date.now() - start,
      raw: { model, promptVariant, response: r },
    };
  } catch (err: any) {
    return {
      method: `vision_direct:${promptVariant}`,
      model,
      totalSqft: null,
      durationMs: Date.now() - start,
      errorMessage: String(err?.message ?? err),
    };
  }
}
