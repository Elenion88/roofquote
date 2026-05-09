import { openrouterChat, pngToDataUrl } from '../../lib/openrouter.ts';
import type { MethodResult } from '../types.ts';

const MODEL = 'anthropic/claude-opus-4-7';

const SYSTEM = `You are a roofing-measurement expert analyzing a top-down satellite photo of a single residential property.
Return ONLY a JSON object matching the schema. No prose, no markdown.`;

const USER_TEMPLATE = (params: { lat: number; lng: number; metersPerPixel: number; sizePx: number }) => `
Image is a top-down satellite tile centered on lat=${params.lat}, lng=${params.lng}.
Image dimensions: ${params.sizePx}x${params.sizePx} pixels.
Each pixel covers ${params.metersPerPixel.toFixed(3)} ground meters horizontally (and the same vertically) at the image's center.

Identify the primary residential roof at the center of the image (ignore neighboring houses, garages, sheds).
Estimate:
1. The roof's planar (sloped) area in square feet — i.e. the actual roofing material area, NOT the building footprint.
2. The dominant roof pitch as the rise-over-run ratio (e.g. "6:12", "8:12"). Use 6:12 if uncertain (typical residential).
3. Whether the central building is partially obscured by trees or shadow.

Return JSON with this shape exactly:
{
  "totalSqft": <number, roof material area in sqft>,
  "pitch": "<x:12 string>",
  "footprintSqft": <number, building footprint area in sqft>,
  "obscured": <boolean>,
  "reasoning": "<one-sentence reason for your sqft number>"
}
`.trim();

export async function visionDirect(args: {
  pngBytes: Uint8Array;
  lat: number;
  lng: number;
  metersPerPixel: number;
  sizePx: number;
  model?: string;
}): Promise<MethodResult> {
  const start = Date.now();
  try {
    const r = await openrouterChat({
      model: args.model ?? MODEL,
      temperature: 0,
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: USER_TEMPLATE(args) },
            { type: 'image_url', image_url: { url: pngToDataUrl(args.pngBytes), detail: 'high' } },
          ],
        },
      ],
    });
    const text = r.choices[0]?.message?.content ?? '';
    const json = JSON.parse(text);
    const pitchMatch = String(json.pitch ?? '6:12').match(/^(\d+):12$/);
    const pitchRatio = pitchMatch ? parseInt(pitchMatch[1], 10) / 12 : 6 / 12;
    return {
      method: 'vision_direct',
      model: args.model ?? MODEL,
      totalSqft: typeof json.totalSqft === 'number' ? json.totalSqft : null,
      footprintSqft: typeof json.footprintSqft === 'number' ? json.footprintSqft : null,
      pitchRatio,
      reasoning: String(json.reasoning ?? ''),
      durationMs: Date.now() - start,
      raw: { request: { model: args.model ?? MODEL }, response: r },
    };
  } catch (err: any) {
    return {
      method: 'vision_direct',
      model: args.model ?? MODEL,
      totalSqft: null,
      durationMs: Date.now() - start,
      errorMessage: String(err?.message ?? err),
    };
  }
}
