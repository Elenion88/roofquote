import type { MethodResult } from './types.ts';

export type EnsembleResult = {
  consensusSqft: number | null;
  combiner: string;
  inputs: { method: string; model?: string; zoom?: number; sqft: number | null }[];
};

/**
 * Ensemble combiner — preference order with courtyard-detection override.
 * Local-only methods: MS Buildings polygon × Qwen pitch (primary), SAM 2 mask × Qwen pitch (backup).
 *
 *  - If SAM 2 found ≥3 planes covering meaningfully less than the MS polygon
 *    (≥10% smaller), the MS polygon is overcounting (courtyard/patio inside
 *    the polygon outline). Prefer SAM 2's plane-summed footprint.
 *  - Else prefer footprint_msbuildings (calibrated, MAPE ~5–6%).
 *  - Else fall back to sam2_footprint (when no MS polygon available).
 *  - Else no consensus (both methods failed).
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

  return { consensusSqft: null, combiner: 'no eligible methods', inputs: [] };
}
