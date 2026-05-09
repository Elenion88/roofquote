import { openrouterChat, jpegToDataUrl } from '../../lib/openrouter.ts';
import { extractJson } from '../../lib/json.ts';
import { fetchMultiplePanos } from '../../lib/streetview.ts';
import type { StreetViewImage } from '../../lib/streetview.ts';

const PITCH_PROMPT = `
You are looking at a STREET-LEVEL view of a building, captured from the road.

YOUR ONE TASK: estimate the angle (in degrees) of the visible roof slope, from horizontal.

REFERENCE TABLE:
| angle from horizontal | pitch (rise:12) |
|---|---|
| 14° | 3:12 (very low / nearly flat) |
| 18° | 4:12 (low slope, walkable) |
| 23° | 5:12 |
| 27° | 6:12 (standard residential — most common) |
| 30° | 7:12 |
| 34° | 8:12 (steep, snowy regions) |
| 37° | 9:12 |
| 40° | 10:12 (very steep) |
| 45° | 12:12 (extreme, rare) |

HOW TO MEASURE:
1. Find the visible gable end (triangular face). If only side slopes are visible (hip roof), use the side slope angle.
2. Imagine the gable triangle's base (eave-to-eave horizontal line) and one of its sides going up to the peak.
3. Estimate the angle between those two lines from horizontal.
4. Snap to the nearest entry in the reference table.

CRITICAL RULES:
- Look at the building's gable, NOT vehicles, fences, signs, or trees.
- If the gable is clearly LOW (looks almost flat / very wide triangle), choose 4:12 or below.
- If the peak rises steeply (sharp, narrow triangle), choose 8:12 or above.
- Most US residential is 6:12. Most churches and ranch homes are 4:12 to 5:12.
- Do NOT default to 6:12 if the gable shows otherwise.

Return ONLY this JSON:
{
  "angleDegrees": <number>,
  "pitch": "<rise:12>",
  "confidence": "low" | "medium" | "high",
  "reasoning": "<one sentence>"
}
`.trim();

export type StreetViewPitchResult = {
  source: 'streetview';
  pitchRise: number;
  angleDegrees: number;
  confidence: 'low' | 'medium' | 'high' | 'unknown';
  reasoning: string;
  durationMs: number;
  imageryDate?: string;
  panoDistanceM?: number;
  panoCount?: number;
  perPanoResults?: any[];
  errorMessage?: string;
};

const RISES = [3, 4, 5, 6, 7, 8, 9, 10, 12];
const RISE_ANGLES = RISES.map((r) => ({ rise: r, deg: (Math.atan(r / 12) * 180) / Math.PI }));
function snapAngleToRise(angleDeg: number): number {
  let best = RISE_ANGLES[0];
  let bestDiff = Math.abs(RISE_ANGLES[0].deg - angleDeg);
  for (const a of RISE_ANGLES) {
    const d = Math.abs(a.deg - angleDeg);
    if (d < bestDiff) { best = a; bestDiff = d; }
  }
  return best.rise;
}

async function detectPitchFromImage(args: { sv: StreetViewImage; model: string }) {
  const r = await openrouterChat({
    model: args.model,
    temperature: 0,
    max_tokens: 250,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are an expert roofer who measures pitch angles from photographs. Return ONLY valid JSON.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: PITCH_PROMPT },
          { type: 'image_url', image_url: { url: jpegToDataUrl(args.sv.pngBytes), detail: 'high' } },
        ],
      },
    ],
  });
  const text = r.choices[0]?.message?.content ?? '';
  const json = extractJson<{ angleDegrees: number; pitch: string; confidence: string; reasoning: string }>(text);
  const angleDegrees = typeof json.angleDegrees === 'number' ? json.angleDegrees : 27;
  const rise = snapAngleToRise(angleDegrees);
  const confidence = ['low', 'medium', 'high'].includes(json.confidence) ? (json.confidence as any) : 'medium';
  return {
    panoId: args.sv.panoId,
    panoDistanceM: args.sv.panoDistanceM,
    rise,
    angleDegrees,
    confidence,
    reasoning: json.reasoning ?? '',
  };
}

export async function streetviewPitch(args: {
  lat: number;
  lng: number;
  model?: string;
}): Promise<StreetViewPitchResult> {
  const start = Date.now();
  const model = args.model ?? 'anthropic/claude-opus-4-7';
  try {
    const panos = await fetchMultiplePanos({
      buildingLat: args.lat,
      buildingLng: args.lng,
      maxPanos: 3,
    });
    if (panos.length === 0) {
      return {
        source: 'streetview',
        pitchRise: 6,
        angleDegrees: 0,
        confidence: 'unknown',
        reasoning: '',
        durationMs: Date.now() - start,
        errorMessage: 'no Street View panorama found',
      };
    }

    // Run pitch detection on each pano in parallel
    const results = await Promise.all(panos.map((sv) => detectPitchFromImage({ sv, model }).catch((e) => ({
      panoId: sv.panoId,
      panoDistanceM: sv.panoDistanceM,
      rise: 6,
      angleDegrees: 0,
      confidence: 'unknown' as const,
      reasoning: `error: ${String(e?.message ?? e)}`,
    }))));

    const valid = results.filter((r) => r.confidence !== 'unknown');
    if (valid.length === 0) {
      return {
        source: 'streetview',
        pitchRise: 6,
        angleDegrees: 0,
        confidence: 'unknown',
        reasoning: 'all panos errored',
        durationMs: Date.now() - start,
        panoCount: panos.length,
        perPanoResults: results,
      };
    }

    // Median rise across valid panos
    const sortedRises = valid.map((r) => r.rise).sort((a, b) => a - b);
    const medianRise = sortedRises[Math.floor(sortedRises.length / 2)];

    // Median angle
    const sortedAngles = valid.map((r) => r.angleDegrees).sort((a, b) => a - b);
    const medianAngle = sortedAngles[Math.floor(sortedAngles.length / 2)];

    // Confidence: majority of high/medium → medium; if all 3 agree → high; if 2 of 3 → medium; else → low
    const confCount = valid.filter((r) => r.confidence === 'high').length;
    const allAgree = valid.every((r) => r.rise === valid[0].rise);
    let consensusConfidence: 'low' | 'medium' | 'high' = 'medium';
    if (allAgree && valid.length >= 2) consensusConfidence = 'high';
    else if (confCount >= 2) consensusConfidence = 'high';
    else if (valid.length === 1) consensusConfidence = valid[0].confidence === 'high' ? 'high' : 'medium';

    return {
      source: 'streetview',
      pitchRise: medianRise,
      angleDegrees: medianAngle,
      confidence: consensusConfidence,
      reasoning: `${valid.length} panos: rises ${valid.map((r) => r.rise).join(', ')}, median ${medianRise}:12`,
      durationMs: Date.now() - start,
      imageryDate: panos[0].imageryDate,
      panoDistanceM: panos[0].panoDistanceM,
      panoCount: panos.length,
      perPanoResults: results,
    };
  } catch (err: any) {
    return {
      source: 'streetview',
      pitchRise: 6,
      angleDegrees: 0,
      confidence: 'unknown',
      reasoning: '',
      durationMs: Date.now() - start,
      errorMessage: String(err?.message ?? err),
    };
  }
}
