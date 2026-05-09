import type { MethodResult } from './types.ts';

export type EnsembleResult = {
  consensusSqft: number | null;
  combiner: string;
  inputs: { method: string; model?: string; zoom?: number; sqft: number | null }[];
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * Ensemble combiner — preference order with courtyard-detection override:
 *
 *  - If SAM 2 found ≥3 planes covering meaningfully less than the MS polygon
 *    (≥10% smaller), the MS polygon is overcounting (courtyard/patio inside
 *    the polygon outline). Prefer SAM 2's plane-summed footprint.
 *  - Else prefer footprint_msbuildings (calibrated, MAPE ~5–6%).
 *  - Else fall back to sam2_footprint (when no MS polygon available).
 *  - Else median(vision_direct opus z19, z20).
 */
export function combineEnsemble(results: MethodResult[]): EnsembleResult {
  const ms = results.find(
    (r) => r.method === 'footprint_msbuildings' && typeof r.totalSqft === 'number'
  );
  const sam = results.find(
    (r) => r.method === 'sam2_footprint' && typeof r.totalSqft === 'number'
  ) as any;

  // Courtyard-detection override: SAM 2 plane-summed footprint shrinks vs MS.
  // Conservative trigger: SAM 2 plane sum is 70-90% of MS polygon
  // (suggests a real ~20% courtyard, not just SAM missing planes).
  // Below 70% we don't trust the segmentation; above 90% MS is fine as-is.
  if (
    ms &&
    sam &&
    sam.aggregation === 'planes' &&
    typeof sam.footprintSqft === 'number' &&
    typeof (ms as any).footprintSqft === 'number' &&
    sam.footprintSqft <= 0.9 * (ms as any).footprintSqft &&
    sam.footprintSqft >= 0.7 * (ms as any).footprintSqft
  ) {
    return {
      consensusSqft: Math.round(sam.totalSqft as number),
      combiner: 'SAM 2 per-plane (MS polygon includes courtyard)',
      inputs: [
        { method: sam.method, model: sam.model, sqft: sam.totalSqft },
        { method: ms.method, model: ms.model, sqft: ms.totalSqft },
      ],
    };
  }

  if (ms) {
    return {
      consensusSqft: Math.round(ms.totalSqft as number),
      combiner: 'footprint(MSBuildings) × pitch(vision)',
      inputs: [{ method: ms.method, model: ms.model, sqft: ms.totalSqft }],
    };
  }

  if (sam) {
    return {
      consensusSqft: Math.round(sam.totalSqft as number),
      combiner: 'SAM 2 mask × Qwen pitch (local, no MS polygon)',
      inputs: [{ method: sam.method, model: sam.model, sqft: sam.totalSqft }],
    };
  }

  const fallback = results.filter(
    (r) =>
      r.method === 'vision_direct:measured' &&
      r.model === 'anthropic/claude-opus-4-7' &&
      typeof r.totalSqft === 'number' &&
      (r.zoom === 19 || r.zoom === 20)
  );
  const sqfts = fallback.map((r) => r.totalSqft as number);
  if (!sqfts.length) {
    return { consensusSqft: null, combiner: 'no eligible methods', inputs: [] };
  }
  return {
    consensusSqft: Math.round(median(sqfts)),
    combiner: 'fallback: median(vision opus z19, z20)',
    inputs: fallback.map((r) => ({ method: r.method, model: r.model, zoom: r.zoom, sqft: r.totalSqft })),
  };
}
