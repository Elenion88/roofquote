export type MethodResult = {
  method: string;
  model?: string;
  zoom?: number;
  totalSqft: number | null;
  pitchRatio?: number | null; // x:12 expressed as x/12
  footprintSqft?: number | null;
  reasoning?: string;
  durationMs: number;
  errorMessage?: string;
  raw?: unknown;
};

export type QuoteRun = {
  address: string;
  formattedAddress: string;
  location: { lat: number; lng: number };
  results: MethodResult[];
  consensusSqft: number | null;
  startedAt: string;
  finishedAt: string;
};
