import { env } from './env.ts';

/** Google Static Maps URL builder + ground-meters-per-pixel calculation. */

export type StaticMapParams = {
  lat: number;
  lng: number;
  zoom: number;
  size?: number;
  scale?: 1 | 2;
  maptype?: 'satellite' | 'hybrid';
};

export type StaticMap = {
  pngBytes: Uint8Array;
  imageSize: { width: number; height: number };
  metersPerPixelGround: number; // at the requested latitude
};

/** Web Mercator: m/px = 156543.03 * cos(lat) / 2^zoom (at scale=1) */
export function metersPerPixel(lat: number, zoom: number, scale: 1 | 2 = 2): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom) / scale;
}

export async function fetchStaticMap(p: StaticMapParams): Promise<StaticMap> {
  const size = p.size ?? 640;
  const scale = p.scale ?? 2;
  const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
  url.searchParams.set('center', `${p.lat},${p.lng}`);
  url.searchParams.set('zoom', String(p.zoom));
  url.searchParams.set('size', `${size}x${size}`);
  url.searchParams.set('scale', String(scale));
  url.searchParams.set('maptype', p.maptype ?? 'satellite');
  url.searchParams.set('format', 'png');
  url.searchParams.set('key', env.GOOGLE_PLACES_API_KEY);

  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Static Maps ${r.status}: ${body.slice(0, 200)}`);
  }
  const ab = await r.arrayBuffer();
  return {
    pngBytes: new Uint8Array(ab),
    imageSize: { width: size * scale, height: size * scale },
    metersPerPixelGround: metersPerPixel(p.lat, p.zoom, scale),
  };
}
