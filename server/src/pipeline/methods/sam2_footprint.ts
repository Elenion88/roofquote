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
};

/**
 * SAM 2 segmentation × Qwen2.5-VL pitch. Local on cachy-tower (no API).
 *
 * Prompt strategy (in order of preference):
 *  1. BOX prompt from MS Buildings polygon — most reliable. SAM 2 segments the
 *     building constrained by the polygon's bbox, refining away patio/courtyards.
 *  2. Multiple click points (image center + 4 cardinal mid-points) when no MS
 *     polygon is available — captures multi-section buildings better than single click.
 *  3. Single center click — last resort fallback.
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
      // Project MS polygon to pixel space and compute bbox
      const pixelPts = lonLatToTilePixels(
        hit.polygonLonLat,
        args.lat,
        args.lng,
        mpp,
        imgPx,
        imgPx,
      );
      const xs = pixelPts.map((p) => p[0]);
      const ys = pixelPts.map((p) => p[1]);
      const x1 = Math.max(0, Math.min(...xs) - 8); // small padding
      const y1 = Math.max(0, Math.min(...ys) - 8);
      const x2 = Math.min(imgPx, Math.max(...xs) + 8);
      const y2 = Math.min(imgPx, Math.max(...ys) + 8);
      segOpts = { box: [x1, y1, x2, y2], perPlane: true };
    } else {
      // No MS polygon — use multi-click strategy at image center + 4 inset points
      const c = imgPx / 2;
      const off = imgPx * 0.18; // 18% inset
      segOpts = {
        clickPoints: [
          [c, c],
          [c - off, c],
          [c + off, c],
          [c, c - off],
          [c, c + off],
        ],
        perPlane: true,
      };
    }

    const [seg, pitch] = await Promise.all([
      cachySegment(args.pngBytes, segOpts),
      cachyPitch(args.pngBytes),
    ]);

    const buildingAreaM2 = seg.building.area_px * mpp * mpp;
    const buildingFootprintSqft = buildingAreaM2 * M2_TO_SQFT;

    const pm = pitch.pitch.match(/^(\d+):12$/);
    const pitchRise = pm ? parseInt(pm[1], 10) : 6;
    const mult = pitchMultiplier(pitchRise);
    const totalSqft = Math.round(buildingFootprintSqft * mult);

    return {
      method: 'sam2_footprint',
      model: 'sam2.1-hiera-large + qwen2.5vl:7b',
      totalSqft,
      footprintSqft: Math.round(buildingFootprintSqft),
      pitchRatio: pitchRise / 12,
      reasoning:
        `SAM 2 mask via ${seg.promptKind} prompt: ${seg.building.area_px} px (${(seg.building.score * 100).toFixed(0)}% conf) ` +
        `→ ${buildingAreaM2.toFixed(0)} m² → ${buildingFootprintSqft.toFixed(0)} sqft footprint. ` +
        `Qwen2.5-VL pitch: ${pitch.pitch} (${pitch.confidence}, ${pitch.angleDegrees.toFixed(0)}°). ` +
        `${seg.planes.length} per-plane segments. ${pitch.reasoning}`,
      durationMs: Date.now() - start,
      buildingMaskPolygon: seg.building.polygon,
      perPlanePolygons: seg.planes.map((p) => p.polygon),
      imageWidth: seg.width,
      imageHeight: seg.height,
      raw: { seg, pitch, segOpts },
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
