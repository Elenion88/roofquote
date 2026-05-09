import { geocode } from '../lib/geocode.ts';
import { fetchStaticMap } from '../lib/staticmap.ts';
import { saveArtifact, slugify } from '../lib/artifacts.ts';
import { visionDirect } from './methods/vision_direct.ts';
import { footprintMSBuildings } from './methods/footprint_msbuildings.ts';
import { lookupPolygon } from '../lib/msbuildings.ts';
import { visionPolygon } from './methods/vision_polygon.ts';
import { combineEnsemble } from './ensemble.ts';
import { generateEstimate, stateFromFormatted } from './estimate.ts';
import type { Estimate } from './estimate.ts';
import type { MethodResult, QuoteRun } from './types.ts';

const ZOOMS_FOR_CONSENSUS = [19, 20] as const;
const DEMO_MODELS = [
  // shown in UI but NOT used for consensus (per calibration: GPT-4o regresses to mean)
  { id: 'openai/gpt-4o', label: 'GPT-4o' },
] as const;

export async function runQuote(address: string, opts: { withPolygon?: boolean; withDemoModels?: boolean; withEstimate?: boolean } = {}): Promise<QuoteRun> {
  const startedAt = new Date().toISOString();
  const slug = slugify(address);

  // ─ Geocode ──────────────────────────────────────────────────────────────
  const { location, formatted, raw: geocodeRaw } = await geocode(address);
  saveArtifact(slug, 'geocode.json', geocodeRaw as object);

  // ─ Fetch tiles for consensus zooms (in parallel) ────────────────────────
  const tiles = await Promise.all(
    ZOOMS_FOR_CONSENSUS.map((zoom) =>
      fetchStaticMap({ lat: location.lat, lng: location.lng, zoom, size: 640, scale: 2 })
        .then((tile) => {
          saveArtifact(slug, `staticmap-z${zoom}.png`, Buffer.from(tile.pngBytes));
          return { zoom, tile };
        })
    )
  );

  // ─ Run vision_direct (opus, measured) at each zoom in parallel ──────────
  // Try MS Buildings primary path (deterministic footprint + vision pitch)
  const z19Tile = tiles.find((t) => t.zoom === 19)!.tile;
  const z20Tile = tiles.find((t) => t.zoom === 20)!.tile;
  const msbuildingsJob = footprintMSBuildings({
    z19PngBytes: z19Tile.pngBytes,
    z20PngBytes: z20Tile.pngBytes,
    lat: location.lat,
    lng: location.lng,
  });

  const consensusJobs = tiles.map(({ zoom, tile }) =>
    visionDirect({
      pngBytes: tile.pngBytes,
      lat: location.lat,
      lng: location.lng,
      metersPerPixel: tile.metersPerPixelGround,
      sizePx: tile.imageSize.width,
      model: 'anthropic/claude-opus-4-7',
      promptVariant: 'measured',
    }).then((r) => ({ ...r, zoom }))
  );

  // ─ Optional demo models (gpt-4o on z19) ─────────────────────────────────
  const demoJobs: Promise<MethodResult>[] = [];
  if (opts.withDemoModels) {
    const z19Tile = tiles.find((t) => t.zoom === 19)!.tile;
    for (const m of DEMO_MODELS) {
      demoJobs.push(
        visionDirect({
          pngBytes: z19Tile.pngBytes,
          lat: location.lat,
          lng: location.lng,
          metersPerPixel: z19Tile.metersPerPixelGround,
          sizePx: z19Tile.imageSize.width,
          model: m.id,
          promptVariant: 'measured',
        }).then((r) => ({ ...r, zoom: 19 }))
      );
    }
  }

  // ─ Optional polygon method (for visualization story) ────────────────────
  const polygonJobs: Promise<MethodResult>[] = [];
  if (opts.withPolygon) {
    const z20Tile = tiles.find((t) => t.zoom === 20)!.tile;
    polygonJobs.push(
      visionPolygon({
        pngBytes: z20Tile.pngBytes,
        lat: location.lat,
        lng: location.lng,
        metersPerPixel: z20Tile.metersPerPixelGround,
        sizePx: z20Tile.imageSize.width,
        model: 'anthropic/claude-opus-4-7',
      }).then((r) => ({ ...r, zoom: 20 }))
    );
  }

  const [consensus, demos, polys, ms] = await Promise.all([
    Promise.all(consensusJobs),
    Promise.all(demoJobs),
    Promise.all(polygonJobs),
    msbuildingsJob,
  ]);
  const results = [ms, ...consensus, ...demos, ...polys];

  for (const r of results) {
    saveArtifact(slug, `result-${r.method.replace(/[:/]/g, '_')}-${r.model?.replace(/[:/]/g, '_')}-z${r.zoom}.json`, r);
  }

  const ens = combineEnsemble(results);

  // ─ Generate estimate (only if we have a consensus number) ──────────────
  let estimate: Estimate | null = null;
  if (ens.consensusSqft && opts.withEstimate !== false) {
    const repForPitch = consensus.find((r) => r.pitchRatio != null) ?? consensus[0];
    const pitchRatio = repForPitch?.pitchRatio ?? 0.5;
    const pitchRise = Math.round(pitchRatio * 12);
    try {
      estimate = await generateEstimate({
        address,
        formattedAddress: formatted,
        totalSqft: ens.consensusSqft,
        footprintSqft: repForPitch?.footprintSqft ?? Math.round(ens.consensusSqft / Math.sqrt(1 + pitchRatio ** 2)),
        pitch: `${pitchRise}:12`,
        pitchRatio,
        state: stateFromFormatted(formatted),
      });
      saveArtifact(slug, 'estimate.json', estimate);
    } catch (err: any) {
      console.error('estimate failed:', err?.message);
    }
  }

  const run: QuoteRun = {
    address,
    formattedAddress: formatted,
    location,
    results,
    consensusSqft: ens.consensusSqft,
    combiner: ens.combiner,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  (run as any).estimate = estimate;
  saveArtifact(slug, 'run.json', run);
  return run as any;
}
