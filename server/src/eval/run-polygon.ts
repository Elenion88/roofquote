import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { loadEvalSet, bestKnownReference } from './load.ts';
import { fetchStaticMap, metersPerPixel } from '../lib/staticmap.ts';
import { visionPolygon } from '../pipeline/methods/vision_polygon.ts';
import { saveArtifact } from '../lib/artifacts.ts';
import type { VariantResult } from './types.ts';

const VARIANTS = [
  { id: 'polygon-opus-z19',  model: 'anthropic/claude-opus-4-7',     zoom: 19 },
  { id: 'polygon-opus-z20',  model: 'anthropic/claude-opus-4-7',     zoom: 20 },
  { id: 'polygon-sonnet-z19', model: 'anthropic/claude-sonnet-4-6',  zoom: 19 },
  { id: 'polygon-gemini-z19', model: 'google/gemini-2.5-pro',        zoom: 19 },
];

const TILE_CACHE = '/home/kokomo/dev/roofquote/eval/tile-cache';
mkdirSync(TILE_CACHE, { recursive: true });

async function getTileCached(rec: { id: string; lat: number; lng: number }, zoom: number) {
  const path = join(TILE_CACHE, `${rec.id}-z${zoom}.png`);
  if (existsSync(path)) {
    return { pngBytes: new Uint8Array(readFileSync(path)), metersPerPixel: metersPerPixel(rec.lat, zoom, 2), sizePx: 1280 };
  }
  const tile = await fetchStaticMap({ lat: rec.lat, lng: rec.lng, zoom, size: 640, scale: 2 });
  writeFileSync(path, Buffer.from(tile.pngBytes));
  return { pngBytes: tile.pngBytes, metersPerPixel: tile.metersPerPixelGround, sizePx: tile.imageSize.width };
}

async function main() {
  const wanted = process.argv.slice(2);
  const variants = wanted.length ? VARIANTS.filter((v) => wanted.includes(v.id)) : VARIANTS;
  const records = loadEvalSet();
  console.error(`Polygon eval: ${records.length} addresses × ${variants.length} variants`);

  const limit = pLimit(4);
  const allResults: VariantResult[] = [];

  for (const v of variants) {
    console.error(`\n── ${v.id} ──`);
    const tasks = records.map((rec) =>
      limit(async () => {
        const ref = bestKnownReference(rec);
        const tile = await getTileCached(rec, v.zoom);
        const r = await visionPolygon({
          ...tile,
          lat: rec.lat,
          lng: rec.lng,
          model: v.model,
        });
        const out: VariantResult = {
          variantId: v.id,
          recordId: rec.id,
          totalSqft: r.totalSqft,
          oracleSqft: ref,
          pctErrorVsOracle:
            r.totalSqft != null ? ((r.totalSqft - ref) / ref) * 100 : null,
          pitchRatio: r.pitchRatio ?? null,
          durationMs: r.durationMs,
          errorMessage: r.errorMessage,
        };
        saveArtifact(rec.id, `vision_polygon--${v.id}.json`, r);
        const tag = r.totalSqft != null
          ? `${r.totalSqft.toString().padStart(5)}sqft  ${out.pctErrorVsOracle!.toFixed(1).padStart(7)}%  fp=${(r as any).footprintSqft}`
          : `ERR ${r.errorMessage?.slice(0, 70)}`;
        console.error(`  ${rec.id.padEnd(26)} ref=${ref.toFixed(0).padStart(5)}  ${tag}`);
        return out;
      })
    );
    const results = await Promise.all(tasks);
    allResults.push(...results);

    const errs = results.filter((x) => x.pctErrorVsOracle != null).map((x) => x.pctErrorVsOracle!);
    if (errs.length) {
      const mape = errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length;
      const me = errs.reduce((a, b) => a + b, 0) / errs.length;
      console.error(`  ${v.id} summary: n=${errs.length}/${results.length}  mape=${mape.toFixed(1)}%  bias=${me.toFixed(1)}%`);
    }
  }

  writeFileSync(
    '/home/kokomo/dev/roofquote/eval/method2-variants.json',
    JSON.stringify(allResults, null, 2)
  );

  console.log('\n=== Method 2 (polygon) variant summary ===');
  console.log(`${'variant'.padEnd(28)}  ${'n'.padStart(3)}  ${'MAPE'.padStart(6)}  ${'bias'.padStart(6)}`);
  for (const v of variants) {
    const errs = allResults.filter((x) => x.variantId === v.id && x.pctErrorVsOracle != null).map((x) => x.pctErrorVsOracle!);
    if (!errs.length) { console.log(`${v.id.padEnd(28)}  -- no results`); continue; }
    const mape = errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length;
    const bias = errs.reduce((a, b) => a + b, 0) / errs.length;
    console.log(`${v.id.padEnd(28)}  ${errs.length.toString().padStart(3)}  ${mape.toFixed(1).padStart(5)}%  ${bias > 0 ? '+' : ''}${bias.toFixed(1)}%`);
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
