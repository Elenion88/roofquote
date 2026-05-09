/**
 * Microsoft Buildings polygon lookup.
 *
 * Input:  lat/lng of an address.
 * Output: building polygon (in lat/lng coords) for the closest residential building,
 *         or null if not found in our pre-extracted dataset.
 *
 * Currently uses a JSON file produced by scripts/extract_polygons.py covering
 * the 29 eval addresses + their neighbors. For arbitrary addresses, the
 * pipeline falls back to vision-based methods.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { haversineMeters, polygonAreaM2LonLat } from './geometry.ts';
import type { LonLatPolygon } from './geometry.ts';

type Record = {
  id: string;
  address: string;
  lat: number;
  lng: number;
  kind: string;
  msbuildings: {
    centroidDist_m: number;
    footprint_m2: number;
    footprint_sqft: number;
    polygon_lonlat: LonLatPolygon;
    n_candidates: number;
  } | null;
};

// Resolve relative to the server source — works from any clone.
// process.env.MSBUILDINGS_POLY_PATH wins if set (e.g. for non-standard layouts).
const POLY_PATH =
  process.env.MSBUILDINGS_POLY_PATH ??
  join(import.meta.dirname, '../../../data/msbuildings/extracted/polygons.json');

let _records: Record[] | null = null;
function load(): Record[] {
  if (_records) return _records;
  if (!existsSync(POLY_PATH)) {
    console.error(`[msbuildings] no polygons.json yet at ${POLY_PATH}`);
    _records = [];
    return _records;
  }
  _records = JSON.parse(readFileSync(POLY_PATH, 'utf8'));
  console.error(`[msbuildings] loaded ${_records!.length} records, ${_records!.filter((r) => r.msbuildings).length} with polygons`);
  return _records!;
}

export type MSBuildingsHit = {
  source: 'msbuildings';
  polygonLonLat: LonLatPolygon;
  footprintM2: number;
  footprintSqft: number;
  centroidDistM: number;
  matchedAddress: string;
};

/** Look up a polygon for an address. Returns null if not in our dataset or too far. */
export function lookupPolygon(lat: number, lng: number, maxDistM = 80): MSBuildingsHit | null {
  const recs = load();
  // Find the closest record by haversine to its address coords
  let best: { dist: number; rec: Record } | null = null;
  for (const r of recs) {
    if (!r.msbuildings) continue;
    const d = haversineMeters(lat, lng, r.lat, r.lng);
    if (d <= maxDistM && (!best || d < best.dist)) best = { dist: d, rec: r };
  }
  if (!best) return null;
  const m = best.rec.msbuildings!;
  return {
    source: 'msbuildings',
    polygonLonLat: m.polygon_lonlat,
    footprintM2: m.footprint_m2,
    footprintSqft: m.footprint_sqft,
    centroidDistM: m.centroidDist_m,
    matchedAddress: best.rec.address,
  };
}
