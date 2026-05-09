import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = parseInt(process.env.PORT || '4006', 10);
const WEB_DIST = join(import.meta.dirname, '../../web/dist');

const app = new Hono();

app.use('*', logger());
app.use(
  '/api/*',
  cors({
    origin: ['https://roofquote.kokomo.quest', 'http://localhost:5176'],
    credentials: true,
  })
);

app.get('/api/health', (c) =>
  c.json({ ok: true, app: 'roofquote', time: new Date().toISOString() })
);

if (existsSync(WEB_DIST)) {
  app.use('/*', serveStatic({ root: WEB_DIST }));
  app.get('*', serveStatic({ path: join(WEB_DIST, 'index.html') }));
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`🏠  RoofQuote running on http://localhost:${info.port}`);
});
