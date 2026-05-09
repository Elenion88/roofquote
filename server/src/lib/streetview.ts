import { env } from './env.ts';
import { haversineMeters } from './geometry.ts';

export type StreetViewMeta = {
  status: 'OK' | 'ZERO_RESULTS' | 'NOT_FOUND' | 'REQUEST_DENIED' | string;
  pano_id?: string;
  location?: { lat: number; lng: number };
  date?: string;
  copyright?: string;
};

/** Compute initial bearing from (lat1,lng1) toward (lat2,lng2) in degrees [0, 360). */
export function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

/** Offset a lat/lng by (north_m, east_m) in meters. */
export function offsetLatLng(lat: number, lng: number, dnorth_m: number, deast_m: number): { lat: number; lng: number } {
  const R = 6371000;
  const lat2 = lat + (dnorth_m / R) * (180 / Math.PI);
  const lng2 = lng + (deast_m / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lat: lat2, lng: lng2 };
}

export async function getStreetViewMetadata(lat: number, lng: number, radiusM = 50): Promise<StreetViewMeta> {
  const url = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
  url.searchParams.set('location', `${lat},${lng}`);
  url.searchParams.set('radius', String(radiusM));
  url.searchParams.set('source', 'outdoor');
  url.searchParams.set('key', env.GOOGLE_PLACES_API_KEY);
  const r = await fetch(url);
  return (await r.json()) as StreetViewMeta;
}

export type StreetViewImage = {
  pngBytes: Uint8Array;
  panoId: string;
  panoLat: number;
  panoLng: number;
  heading: number;
  fov: number;
  pitch: number;
  imageryDate?: string;
  panoDistanceM: number;
};

export async function fetchStreetViewFacing(args: {
  buildingLat: number;
  buildingLng: number;
  radiusM?: number;
  fov?: number;
  cameraPitch?: number;
  size?: number;
  fromLat?: number; // override pano center (for multi-pano)
  fromLng?: number;
}): Promise<StreetViewImage | null> {
  const radiusM = args.radiusM ?? 80;
  const searchLat = args.fromLat ?? args.buildingLat;
  const searchLng = args.fromLng ?? args.buildingLng;
  const meta = await getStreetViewMetadata(searchLat, searchLng, radiusM);
  if (meta.status !== 'OK' || !meta.location || !meta.pano_id) return null;
  const panoDistance = haversineMeters(args.buildingLat, args.buildingLng, meta.location.lat, meta.location.lng);
  if (panoDistance < 4) return null;
  const heading = bearingDeg(meta.location.lat, meta.location.lng, args.buildingLat, args.buildingLng);
  const url = new URL('https://maps.googleapis.com/maps/api/streetview');
  const size = args.size ?? 640;
  url.searchParams.set('size', `${size}x${size}`);
  url.searchParams.set('location', `${meta.location.lat},${meta.location.lng}`);
  url.searchParams.set('heading', String(heading));
  url.searchParams.set('pitch', String(args.cameraPitch ?? 0));
  url.searchParams.set('fov', String(args.fov ?? 50));
  url.searchParams.set('source', 'outdoor');
  url.searchParams.set('key', env.GOOGLE_PLACES_API_KEY);
  const r = await fetch(url);
  if (!r.ok) return null;
  const ab = await r.arrayBuffer();
  return {
    pngBytes: new Uint8Array(ab),
    panoId: meta.pano_id,
    panoLat: meta.location.lat,
    panoLng: meta.location.lng,
    heading,
    fov: args.fov ?? 50,
    pitch: args.cameraPitch ?? 0,
    imageryDate: meta.date,
    panoDistanceM: panoDistance,
  };
}

/**
 * Find up to N distinct Street View panoramas around a building, by querying
 * the Metadata API at offset locations.
 *
 * Useful when one panorama angle is blocked or the building face isn't clearly
 * visible — alternate panoramas can give a better view.
 */
export async function fetchMultiplePanos(args: {
  buildingLat: number;
  buildingLng: number;
  maxPanos?: number;
}): Promise<StreetViewImage[]> {
  const maxPanos = args.maxPanos ?? 3;
  // Search points: building center + 4 cardinal offsets at ~30m
  const offsets: Array<[number, number]> = [
    [0, 0],
    [30, 0],   // 30m north
    [-30, 0],  // 30m south
    [0, 30],   // 30m east
    [0, -30],  // 30m west
    [30, 30],
    [-30, -30],
  ];
  const found: Map<string, StreetViewImage> = new Map();
  for (const [dn, de] of offsets) {
    if (found.size >= maxPanos) break;
    const pt = offsetLatLng(args.buildingLat, args.buildingLng, dn, de);
    const sv = await fetchStreetViewFacing({
      buildingLat: args.buildingLat,
      buildingLng: args.buildingLng,
      fromLat: pt.lat,
      fromLng: pt.lng,
      radiusM: 50,
    });
    if (sv && !found.has(sv.panoId)) {
      found.set(sv.panoId, sv);
    }
  }
  return [...found.values()];
}
