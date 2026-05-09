import { fetchStaticMap } from '../lib/staticmap.ts';
import { visionDirect } from '../pipeline/methods/vision_direct.ts';

const lat = 36.9845554, lng = -76.4016532;

async function run(zoom: number) {
  const tile = await fetchStaticMap({ lat, lng, zoom, size: 640, scale: 2 });
  const r = await visionDirect({
    pngBytes: tile.pngBytes, lat, lng,
    metersPerPixel: tile.metersPerPixelGround,
    sizePx: tile.imageSize.width,
    promptVariant: 'measured',
  });
  console.log(`zoom ${zoom}  sqft=${r.totalSqft}  footprint=${r.footprintSqft}  pitch=${r.pitchRatio}`);
  console.log(`  reasoning: ${r.reasoning}`);
}

for (const z of [17, 18, 19, 20]) await run(z);
