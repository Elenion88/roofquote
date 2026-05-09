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
 * Ensemble combiner.
 *
 * Strategy:
 *  - If footprint_msbuildings produced a number, USE THAT as the spine.
 *    It's deterministic geometry × LLM-derived pitch — by far the most accurate path.
 *  - Otherwise fall back to the median of vision_direct results at z19+z20.
 */
export function combineEnsemble(results: MethodResult[]): EnsembleResult {
  // Spine path: footprint_msbuildings
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

  // Fallback path: vision_direct median(z19, z20)
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
