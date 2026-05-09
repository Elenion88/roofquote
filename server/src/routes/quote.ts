import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runQuote } from '../pipeline/quote.ts';
import { renderPolygonOverlay } from '../lib/overlay.ts';
import { lookupPolygon } from '../lib/msbuildings.ts';
import { fetchStaticMap, metersPerPixel } from '../lib/staticmap.ts';
import { EVAL_RUNS_ROOT, slugify } from '../lib/artifacts.ts';

export const quoteRoute = new Hono();

quoteRoute.post('/quote', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const address = String(body.address ?? '').trim();
  if (!address) return c.json({ error: 'address required' }, 400);
  const withDemoModels = body.withDemoModels === true;
  const withPolygon = body.withPolygon === true;
  try {
    const run = await runQuote(address, { withDemoModels, withPolygon });
    return c.json(run);
  } catch (err: any) {
    return c.json({ error: String(err?.message ?? err) }, 500);
  }
});

quoteRoute.get('/quote/sample', async (c) => {
  const addr = c.req.query('address') ?? '6310 Laguna Bay Court, Houston, TX 77041';
  const run = await runQuote(addr, { withDemoModels: true });
  return c.json(run);
});

quoteRoute.get('/quote/:slug', (c) => {
  const slug = c.req.param('slug');
  const path = join(EVAL_RUNS_ROOT, slug, 'run.json');
  if (!existsSync(path)) return c.json({ error: 'not found' }, 404);
  return c.json(JSON.parse(readFileSync(path, 'utf8')));
});

quoteRoute.get('/tile/:slug/:zoom/overlay', async (c) => {
  const slug = c.req.param('slug');
  const zoom = parseInt(c.req.param('zoom'), 10);
  const path = join(EVAL_RUNS_ROOT, slug, `staticmap-z${zoom}.png`);
  const runPath = join(EVAL_RUNS_ROOT, slug, 'run.json');
  if (!existsSync(path) || !existsSync(runPath)) return c.text('not found', 404);
  const run = JSON.parse(readFileSync(runPath, 'utf8'));
  const png = readFileSync(path);
  const hit = lookupPolygon(run.location.lat, run.location.lng);
  if (!hit) {
    // No polygon — return base tile
    return c.body(new Uint8Array(png), 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
  }
  const mpp = metersPerPixel(run.location.lat, zoom, 2);
  const overlay = await renderPolygonOverlay({
    basePngBytes: new Uint8Array(png),
    centerLat: run.location.lat,
    centerLng: run.location.lng,
    metersPerPixel: mpp,
    imageWidthPx: 1280,
    imageHeightPx: 1280,
    polygonLonLat: hit.polygonLonLat,
  });
  return c.body(new Uint8Array(overlay), 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
});

quoteRoute.get('/tile/:slug/:zoom', (c) => {
  const slug = c.req.param('slug');
  const zoom = c.req.param('zoom');
  const path = join(EVAL_RUNS_ROOT, slug, `staticmap-z${zoom}.png`);
  if (!existsSync(path)) return c.text('not found', 404);
  const png = readFileSync(path);
  return c.body(new Uint8Array(png), 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
});
