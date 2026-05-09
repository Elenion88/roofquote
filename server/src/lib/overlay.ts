import sharp from 'sharp';
import { lonLatToTilePixels } from './geometry.ts';
import type { LonLatPolygon } from './geometry.ts';

export async function renderPolygonOverlay(args: {
  basePngBytes: Uint8Array;
  centerLat: number;
  centerLng: number;
  metersPerPixel: number;
  imageWidthPx: number;
  imageHeightPx: number;
  polygonLonLat: LonLatPolygon;
  strokeColor?: string;
  fillColor?: string;
}): Promise<Buffer> {
  const pts = lonLatToTilePixels(
    args.polygonLonLat,
    args.centerLat,
    args.centerLng,
    args.metersPerPixel,
    args.imageWidthPx,
    args.imageHeightPx,
  );

  const pathD =
    pts.length === 0
      ? ''
      : `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')} Z`;

  const stroke = args.strokeColor ?? '#10b981';
  const fill = args.fillColor ?? 'rgba(16, 185, 129, 0.18)';

  // SVG overlay: polygon + thin crosshair at center
  const svg = `<svg width="${args.imageWidthPx}" height="${args.imageHeightPx}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="glow"><feGaussianBlur stdDeviation="2"/></filter>
    </defs>
    <path d="${pathD}" fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round" />
    <path d="${pathD}" fill="none" stroke="white" stroke-width="1" stroke-linejoin="round" stroke-dasharray="4 3" />
    <circle cx="${args.imageWidthPx / 2}" cy="${args.imageHeightPx / 2}" r="6" fill="white" stroke="${stroke}" stroke-width="2"/>
  </svg>`;

  const composited = await sharp(Buffer.from(args.basePngBytes))
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
  return composited;
}
