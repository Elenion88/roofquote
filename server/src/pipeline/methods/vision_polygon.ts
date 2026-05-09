import { openrouterChat, pngToDataUrl } from '../../lib/openrouter.ts';
import { extractJson } from '../../lib/json.ts';
import { pixelArea, pixelAreaToGroundM2, pitchMultiplier, M2_TO_SQFT, isReasonablePolygon } from '../../lib/geometry.ts';
import type { MethodResult } from '../types.ts';
import type { PixelPolygon } from '../../lib/geometry.ts';

const SYSTEM = 'You are a roofing-measurement expert who outputs polygon coordinates in JSON. Be precise and conservative.';

const PROMPT = (p: { lat: number; lng: number; metersPerPixel: number; sizePx: number }) => `
TOP-DOWN SATELLITE TILE, ${p.sizePx}×${p.sizePx} pixels, centered at lat=${p.lat}, lng=${p.lng}.
Each pixel = ${p.metersPerPixel.toFixed(3)} m on the ground = ${(p.metersPerPixel * 3.281).toFixed(3)} ft.
Image origin (0,0) is the top-left; +x is right, +y is down.

Your task: outline the building footprint of the SINGLE primary residential dwelling at the center.

CRITICAL RULES:
1. Trace the OUTSIDE EDGE of the roof (drip edge / gutter line) of the central house.
2. Include attached porches, additions, and attached garages — anything sharing the main roof structure.
3. EXCLUDE: detached structures, neighboring houses, driveway, pool deck, sheds.
4. If the building is L-shaped or T-shaped, follow the actual outline (don't simplify to a rectangle).
5. Use 8–24 vertices. More vertices for complex roofs, fewer for simple rectangles.
6. List vertices in order (clockwise or counter-clockwise).

Also estimate the dominant roof pitch as rise:12 (4:12 = low, 6:12 = standard, 8:12 = steep, 10:12+ = very steep).

Return ONLY JSON:
{
  "polygon": [[x1, y1], [x2, y2], ..., [xN, yN]],
  "pitch": "<rise:12 e.g. '6:12'>",
  "obscured": <bool>,
  "reasoning": "<one sentence: shape and dimensions>"
}
`.trim();

export async function visionPolygon(args: {
  pngBytes: Uint8Array;
  lat: number;
  lng: number;
  metersPerPixel: number;
  sizePx: number;
  model?: string;
}): Promise<MethodResult & { polygon?: PixelPolygon; pixelArea?: number; footprintM2?: number }> {
  const start = Date.now();
  const model = args.model ?? 'anthropic/claude-opus-4-7';
  try {
    const r = await openrouterChat({
      model,
      temperature: 0,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT(args) },
            { type: 'image_url', image_url: { url: pngToDataUrl(args.pngBytes), detail: 'high' } },
          ],
        },
      ],
    });
    const text = r.choices[0]?.message?.content ?? '';
    const json = extractJson<{
      polygon: PixelPolygon;
      pitch: string;
      obscured: boolean;
      reasoning: string;
    }>(text);

    const poly = json.polygon ?? [];
    if (!isReasonablePolygon(poly, args.sizePx)) {
      return {
        method: 'vision_polygon',
        model,
        totalSqft: null,
        durationMs: Date.now() - start,
        errorMessage: `invalid polygon (${poly.length} points)`,
        raw: { model, response: r, parsed: json },
      };
    }
    const pa = pixelArea(poly);
    const footprintM2 = pixelAreaToGroundM2(pa, args.metersPerPixel);
    const footprintSqft = footprintM2 * M2_TO_SQFT;

    const pm = String(json.pitch ?? '6:12').match(/^(\d+):12$/);
    const rise = pm ? parseInt(pm[1], 10) : 6;
    const pitchRatio = rise / 12;
    const mult = pitchMultiplier(rise);
    const totalSqft = Math.round(footprintSqft * mult);

    return {
      method: 'vision_polygon',
      model,
      totalSqft,
      footprintSqft: Math.round(footprintSqft),
      pitchRatio,
      reasoning: String(json.reasoning ?? ''),
      durationMs: Date.now() - start,
      polygon: poly,
      pixelArea: pa,
      footprintM2,
      raw: { model, response: r, parsed: json },
    };
  } catch (err: any) {
    return {
      method: 'vision_polygon',
      model,
      totalSqft: null,
      durationMs: Date.now() - start,
      errorMessage: String(err?.message ?? err),
    };
  }
}
