import { openrouterChat } from '../lib/openrouter.ts';
import { extractJson } from '../lib/json.ts';

export type LineItem = {
  description: string;
  quantity: number;
  unit: 'sq' | 'lf' | 'ea';     // sq = roofing square (100 sqft), lf = linear feet, ea = each
  unitCost: number;             // USD
  totalCost: number;            // USD
  category: 'tearoff' | 'underlayment' | 'shingles' | 'flashing' | 'ridge' | 'ventilation' | 'gutters' | 'labor' | 'disposal' | 'permit' | 'other';
};

export type Estimate = {
  address: string;
  generatedAt: string;
  measurement: {
    totalSqft: number;
    pitch: string;
    pitchRatio: number;
    squares: number;            // roof material area / 100
    wasteFactor: number;        // typically 1.10 for simple, 1.15 for complex
  };
  lineItems: {
    ridge: number;       // linear feet
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
  notes: string[];                // important notes for the homeowner
  validityDays: number;
  warrantyYears: number;
};

const SYSTEM = `You are a senior roofing estimator generating a customer-facing estimate. Produce realistic numbers grounded in 2025 US residential roofing market rates. Output ONLY valid JSON.`;

const USER = (params: {
  address: string;
  totalSqft: number;
  footprintSqft: number;
  pitch: string;
  pitchRatio: number;
  state: string;
}) => {
  const squares = params.totalSqft / 100;
  return `
Generate an asphalt-shingle replacement estimate (full tear-off + install) for:

Address:        ${params.address}
Roof area:      ${params.totalSqft} sqft (${squares.toFixed(1)} squares)
Footprint:      ${params.footprintSqft} sqft
Pitch:          ${params.pitch} (ratio ${params.pitchRatio.toFixed(3)})
State:          ${params.state}

GUIDANCE for quantities:
- Squares to order: roof_sqft / 100 × waste_factor (use 1.10 for simple, 1.15 for complex/cut-up roofs)
- Ridge linear footage: ~10–15% of roof perimeter for simple, more for complex
- Eaves: bottom edges of all roof planes
- Flashing: chimneys, skylights, walls — assume one chimney + one skylight unless reasoning suggests more
- Ridge vent: full ridge length

GUIDANCE for pricing (2025 USD, adjust ±15% for regional cost-of-living):
- Architectural asphalt shingles: $115–$165/sq installed (HIGH for CA/NY/MA, LOW for TX/MO/GA)
- Synthetic underlayment: $25/sq
- Ice & water shield (eaves + valleys): $80/sq covered
- Drip edge: $2.50/lf
- Ridge cap shingles: $5/lf
- Step flashing: $9/lf
- Pipe flashing: $30/each
- Tear-off + dispose: $90–$120/sq
- Ridge vent: $7/lf
- Permit + dump: $250–$500 lump sum
- Labor (if not included above): $50–$70/sq

Choose a pricingTier ('low' / 'medium' / 'high') for the region, and price line items accordingly.

Return JSON exactly matching this shape (numbers must be numbers, not strings):
{
  "measurement": {
    "totalSqft": ${params.totalSqft},
    "pitch": "${params.pitch}",
    "pitchRatio": ${params.pitchRatio},
    "squares": ${squares},
    "wasteFactor": <1.10 or 1.15>
  },
  "lineItems": {
    "ridge": <linear feet>,
    "hip": <linear feet>,
    "valleys": <linear feet>,
    "rakes": <linear feet>,
    "eaves": <linear feet>,
    "flashing": <linear feet>,
    "stepFlashing": <linear feet>
  },
  "materials": [
    {"description": "...", "quantity": <num>, "unit": "sq|lf|ea", "unitCost": <num>, "totalCost": <num>, "category": "shingles|underlayment|flashing|ridge|ventilation|other"}
  ],
  "labor": [
    {"description": "...", "quantity": <num>, "unit": "sq|lf|ea", "unitCost": <num>, "totalCost": <num>, "category": "tearoff|labor|disposal|permit"}
  ],
  "subtotal": <sum of all line totalCost>,
  "tax": <subtotal * regional sales tax>,
  "total": <subtotal + tax>,
  "region": {"city": "...", "state": "${params.state}", "pricingTier": "low|medium|high"},
  "notes": ["...", "..."],
  "validityDays": 30,
  "warrantyYears": 25
}
  `.trim();
};

export async function generateEstimate(args: {
  address: string;
  formattedAddress: string;
  totalSqft: number;
  footprintSqft: number;
  pitch: string;
  pitchRatio: number;
  state: string;
}): Promise<Estimate> {
  const r = await openrouterChat({
    model: 'anthropic/claude-opus-4-7',
    temperature: 0,
    max_tokens: 3000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: USER(args) },
    ],
  });
  const text = r.choices[0]?.message?.content ?? '';
  const json = extractJson<any>(text);
  return {
    address: args.formattedAddress,
    generatedAt: new Date().toISOString(),
    measurement: json.measurement,
    lineItems: json.lineItems,
    materials: json.materials,
    labor: json.labor,
    subtotal: json.subtotal,
    tax: json.tax,
    total: json.total,
    region: json.region,
    notes: json.notes ?? [],
    validityDays: json.validityDays ?? 30,
    warrantyYears: json.warrantyYears ?? 25,
  };
}

/** Pull the state code out of a Google formatted_address. Falls back to "US". */
export function stateFromFormatted(formatted: string): string {
  // "...City, ST 12345, USA" → ST
  const m = formatted.match(/,\s*([A-Z]{2})\s+\d{5}/);
  return m ? m[1] : 'US';
}
