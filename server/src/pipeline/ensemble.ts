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
 * Ensemble combiner — prefers methods in this order:
 *  1. sam2_footprint (SAM 2 mask × Qwen pitch — local, no commercial measurement)
 *  2. footprint_msbuildings (MS Open Buildings polygon × Claude pitch)
 *  3. median(vision_direct opus z19, z20)  (fallback)
 */
export function combineEnsemble(results: MethodResult[]): EnsembleResult {
  // Tier 1: MS Buildings × multi-zoom pitch (calibrated, MAPE ~4%)
  const ms = results.find(
    (r) => r.method === 'footprint_msbuildings' && typeof r.totalSqft === 'number'
  );
  if (ms) {
    return {
      consensusSqft: Math.round(ms.totalSqft as number),
      combiner: 'footprint(MSBuildings) × pitch(vision)',
      inputs: [{ method: ms.method, model: ms.model, sqft: ms.totalSqft }],
    };
  }

  // Tier 2: SAM 2 footprint × Qwen pitch (local, no APIs) — fallback when MS polygon missing
  const sam = results.find((r) => r.method === 'sam2_footprint' && typeof r.totalSqft === 'number');
  if (sam) {
    return {
      consensusSqft: Math.round(sam.totalSqft as number),
      combiner: 'SAM 2 mask × Qwen pitch (local, no MS polygon)',
      inputs: [{ method: sam.method, model: sam.model, sqft: sam.totalSqft }],
    };
  }

  // Tier 3: vision_direct median
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
