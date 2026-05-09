import { lookupPolygon } from '../../lib/msbuildings.ts';
import { pitchMultiplier } from '../../lib/geometry.ts';
import { cachyPitch } from '../../lib/cachy.ts';
import type { MethodResult } from '../types.ts';

/**
 * MS Open Buildings footprint × Qwen2.5-VL pitch (LOCAL — no API).
 *
 * Replaces the previous Claude-via-OpenRouter pitch detection with a local
 * Qwen2.5-VL call on cachy-tower. Building footprint comes from Microsoft
 * Open Buildings polygon — same shoelace + Web Mercator math as before.
 *
 *   roof_sqft = MS_polygon_area_sqft × √(1 + (rise/12)²)
 *
 * No commercial measurement product or commercial LLM API is in this method's path.
 */
export async function footprintMSBuildings(args: {
  z19PngBytes: Uint8Array;
  z20PngBytes: Uint8Array;
  lat: number;
  lng: number;
  model?: string;
}): Promise<MethodResult & { footprintSqft: number }> {
  const start = Date.now();
  const hit = lookupPolygon(args.lat, args.lng);
  if (!hit) {
    return {
      method: 'footprint_msbuildings',
      model: 'qwen2.5vl:7b',
      totalSqft: null,
      footprintSqft: 0,
      durationMs: Date.now() - start,
      errorMessage: 'no MS Buildings polygon for this address',
    };
  }

  let pitchRise = 6;
  let pitchReasoning = 'default 6:12';
  let pitchConfidence = 'unknown';
  try {
    // Use the z20 tile (tighter zoom = better pitch detail)
    const r = await cachyPitch(args.z20PngBytes);
    const pm = r.pitch.match(/^(\d+):12$/);
    if (pm) pitchRise = parseInt(pm[1], 10);
    pitchReasoning = r.reasoning;
    pitchConfidence = r.confidence;
  } catch (err: any) {
    pitchReasoning = `Qwen pitch error: ${err?.message ?? err}`;
  }

  const mult = pitchMultiplier(pitchRise);
  const totalSqft = Math.round(hit.footprintSqft * mult);

  return {
    method: 'footprint_msbuildings',
    model: 'qwen2.5vl:7b',
    totalSqft,
    footprintSqft: Math.round(hit.footprintSqft),
    pitchRatio: pitchRise / 12,
    reasoning:
      `MS Open Buildings polygon (${hit.footprintM2.toFixed(0)} m², ${hit.centroidDistM.toFixed(1)} m from address) ` +
      `× pitch ${pitchRise}:12 (×${mult.toFixed(3)}, Qwen2.5-VL ${pitchConfidence}). ${pitchReasoning}`,
    durationMs: Date.now() - start,
  };
}
