/**
 * Geometry helpers for roof measurement.
 */

export type PixelPoint = [number, number]; // [x, y]
export type PixelPolygon = PixelPoint[];

/** Polygon area in pixel² using the shoelace formula. */
export function pixelArea(poly: PixelPolygon): number {
  if (poly.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** Convert polygon pixel area to ground square meters at the tile's center latitude. */
export function pixelAreaToGroundM2(pixelArea: number, metersPerPixel: number): number {
  return pixelArea * metersPerPixel * metersPerPixel;
}

/** Roof material multiplier from x:12 pitch ratio (rise/run). */
export function pitchMultiplier(rise: number, run: number = 12): number {
  return Math.sqrt(1 + (rise / run) ** 2);
}

/** Sqft from m². */
export const M2_TO_SQFT = 10.7639;

/** Validate a polygon — must have >=3 points, closed shape, reasonable area. */
export function isReasonablePolygon(poly: PixelPolygon, sizePx: number): boolean {
  if (poly.length < 3) return false;
  // All points within image
  for (const [x, y] of poly) {
    if (x < 0 || x > sizePx || y < 0 || y > sizePx) return false;
  }
  return true;
}
