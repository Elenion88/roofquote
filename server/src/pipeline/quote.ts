import { geocode } from '../lib/geocode.ts';
import { fetchStaticMap } from '../lib/staticmap.ts';
import { saveArtifact, slugify } from '../lib/artifacts.ts';
import { visionDirect } from './methods/vision_direct.ts';
import { footprintMSBuildings } from './methods/footprint_msbuildings.ts';
import { sam2Footprint } from './methods/sam2_footprint.ts';
import { visionPolygon } from './methods/vision_polygon.ts';
import { combineEnsemble } from './ensemble.ts';
import { generateEstimate, stateFromFormatted } from './estimate.ts';
import type { Estimate } from './estimate.ts';
import type { MethodResult, QuoteRun } from './types.ts';

const ZOOMS_FOR_CONSENSUS = [19, 20] as const;
const ZOOMS_FOR_DISPLAY = [21] as const;
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

  // ─ Fetch all tiles in parallel (z19 + z20 for consensus, z21 for SAM 2 / display)
  const allZooms = [...ZOOMS_FOR_CONSENSUS, ...ZOOMS_FOR_DISPLAY] as const;
  const tiles = await Promise.all(
    allZooms.map((zoom) =>
      fetchStaticMap({ lat: location.lat, lng: location.lng, zoom, size: 640, scale: 2 })
        .then((tile) => {
          saveArtifact(slug, `staticmap-z${zoom}.png`, Buffer.from(tile.pngBytes));
          return { zoom, tile };
        })
    )
  );
  const z19Tile = tiles.find((t) => t.zoom === 19)!.tile;
  const z20Tile = tiles.find((t) => t.zoom === 20)!.tile;
  const z21Tile = tiles.find((t) => t.zoom === 21)!.tile;

  const sam2Job = sam2Footprint({
    pngBytes: z21Tile.pngBytes,
    lat: location.lat,
    lng: location.lng,
    zoom: 21,
    scale: 2,
    imageSizePx: z21Tile.imageSize.width,
  });

  // ─ Run vision_direct (opus, measured) at each zoom in parallel ──────────
  // Try MS Buildings primary path (deterministic footprint + Qwen pitch)
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

  const [consensus, demos, polys, ms, sam2] = await Promise.all([
    Promise.all(consensusJobs),
    Promise.all(demoJobs),
    Promise.all(polygonJobs),
    msbuildingsJob,
    sam2Job,
  ]);
  const results = [sam2, ms, ...consensus, ...demos, ...polys];

  for (const r of results) {
    saveArtifact(slug, `result-${r.method.replace(/[:/]/g, '_')}-${r.model?.replace(/[:/]/g, '_')}-z${r.zoom}.json`, r);
  }

  const ens = combineEnsemble(results);

  // ─ Generate estimate (only if we have a consensus number) ──────────────
  // Use the pitch from whichever method actually produced the consensus number
  // — keeps the line-item math consistent with the headline sqft.
  let estimate: Estimate | null = null;
  if (ens.consensusSqft && opts.withEstimate !== false) {
    const preferred = [ms, sam2, ...consensus].find(
      (r) => r && r.pitchRatio != null,
    );
    const pitchRatio = preferred?.pitchRatio ?? 0.5;
    const pitchRise = Math.round(pitchRatio * 12);
    const footprintSqft =
      preferred?.footprintSqft ??
      Math.round(ens.consensusSqft / Math.sqrt(1 + pitchRatio ** 2));
    try {
      estimate = await generateEstimate({
        address,
        formattedAddress: formatted,
        totalSqft: ens.consensusSqft,
        footprintSqft,
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
    estimate,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  saveArtifact(slug, 'run.json', run);
  return run;
}
