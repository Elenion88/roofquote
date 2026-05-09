import { env } from './env.ts';

export type Suggestion = {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
};

export async function autocompleteAddress(input: string): Promise<Suggestion[]> {
  if (!input || input.trim().length < 3) return [];
  const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input,
      includedRegionCodes: ['us'],
      includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
    }),
  });
  if (!r.ok) return [];
  const d = (await r.json()) as any;
  const out: Suggestion[] = [];
  for (const s of d.suggestions ?? []) {
    const p = s.placePrediction;
    if (!p) continue;
    out.push({
      placeId: p.placeId,
      text: p.text?.text ?? '',
      mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
    });
  }
  return out;
}
