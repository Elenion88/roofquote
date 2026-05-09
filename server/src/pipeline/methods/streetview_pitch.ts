import { openrouterChat, jpegToDataUrl } from '../../lib/openrouter.ts';
import { extractJson } from '../../lib/json.ts';
import { fetchStreetViewFacing } from '../../lib/streetview.ts';

const PITCH_PROMPT = `
You are looking at a STREET-LEVEL view of a building, captured from the road.

YOUR ONE TASK: estimate the angle (in degrees) of the visible roof slope, from horizontal.

REFERENCE TABLE (memorize before answering):
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

HOW TO MEASURE FROM THIS IMAGE:
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
  "angleDegrees": <number, your estimated gable angle from horizontal>,
  "pitch": "<rise:12, snapped from reference table>",
  "confidence": "low" | "medium" | "high",
  "reasoning": "<one sentence: which gable feature you used>"
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
  errorMessage?: string;
};

/** Snap an angle in degrees to nearest standard pitch rise (in :12). */
function snapAngleToRise(angleDeg: number): number {
  // Pitch x:12 → angle = atan(x/12) in degrees
  const RISES = [3, 4, 5, 6, 7, 8, 9, 10, 12];
  const angles = RISES.map((r) => ({ rise: r, deg: (Math.atan(r / 12) * 180) / Math.PI }));
  let best = angles[0];
  let bestDiff = Math.abs(angles[0].deg - angleDeg);
  for (const a of angles) {
    const d = Math.abs(a.deg - angleDeg);
    if (d < bestDiff) { best = a; bestDiff = d; }
  }
  return best.rise;
}

export async function streetviewPitch(args: {
  lat: number;
  lng: number;
  model?: string;
}): Promise<StreetViewPitchResult> {
  const start = Date.now();
  const model = args.model ?? 'anthropic/claude-opus-4-7';
  try {
    const sv = await fetchStreetViewFacing({
      buildingLat: args.lat,
      buildingLng: args.lng,
    });
    if (!sv) {
      return {
        source: 'streetview',
        pitchRise: 6,
        angleDegrees: 0,
        confidence: 'unknown',
        reasoning: '',
        durationMs: Date.now() - start,
        errorMessage: 'no Street View panorama within 80 m',
      };
    }

    const r = await openrouterChat({
      model,
      temperature: 0,
      max_tokens: 250,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert roofer who measures pitch angles from photographs. Return ONLY valid JSON.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: PITCH_PROMPT },
            { type: 'image_url', image_url: { url: jpegToDataUrl(sv.pngBytes), detail: 'high' } },
          ],
        },
      ],
    });
    const text = r.choices[0]?.message?.content ?? '';
    const json = extractJson<{ angleDegrees: number; pitch: string; confidence: string; reasoning: string }>(text);

    const angleDegrees = typeof json.angleDegrees === 'number' ? json.angleDegrees : 27;
    // Snap our own pitch from the angle (don't blindly trust the model's pitch label)
    const pitchRiseFromAngle = snapAngleToRise(angleDegrees);
    // If model's pitch label disagrees with its own angle, trust the angle
    const pm = String(json.pitch ?? '6:12').match(/^(\d+):12$/);
    const pitchRiseFromLabel = pm ? parseInt(pm[1], 10) : 6;
    const pitchRise = pitchRiseFromAngle;

    const confidence = ['low', 'medium', 'high'].includes(json.confidence) ? (json.confidence as any) : 'medium';
    const labelMatchNote =
      pitchRiseFromAngle !== pitchRiseFromLabel
        ? ` [label said ${pitchRiseFromLabel}:12 but angle ${angleDegrees}° → ${pitchRiseFromAngle}:12]`
        : '';
    return {
      source: 'streetview',
      pitchRise,
      angleDegrees,
      confidence,
      reasoning: (json.reasoning ?? '') + labelMatchNote,
      durationMs: Date.now() - start,
      imageryDate: sv.imageryDate,
      panoDistanceM: sv.panoDistanceM,
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
