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
 * Production combiner — picks "consensus" methods (those eligible for the final
 * sqft number) and applies median.
 *
 * Calibration on 29 addresses: median(opus-z19, opus-z20) achieves MAPE 25.5%,
 * bias -6.6%. This is the production combiner.
 *
 * Other (non-consensus) methods can still be in `results` for demo display.
 */
export function combineEnsemble(results: MethodResult[]): EnsembleResult {
  const eligible = results.filter(
    (r) =>
      r.method === 'vision_direct:measured' &&
      r.model === 'anthropic/claude-opus-4-7' &&
      r.totalSqft != null &&
      typeof r.totalSqft === 'number' &&
      (r.zoom === 19 || r.zoom === 20)
  );
  const sqfts = eligible.map((r) => r.totalSqft as number);
  if (!sqfts.length) {
    return { consensusSqft: null, combiner: 'median(opus-z19, opus-z20)', inputs: [] };
  }
  return {
    consensusSqft: Math.round(median(sqfts)),
    combiner: 'median(opus-z19, opus-z20)',
    inputs: eligible.map((r) => ({ method: r.method, model: r.model, zoom: r.zoom, sqft: r.totalSqft })),
  };
}
