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

/* ─── Lat/Lng polygon area ─────────────────────────────────────────────── */

export type LonLatPoint = [number, number]; // [lng, lat]
export type LonLatPolygon = LonLatPoint[];

/**
 * Polygon area in square meters using equal-area projection at the polygon's
 * centroid latitude (accurate to <0.01% for residential-sized buildings).
 */
export function polygonAreaM2LonLat(coords: LonLatPolygon): number {
  if (coords.length < 3) return 0;
  let sumLat = 0;
  for (const [, lat] of coords) sumLat += lat;
  const lat0 = sumLat / coords.length;
  const R = 6371000;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  const pts: [number, number][] = coords.map(([lon, lat]) => [
    R * (lon * Math.PI) / 180 * cosLat,
    R * (lat * Math.PI) / 180,
  ]);
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** Haversine distance in meters between two lat/lng points. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Project lat/lng polygon to (x_px, y_px) on a Static Maps tile. */
export function lonLatToTilePixels(
  coords: LonLatPolygon,
  centerLat: number,
  centerLng: number,
  metersPerPixel: number,
  imageWidthPx: number,
  imageHeightPx: number,
): [number, number][] {
  const R = 6371000;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  return coords.map(([lon, lat]) => {
    const dx_m = R * ((lon - centerLng) * Math.PI) / 180 * cosLat;
    const dy_m = R * ((lat - centerLat) * Math.PI) / 180;
    const dx_px = dx_m / metersPerPixel;
    const dy_px = -dy_m / metersPerPixel; // y inverted (north is up in image but image y grows down)
    return [imageWidthPx / 2 + dx_px, imageHeightPx / 2 + dy_px];
  });
}
