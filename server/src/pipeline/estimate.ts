// Deterministic asphalt-shingle replacement pricing calculator.
// Pure local — no LLM dependency. Inputs (totalSqft, pitch, footprint, state)
// → fully-typed Estimate JSON consumed by EstimateCard / MeasurementBreakdownCard.

export type LineItem = {
  description: string;
  quantity: number;
  unit: 'sq' | 'lf' | 'ea';
  unitCost: number;
  totalCost: number;
  category:
    | 'tearoff'
    | 'underlayment'
    | 'shingles'
    | 'flashing'
    | 'ridge'
    | 'ventilation'
    | 'gutters'
    | 'labor'
    | 'disposal'
    | 'permit'
    | 'other';
};

export type Estimate = {
  address: string;
  generatedAt: string;
  measurement: {
    totalSqft: number;
    pitch: string;
    pitchRatio: number;
    squares: number;
    wasteFactor: number;
  };
  lineItems: {
    ridge: number;
    hip: number;
    valleys: number;
    rakes: number;
    eaves: number;
    flashing: number;
    stepFlashing: number;
  };
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

const HIGH_TIER = new Set(['CA', 'NY', 'MA', 'CT', 'NJ', 'HI', 'AK', 'WA', 'DC', 'OR', 'RI']);
const LOW_TIER = new Set([
  'TX', 'MO', 'GA', 'OK', 'AL', 'MS', 'AR', 'LA', 'KY', 'TN', 'IN', 'OH',
  'KS', 'NE', 'SD', 'ND', 'IA', 'WV', 'NM', 'WY', 'ID', 'MT',
]);

type Tier = 'low' | 'medium' | 'high';

const TIER_PRICES: Record<Tier, {
  shingle: number; underlayment: number; iceWater: number; dripEdge: number;
  ridgeCap: number; ridgeVent: number; stepFlash: number;
  chimneyKit: number; skylightKit: number; pipeBoot: number;
  tearoff: number; install: number; lump: number;
}> = {
  low:    { shingle: 115, underlayment: 25, iceWater: 75, dripEdge: 2.5, ridgeCap: 5, ridgeVent: 7, stepFlash: 8,  chimneyKit: 200, skylightKit: 150, pipeBoot: 25, tearoff: 90,  install: 50, lump: 300 },
  medium: { shingle: 140, underlayment: 25, iceWater: 80, dripEdge: 2.5, ridgeCap: 5, ridgeVent: 7, stepFlash: 9,  chimneyKit: 250, skylightKit: 175, pipeBoot: 30, tearoff: 100, install: 60, lump: 375 },
  high:   { shingle: 165, underlayment: 30, iceWater: 90, dripEdge: 3.0, ridgeCap: 6, ridgeVent: 8, stepFlash: 11, chimneyKit: 325, skylightKit: 225, pipeBoot: 40, tearoff: 120, install: 70, lump: 500 },
};

// State-level combined sales-tax rates (state + typical local). Rough — final tax adjusted at invoicing.
const STATE_TAX: Record<string, number> = {
  AL: 0.0925, AK: 0.0,    AZ: 0.084,  AR: 0.095,  CA: 0.0875, CO: 0.0430,
  CT: 0.0635, DE: 0.0,    DC: 0.06,   FL: 0.07,   GA: 0.07,   HI: 0.0444,
  ID: 0.06,   IL: 0.0885, IN: 0.07,   IA: 0.06,   KS: 0.0865, KY: 0.06,
  LA: 0.0950, ME: 0.055,  MD: 0.06,   MA: 0.0625, MI: 0.06,   MN: 0.0738,
  MS: 0.07,   MO: 0.0825, MT: 0.0,    NE: 0.068,  NV: 0.0825, NH: 0.0,
  NJ: 0.0663, NM: 0.078,  NY: 0.08875, NC: 0.068, ND: 0.07,   OH: 0.068,
  OK: 0.080,  OR: 0.0,    PA: 0.06,   RI: 0.07,   SC: 0.075,  SD: 0.065,
  TN: 0.0950, TX: 0.0825, UT: 0.0720, VT: 0.06,   VA: 0.0530, WA: 0.0950,
  WV: 0.06,   WI: 0.0540, WY: 0.06,
};

function tierForState(state: string): Tier {
  if (HIGH_TIER.has(state)) return 'high';
  if (LOW_TIER.has(state)) return 'low';
  return 'medium';
}

function cityFromFormatted(formatted: string): string {
  const parts = formatted.split(',').map((s) => s.trim());
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^[A-Z]{2}\s+\d{5}/.test(parts[i])) return parts[i - 1] ?? 'Unknown';
  }
  return parts.length >= 2 ? parts[parts.length - 2] : 'Unknown';
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Build a customer-facing estimate from measured inputs — fully deterministic.
 * Async signature preserved for backwards compatibility with quote.ts call site.
 */
export async function generateEstimate(args: {
  address: string;
  formattedAddress: string;
  totalSqft: number;
  footprintSqft: number;
  pitch: string;
  pitchRatio: number;
  state: string;
}): Promise<Estimate> {
  const tier = tierForState(args.state);
  const p = TIER_PRICES[tier];
  const taxRate = STATE_TAX[args.state] ?? 0.06;

  // Geometry from footprint. Assume ~1.4 length:width ratio for a typical home.
  const Lf = Math.sqrt(args.footprintSqft * 1.4);
  const Wf = Math.sqrt(args.footprintSqft / 1.4);
  const perimeter = 2 * (Lf + Wf);

  const lineItems = {
    ridge: r1(perimeter * 0.25),
    hip: r1(perimeter * 0.10),
    valleys: r1(perimeter * 0.15),
    rakes: r1(perimeter * 0.40),
    eaves: r1(perimeter),
    flashing: 15,
    stepFlashing: 25,
  };

  const wasteFactor = 1.10;
  const squares = args.totalSqft / 100;
  const orderSquares = r2(squares * wasteFactor);
  const drip = r1(lineItems.eaves + lineItems.rakes);
  // 3-ft strip of ice & water along eaves and valleys, in squares (1 sq = 100 sqft)
  const iceWaterSquares = r2(((lineItems.eaves + lineItems.valleys) * 3) / 100);
  const pipeBoots = 3;

  const ridgeCapLf = r1(lineItems.ridge + lineItems.hip);

  const materials: LineItem[] = [
    { description: 'Architectural asphalt shingles (30-yr), installed', quantity: orderSquares, unit: 'sq', unitCost: p.shingle, totalCost: r2(orderSquares * p.shingle), category: 'shingles' },
    { description: 'Synthetic underlayment',                            quantity: orderSquares, unit: 'sq', unitCost: p.underlayment, totalCost: r2(orderSquares * p.underlayment), category: 'underlayment' },
    { description: 'Ice & water shield (eaves + valleys)',              quantity: iceWaterSquares, unit: 'sq', unitCost: p.iceWater, totalCost: r2(iceWaterSquares * p.iceWater), category: 'underlayment' },
    { description: 'Drip edge (eaves + rakes)',                         quantity: drip, unit: 'lf', unitCost: p.dripEdge, totalCost: r2(drip * p.dripEdge), category: 'flashing' },
    { description: 'Ridge cap shingles',                                quantity: ridgeCapLf, unit: 'lf', unitCost: p.ridgeCap, totalCost: r2(ridgeCapLf * p.ridgeCap), category: 'ridge' },
    { description: 'Step flashing at wall',                             quantity: lineItems.stepFlashing, unit: 'lf', unitCost: p.stepFlash, totalCost: r2(lineItems.stepFlashing * p.stepFlash), category: 'flashing' },
    { description: 'Chimney flashing kit',                              quantity: 1, unit: 'ea', unitCost: p.chimneyKit, totalCost: p.chimneyKit, category: 'flashing' },
    { description: 'Pipe flashing boots',                               quantity: pipeBoots, unit: 'ea', unitCost: p.pipeBoot, totalCost: pipeBoots * p.pipeBoot, category: 'flashing' },
    { description: 'Ridge vent (continuous)',                           quantity: lineItems.ridge, unit: 'lf', unitCost: p.ridgeVent, totalCost: r2(lineItems.ridge * p.ridgeVent), category: 'ventilation' },
  ];

  const sq = r2(squares);
  const labor: LineItem[] = [
    { description: 'Tear-off existing shingles + haul/dispose', quantity: sq, unit: 'sq', unitCost: p.tearoff, totalCost: r2(sq * p.tearoff), category: 'tearoff' },
    { description: 'Installation labor',                        quantity: sq, unit: 'sq', unitCost: p.install, totalCost: r2(sq * p.install), category: 'labor' },
    { description: 'Permit + dumpster fees',                    quantity: 1, unit: 'ea', unitCost: p.lump, totalCost: p.lump, category: 'permit' },
  ];

  const subtotal = r2([...materials, ...labor].reduce((s, x) => s + x.totalCost, 0));
  const tax = r2(subtotal * taxRate);
  const total = r2(subtotal + tax);

  return {
    address: args.formattedAddress,
    generatedAt: new Date().toISOString(),
    measurement: {
      totalSqft: args.totalSqft,
      pitch: args.pitch,
      pitchRatio: args.pitchRatio,
      squares: r2(squares),
      wasteFactor,
    },
    lineItems,
    materials,
    labor,
    subtotal,
    tax,
    total,
    region: { city: cityFromFormatted(args.formattedAddress), state: args.state, pricingTier: tier },
    notes: [
      'Estimate assumes one chimney and three plumbing vent penetrations; adjust if actual conditions differ.',
      'Tear-off priced for a single layer of existing shingles; additional layers billed at $40/sq.',
      'Decking replacement (if rotted or damaged sheathing is found) billed separately at $75/sheet for 7/16" OSB.',
      `Sales tax calculated at ${(taxRate * 100).toFixed(2)}% (state base rate); final tax adjusted at invoicing.`,
      'Price valid for 30 days due to volatile asphalt shingle commodity pricing.',
    ],
    validityDays: 30,
    warrantyYears: 25,
  };
}

/** Pull the state code out of a Google formatted_address. Falls back to "US". */
export function stateFromFormatted(formatted: string): string {
  const m = formatted.match(/,\s*([A-Z]{2})\s+\d{5}/);
  return m ? m[1] : 'US';
}
