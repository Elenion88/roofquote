/**
 * Run vision_direct variants across the eval set.
 *
 * Usage: tsx src/eval/run-variants.ts [variantId...]
 *   Default: runs all variants.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { loadEvalSet, bestKnownReference } from './load.ts';
import { fetchStaticMap } from '../lib/staticmap.ts';
import { visionDirect } from '../pipeline/methods/vision_direct.ts';
import { saveArtifact } from '../lib/artifacts.ts';
import type { VariantResult } from './types.ts';

type Variant = {
  id: string;
  model: string;
  zoom: number;
  promptVariant: 'default' | 'careful' | 'measured';
};

const VARIANTS: Variant[] = [
  // Already-good baseline
  { id: "opus-z19-measured",   model: "anthropic/claude-opus-4-7",     zoom: 19, promptVariant: "measured" },
  // Multi-zoom variants
  { id: "opus-z18-measured",   model: "anthropic/claude-opus-4-7",     zoom: 18, promptVariant: "measured" },
  { id: "opus-z20-measured",   model: "anthropic/claude-opus-4-7",     zoom: 20, promptVariant: "measured" },
  { id: "opus-z21-measured",   model: "anthropic/claude-opus-4-7",     zoom: 21, promptVariant: "measured" },
  // Multi-model at z19
  { id: "gpt4o-z19-measured",  model: "openai/gpt-4o",                zoom: 19, promptVariant: "measured" },
  { id: "gemini-z19-measured", model: "google/gemini-2.5-pro",        zoom: 19, promptVariant: "measured" },
  { id: "sonnet-z19-measured", model: "anthropic/claude-sonnet-4-6",  zoom: 19, promptVariant: "measured" },
];

const TILE_CACHE = '/home/kokomo/dev/roofquote/eval/tile-cache';
mkdirSync(TILE_CACHE, { recursive: true });

async function getTileCached(rec: { id: string; lat: number; lng: number }, zoom: number) {
  const path = join(TILE_CACHE, `${rec.id}-z${zoom}.png`);
  if (existsSync(path)) {
    // recompute scale info
    const { metersPerPixel } = await import('../lib/staticmap.ts');
    const mpp = metersPerPixel(rec.lat, zoom, 2);
    return { pngBytes: new Uint8Array(readFileSync(path)), metersPerPixel: mpp, sizePx: 1280 };
  }
  const tile = await fetchStaticMap({ lat: rec.lat, lng: rec.lng, zoom, size: 640, scale: 2 });
  writeFileSync(path, Buffer.from(tile.pngBytes));
  return { pngBytes: tile.pngBytes, metersPerPixel: tile.metersPerPixelGround, sizePx: tile.imageSize.width };
}

async function main() {
  const wantedIds = process.argv.slice(2);
  const variants = wantedIds.length ? VARIANTS.filter((v) => wantedIds.includes(v.id)) : VARIANTS;
  const records = loadEvalSet();
  console.error(`Eval: ${records.length} addresses × ${variants.length} variants = ${records.length * variants.length} calls`);

  const limit = pLimit(4);
  const allResults: VariantResult[] = [];

  for (const v of variants) {
    console.error(`\n── variant ${v.id} ──`);
    const tasks = records.map((rec) =>
      limit(async () => {
        const oracleSqft = rec.solarOracle?.areaSqft;
        const ref = bestKnownReference(rec);
        if (!oracleSqft) return null;
        const tile = await getTileCached(rec, v.zoom);
        const r = await visionDirect({
          ...tile,
          lat: rec.lat,
          lng: rec.lng,
          model: v.model,
          promptVariant: v.promptVariant,
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
        // save raw result
        saveArtifact(rec.id, `vision_direct--${v.id}.json`, r);
        const tag = r.totalSqft != null
          ? `${r.totalSqft.toString().padStart(5)}sqft  ${out.pctErrorVsOracle!.toFixed(1).padStart(7)}%`
          : `ERR ${r.errorMessage?.slice(0, 60)}`;
        console.error(`  ${rec.id.padEnd(26)} ref=${ref.toFixed(0).padStart(5)}  ${tag}`);
        return out;
      })
    );
    const variantResults = (await Promise.all(tasks)).filter((x): x is VariantResult => !!x);
    allResults.push(...variantResults);

    // Print variant summary
    const errs = variantResults.filter((x) => x.pctErrorVsOracle != null).map((x) => x.pctErrorVsOracle!);
    if (errs.length) {
      const mape = errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length;
      const me = errs.reduce((a, b) => a + b, 0) / errs.length;
      console.error(`  ${v.id} summary: n=${errs.length}  mape=${mape.toFixed(1)}%  bias=${me.toFixed(1)}%`);
    }
  }

  // Save all results
  writeFileSync(
    join('/home/kokomo/dev/roofquote/eval/method1-variants.json'),
    JSON.stringify(allResults, null, 2)
  );
  console.error(`\nSaved ${allResults.length} results to eval/method1-variants.json`);

  // Print summary table
  console.log('\n=== Method 1 variant summary (lower MAPE = better) ===');
  console.log(`${'variant'.padEnd(28)}  ${'n'.padStart(3)}  ${'MAPE'.padStart(6)}  ${'bias'.padStart(6)}`);
  for (const v of variants) {
    const errs = allResults.filter((x) => x.variantId === v.id && x.pctErrorVsOracle != null).map((x) => x.pctErrorVsOracle!);
    if (!errs.length) {
      console.log(`${v.id.padEnd(28)}  -- no results`);
      continue;
    }
    const mape = errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length;
    const bias = errs.reduce((a, b) => a + b, 0) / errs.length;
    console.log(`${v.id.padEnd(28)}  ${errs.length.toString().padStart(3)}  ${mape.toFixed(1).padStart(5)}%  ${bias > 0 ? '+' : ''}${bias.toFixed(1)}%`);
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
