import { env } from './env.ts';

export type LatLng = { lat: number; lng: number };

export async function geocode(address: string): Promise<{
  location: LatLng;
  formatted: string;
  raw: unknown;
}> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', env.GOOGLE_PLACES_API_KEY);
  const r = await fetch(url);
  const d = (await r.json()) as any;
  if (d.status !== 'OK' || !d.results?.length) {
    throw new Error(`Geocode failed for "${address}": ${d.status} ${d.error_message ?? ''}`);
  }
  const top = d.results[0];
  return { location: top.geometry.location, formatted: top.formatted_address, raw: d };
}
