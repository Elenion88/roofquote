import { geocode } from '../lib/geocode.ts';
import { fetchStaticMap } from '../lib/staticmap.ts';
import { saveArtifact, slugify } from '../lib/artifacts.ts';
import { visionDirect } from './methods/vision_direct.ts';
import type { MethodResult, QuoteRun } from './types.ts';

export async function runQuote(address: string): Promise<QuoteRun> {
  const startedAt = new Date().toISOString();
  const slug = slugify(address);

  const { location, formatted, raw: geocodeRaw } = await geocode(address);
  saveArtifact(slug, 'geocode.json', geocodeRaw as object);

  // For v1 we use a single zoom-20 tile at scale=2 (1280x1280, ~0.075 m/px).
  const tile = await fetchStaticMap({ lat: location.lat, lng: location.lng, zoom: 20, size: 640, scale: 2 });
  saveArtifact(slug, 'staticmap-z20.png', Buffer.from(tile.pngBytes));

  const results: MethodResult[] = [];

  const r1 = await visionDirect({
    pngBytes: tile.pngBytes,
    lat: location.lat,
    lng: location.lng,
    metersPerPixel: tile.metersPerPixelGround,
    sizePx: tile.imageSize.width,
  });
  results.push(r1);
  saveArtifact(slug, `result-vision_direct.json`, r1);

  const sqfts = results.map((x) => x.totalSqft).filter((x): x is number => typeof x === 'number');
  const consensusSqft = sqfts.length ? sqfts.reduce((a, b) => a + b, 0) / sqfts.length : null;

  const run: QuoteRun = {
    address,
    formattedAddress: formatted,
    location,
    results,
    consensusSqft,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  saveArtifact(slug, 'run.json', run);
  return run;
}
