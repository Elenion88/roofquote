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
