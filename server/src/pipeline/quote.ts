import { geocode } from '../lib/geocode.ts';
import { fetchStaticMap } from '../lib/staticmap.ts';
import { saveArtifact, slugify } from '../lib/artifacts.ts';
import { footprintMSBuildings } from './methods/footprint_msbuildings.ts';
import { sam2Footprint } from './methods/sam2_footprint.ts';
import { combineEnsemble } from './ensemble.ts';
import { generateEstimate, stateFromFormatted } from './estimate.ts';
import type { Estimate } from './estimate.ts';
import type { QuoteRun } from './types.ts';

// Production path is fully local: SAM 2 + Qwen 2.5-VL on cachy-tower, MS Buildings × Qwen pitch.
// Zero commercial LLM APIs.

export async function runQuote(address: string, opts: { withEstimate?: boolean } = {}): Promise<QuoteRun> {
  const startedAt = new Date().toISOString();
  const slug = slugify(address);

  // ─ Geocode ──────────────────────────────────────────────────────────────
  const { location, formatted, raw: geocodeRaw } = await geocode(address);
  saveArtifact(slug, 'geocode.json', geocodeRaw as object);

  // ─ Fetch tiles in parallel (z19 + z20 for MS Buildings; z21 for SAM 2) ──
  const allZooms = [19, 20, 21] as const;
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

  // ─ SAM 2 footprint (cachy-tower local) ──────────────────────────────────
  const sam2Job = sam2Footprint({
    pngBytes: z21Tile.pngBytes,
    lat: location.lat,
    lng: location.lng,
    zoom: 21,
    scale: 2,
    imageSizePx: z21Tile.imageSize.width,
  });

  // ─ MS Buildings primary path (deterministic footprint + Qwen pitch) ─────
  const msbuildingsJob = footprintMSBuildings({
    z19PngBytes: z19Tile.pngBytes,
    z20PngBytes: z20Tile.pngBytes,
    lat: location.lat,
    lng: location.lng,
  });

  const [ms, sam2] = await Promise.all([msbuildingsJob, sam2Job]);
  const results = [sam2, ms];

  for (const r of results) {
    saveArtifact(slug, `result-${r.method.replace(/[:/]/g, '_')}-${r.model?.replace(/[:/]/g, '_')}-z${r.zoom}.json`, r);
  }

  const ens = combineEnsemble(results);

  // ─ Generate estimate (deterministic local pricing) ──────────────────────
  let estimate: Estimate | null = null;
  if (ens.consensusSqft && opts.withEstimate !== false) {
    const preferred = [ms, sam2].find((r) => r && r.pitchRatio != null);
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
