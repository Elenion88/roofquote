export type LineItem = {
  description: string;
  quantity: number;
  unit: 'sq' | 'lf' | 'ea';
  unitCost: number;
  totalCost: number;
  category: string;
};

export type Estimate = {
  address: string;
  generatedAt: string;
  measurement: { totalSqft: number; pitch: string; pitchRatio: number; squares: number; wasteFactor: number };
  lineItems: { ridge: number; hip: number; valleys: number; rakes: number; eaves: number; flashing: number; stepFlashing: number };
  materials: LineItem[];
  labor: LineItem[];
  subtotal: number;
  tax: number;
  total: number;
  region: { city: string; state: string; pricingTier: 'low' | 'medium' | 'high' };
  notes: string[];
  validityDays: number;
  warrantyYears: number;
};

export type MethodResult = {
  method: string;
  model?: string;
  zoom?: number;
  totalSqft: number | null;
  pitchRatio?: number | null;
  footprintSqft?: number | null;
  reasoning?: string;
  durationMs: number;
  errorMessage?: string;
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
  estimate?: Estimate | null;
};
