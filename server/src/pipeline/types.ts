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
  buildingMaskPolygon?: number[][];
  perPlanePolygons?: number[][][];
  imageWidth?: number;
  imageHeight?: number;
  raw?: unknown;
};

export type QuoteRun = {
  address: string;
  formattedAddress: string;
  location: { lat: number; lng: number };
  results: MethodResult[];
  consensusSqft: number | null;
  combiner?: string;
  startedAt: string;
  finishedAt: string;
};
