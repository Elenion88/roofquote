import { openrouterChat, jpegToDataUrl } from '../../lib/openrouter.ts';
import { extractJson } from '../../lib/json.ts';
import { fetchStreetViewFacing } from '../../lib/streetview.ts';

const PITCH_PROMPT = `
You are looking at a STREET-LEVEL view of a residential property, captured from the road. The camera is pointed slightly upward at the house.

Your only task: estimate the dominant roof pitch as rise:12.

KEY VISUAL CUES:
- Look at the visible GABLE END (triangular face of the roof) if any.
- A gable's angle with the horizontal directly maps to pitch:
  - 14° angle from horizontal = 3:12
  - 18° angle = 4:12
  - 27° angle = 6:12 (standard residential)
  - 34° angle = 8:12 (steep, snowy regions)
  - 40° angle = 10:12
  - 45° angle = 12:12
- Hip roofs (no flat triangular end visible): use the side-slope angle relative to the horizontal eave.
- If the roof shape is complex (multiple ridges), choose the pitch of the dominant/largest plane.

If the building is partially or fully obscured (trees, vehicles, fences), say so and use confidence "low".

Return ONLY JSON:
{
  "pitch": "<rise:12 e.g. '6:12'>",
  "confidence": "low" | "medium" | "high",
  "reasoning": "<one sentence: what visual cue you used>"
}
`.trim();

export type StreetViewPitchResult = {
  source: 'streetview';
  pitchRise: number; // x in x:12
  confidence: 'low' | 'medium' | 'high' | 'unknown';
  reasoning: string;
  durationMs: number;
  imageryDate?: string;
  panoDistanceM?: number;
  errorMessage?: string;
};

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
        confidence: 'unknown',
        reasoning: '',
        durationMs: Date.now() - start,
        errorMessage: 'no Street View panorama within 80 m',
      };
    }

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
            { type: 'text', text: PITCH_PROMPT },
            { type: 'image_url', image_url: { url: jpegToDataUrl(sv.pngBytes), detail: 'high' } },
          ],
        },
      ],
    });
    const text = r.choices[0]?.message?.content ?? '';
    const json = extractJson<{ pitch: string; confidence: string; reasoning: string }>(text);
    const pm = String(json.pitch ?? '6:12').match(/^(\d+):12$/);
    const pitchRise = pm ? parseInt(pm[1], 10) : 6;
    const confidence = ['low', 'medium', 'high'].includes(json.confidence) ? (json.confidence as any) : 'medium';
    return {
      source: 'streetview',
      pitchRise,
      confidence,
      reasoning: json.reasoning ?? '',
      durationMs: Date.now() - start,
      imageryDate: sv.imageryDate,
      panoDistanceM: sv.panoDistanceM,
    };
  } catch (err: any) {
    return {
      source: 'streetview',
      pitchRise: 6,
      confidence: 'unknown',
      reasoning: '',
      durationMs: Date.now() - start,
      errorMessage: String(err?.message ?? err),
    };
  }
}
