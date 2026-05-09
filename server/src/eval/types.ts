export type EvalRecord = {
  id: string;
  address: string;
  formatted: string;
  lat: number;
  lng: number;
  kind: 'example' | 'test' | 'neighbor';
  parentId?: string;
  refA?: number;
  refB?: number;
  solarOracle: {
    areaSqft?: number;
    segments?: number;
    error?: string;
  };
};

export type VariantResult = {
  variantId: string;
  recordId: string;
  totalSqft: number | null;
  oracleSqft: number;
  pctErrorVsOracle: number | null;  // (totalSqft - oracle) / oracle * 100
  pitchRatio: number | null;
  durationMs: number;
  errorMessage?: string;
};
