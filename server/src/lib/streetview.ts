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
  panoLat: number;
  panoLng: number;
  heading: number;
  fov: number;
  pitch: number;
  imageryDate?: string;
  panoDistanceM: number;
};

/**
 * Fetch a Street View image facing the building from a nearby panorama.
 *
 * Returns null if no panorama within radiusM, or if the panorama is too close
 * (<5 m) to compute a meaningful heading.
 */
export async function fetchStreetViewFacing(args: {
  buildingLat: number;
  buildingLng: number;
  radiusM?: number;
  fov?: number;
  cameraPitch?: number;
  size?: number;
}): Promise<StreetViewImage | null> {
  const radiusM = args.radiusM ?? 80;
  const meta = await getStreetViewMetadata(args.buildingLat, args.buildingLng, radiusM);
  if (meta.status !== 'OK' || !meta.location) return null;

  const panoDistance = haversineMeters(
    args.buildingLat,
    args.buildingLng,
    meta.location.lat,
    meta.location.lng,
  );
  if (panoDistance < 4) return null; // ambiguous heading

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
    panoLat: meta.location.lat,
    panoLng: meta.location.lng,
    heading,
    fov: args.fov ?? 50,
    pitch: args.cameraPitch ?? 0,
    imageryDate: meta.date,
    panoDistanceM: panoDistance,
  };
}
