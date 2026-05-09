import type { QuoteRun } from './types.ts';

export async function fetchQuote(address: string, opts: { withDemoModels?: boolean } = {}): Promise<QuoteRun> {
  const r = await fetch('/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, withDemoModels: opts.withDemoModels ?? false }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Quote failed (${r.status}): ${text}`);
  }
  return r.json();
}


export type Suggestion = {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
};

export async function fetchAutocomplete(query: string): Promise<Suggestion[]> {
  if (!query || query.trim().length < 3) return [];
  const r = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`);
  if (!r.ok) return [];
  const d = (await r.json()) as { suggestions?: Suggestion[] };
  return d.suggestions ?? [];
}
