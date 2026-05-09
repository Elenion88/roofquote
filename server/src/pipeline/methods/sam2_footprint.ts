import { cachySegment, cachyPitch } from '../../lib/cachy.ts';
import { lookupPolygon } from '../../lib/msbuildings.ts';
import { pitchMultiplier, M2_TO_SQFT, lonLatToTilePixels } from '../../lib/geometry.ts';
import { metersPerPixel } from '../../lib/staticmap.ts';
import type { MethodResult } from '../types.ts';

export type SAM2FootprintResult = MethodResult & {
  footprintSqft: number;
  buildingMaskPolygon?: number[][];
  perPlanePolygons?: number[][][];
  imageWidth?: number;
  imageHeight?: number;
  planeCoverage?: number;
  aggregation?: 'planes' | 'building';
};

/**
 * SAM 2 segmentation × Qwen2.5-VL global pitch (LOCAL on cachy-tower).
 *
 *   1. Box prompt from MS Buildings polygon → SAM 2 building mask.
 *   2. Automatic mask gen → per-plane polygons.
 *   3. effective_footprint = max of:
 *        - plane_sum (capped at building area) — when planes have ≥40% coverage
 *        - building mask                       — when plane coverage is low
 *      Per-plane segmentation natively excludes courtyards/patios because
 *      there's no roof to detect inside an open courtyard.
 *   4. Multiply by global pitch via Qwen2.5-VL on full tile.
 */
export async function sam2Footprint(args: {
  pngBytes: Uint8Array;
  lat: number;
  lng: number;
  zoom: number;
  scale: 1 | 2;
  imageSizePx: number;
}): Promise<SAM2FootprintResult> {
  const start = Date.now();
  try {
    const hit = lookupPolygon(args.lat, args.lng);
    const mpp = metersPerPixel(args.lat, args.zoom, args.scale);
    const imgPx = args.imageSizePx;

    let segOpts: Parameters<typeof cachySegment>[1] = { perPlane: true };
    if (hit && hit.polygonLonLat.length >= 3) {
      const pixelPts = lonLatToTilePixels(
        hit.polygonLonLat, args.lat, args.lng, mpp, imgPx, imgPx,
      );
      const xs = pixelPts.map((p) => p[0]);
      const ys = pixelPts.map((p) => p[1]);
      const x1 = Math.max(0, Math.min(...xs) - 8);
      const y1 = Math.max(0, Math.min(...ys) - 8);
      const x2 = Math.min(imgPx, Math.max(...xs) + 8);
      const y2 = Math.min(imgPx, Math.max(...ys) + 8);
      segOpts = { box: [x1, y1, x2, y2], perPlane: true };
    } else {
      const c = imgPx / 2;
      const off = imgPx * 0.18;
      segOpts = {
        clickPoints: [[c, c], [c - off, c], [c + off, c], [c, c - off], [c, c + off]],
        perPlane: true,
      };
    }

    const [seg, pitch] = await Promise.all([
      cachySegment(args.pngBytes, segOpts),
      cachyPitch(args.pngBytes),
    ]);

    const buildingPxArea = seg.building.area_px;
    const planePxSum = seg.planes.reduce((acc, p) => acc + p.area_px, 0);
    const planePxCapped = Math.min(planePxSum, buildingPxArea);
    const planeCoverage = buildingPxArea > 0 ? planePxCapped / buildingPxArea : 0;

    const buildingAreaM2 = buildingPxArea * mpp * mpp;
    const buildingFootprintSqft = buildingAreaM2 * M2_TO_SQFT;
    const planeAreaM2 = planePxCapped * mpp * mpp;
    const planeFootprintSqft = planeAreaM2 * M2_TO_SQFT;

    // Use plane sum (excludes courtyards) when planes have ≥40% coverage AND ≥3 planes;
    // otherwise SAM 2 missed too much and we trust the building mask instead.
    const usePlanes = planeCoverage >= 0.4 && seg.planes.length >= 3;
    const effectiveFootprintSqft = usePlanes ? planeFootprintSqft : buildingFootprintSqft;
    const aggregation: 'planes' | 'building' = usePlanes ? 'planes' : 'building';

    const pm = pitch.pitch.match(/^(\d+):12$/);
    const pitchRise = pm ? parseInt(pm[1], 10) : 6;
    const mult = pitchMultiplier(pitchRise);
    const totalSqft = Math.round(effectiveFootprintSqft * mult);

    return {
      method: 'sam2_footprint',
      model: 'sam2.1-hiera-large + qwen2.5vl:7b',
      totalSqft,
      footprintSqft: Math.round(effectiveFootprintSqft),
      pitchRatio: pitchRise / 12,
      reasoning:
        `SAM 2 (${seg.promptKind}): building mask ${buildingFootprintSqft.toFixed(0)} sqft, ` +
        `${seg.planes.length} planes summed to ${planeFootprintSqft.toFixed(0)} sqft (${(planeCoverage * 100).toFixed(0)}% of building). ` +
        `Using ${aggregation} mode → ${effectiveFootprintSqft.toFixed(0)} sqft footprint × pitch ${pitchRise}:12 (×${mult.toFixed(3)}). ` +
        `Pitch reasoning: ${pitch.reasoning}`,
      durationMs: Date.now() - start,
      buildingMaskPolygon: seg.building.polygon,
      perPlanePolygons: seg.planes.map((p) => p.polygon),
      imageWidth: seg.width,
      imageHeight: seg.height,
      planeCoverage,
      aggregation,
      raw: { seg, pitch, segOpts, mpp, planePxCapped, planePxSum, buildingPxArea },
    };
  } catch (err: any) {
    return {
      method: 'sam2_footprint',
      model: 'sam2.1-hiera-large + qwen2.5vl:7b',
      totalSqft: null,
      footprintSqft: 0,
      durationMs: Date.now() - start,
      errorMessage: String(err?.message ?? err),
    };
  }
}
