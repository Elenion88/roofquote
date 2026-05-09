import sharp from 'sharp';
import { lonLatToTilePixels } from './geometry.ts';
import type { LonLatPolygon } from './geometry.ts';

const PLANE_COLORS = [
  '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#f59e0b', '#84cc16', '#14b8a6', '#a855f7', '#f43f5e',
];

export async function renderPolygonOverlay(args: {
  basePngBytes: Uint8Array;
  centerLat: number;
  centerLng: number;
  metersPerPixel: number;
  imageWidthPx: number;
  imageHeightPx: number;
  polygonLonLat?: LonLatPolygon;             // MS Buildings polygon (lat/lng)
  sam2BuildingPixels?: number[][];           // SAM 2 building mask polygon in pixel coords
  sam2PlanePixels?: number[][][];            // SAM 2 per-plane polygons in pixel coords
  showMSPolygon?: boolean;                   // default true if polygonLonLat present
  strokeColor?: string;
  fillColor?: string;
}): Promise<Buffer> {
  const stroke = args.strokeColor ?? '#10b981';
  const fill = args.fillColor ?? 'rgba(16, 185, 129, 0.18)';

  const layers: string[] = [];

  // Layer 0: per-plane masks (rendered first, behind everything)
  if (args.sam2PlanePixels && args.sam2PlanePixels.length > 0) {
    args.sam2PlanePixels.forEach((poly, i) => {
      if (poly.length < 3) return;
      const d = `M${poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')} Z`;
      const c = PLANE_COLORS[i % PLANE_COLORS.length];
      layers.push(`<path d="${d}" fill="${c}33" stroke="${c}" stroke-width="1.5" stroke-opacity="0.8" stroke-linejoin="round" />`);
    });
  }

  // Layer 1: MS Buildings polygon (lat/lng) — drawn in muted gray as "input"
  if (args.polygonLonLat && args.polygonLonLat.length >= 3 && (args.showMSPolygon ?? true)) {
    const pts = lonLatToTilePixels(
      args.polygonLonLat,
      args.centerLat,
      args.centerLng,
      args.metersPerPixel,
      args.imageWidthPx,
      args.imageHeightPx,
    );
    const d = `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')} Z`;
    layers.push(`<path d="${d}" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="6 4" stroke-linejoin="round" />`);
  }

  // Layer 2: SAM 2 building mask (pixel coords) — primary outline
  if (args.sam2BuildingPixels && args.sam2BuildingPixels.length >= 3) {
    const d = `M${args.sam2BuildingPixels.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')} Z`;
    layers.push(`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round" />`);
    layers.push(`<path d="${d}" fill="none" stroke="white" stroke-width="1" stroke-linejoin="round" stroke-dasharray="4 3" />`);
  }

  // Layer 3: center pin
  const cx = args.imageWidthPx / 2;
  const cy = args.imageHeightPx / 2;
  layers.push(`<circle cx="${cx}" cy="${cy}" r="14" fill="rgba(16,185,129,0.18)" stroke="${stroke}" stroke-width="2"/>`);
  layers.push(`<circle cx="${cx}" cy="${cy}" r="5" fill="white" stroke="${stroke}" stroke-width="2"/>`);

  const svg = `<svg width="${args.imageWidthPx}" height="${args.imageHeightPx}" xmlns="http://www.w3.org/2000/svg">${layers.join('')}</svg>`;

  const composited = await sharp(Buffer.from(args.basePngBytes))
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
  return composited;
}
