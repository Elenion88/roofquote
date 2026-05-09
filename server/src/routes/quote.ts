import { Hono } from 'hono';
import { runQuote } from '../pipeline/quote.ts';

export const quoteRoute = new Hono();

quoteRoute.post('/quote', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const address = (body.address ?? '').trim();
  if (!address) return c.json({ error: 'address required' }, 400);
  try {
    const run = await runQuote(address);
    return c.json(run);
  } catch (err: any) {
    return c.json({ error: String(err?.message ?? err) }, 500);
  }
});

quoteRoute.get('/quote/sample', async (c) => {
  const addr = c.req.query('address') ?? '6310 Laguna Bay Court, Houston, TX 77041';
  const run = await runQuote(addr);
  return c.json(run);
});
