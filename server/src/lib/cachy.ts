const BASE = process.env.CACHY_BASE_URL ?? 'http://cachy-tower:8765';

export type SegmentPlane = {
  polygon: number[][];
  area_px: number;
  bbox: [number, number, number, number];
  score: number;
};

export type SegmentResponse = {
  width: number;
  height: number;
  building: SegmentPlane;
  planes: SegmentPlane[];
  promptKind: string;
  elapsedMs: number;
};

export async function cachySegment(pngBytes: Uint8Array, opts: {
  box?: [number, number, number, number];
  clickPoints?: number[][];
  clickX?: number;
  clickY?: number;
  perPlane?: boolean;
} = {}): Promise<SegmentResponse> {
  const imageB64 = Buffer.from(pngBytes).toString('base64');
  const r = await fetch(`${BASE}/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageB64,
      box: opts.box,
      clickPoints: opts.clickPoints,
      clickX: opts.clickX,
      clickY: opts.clickY,
      perPlane: opts.perPlane ?? true,
    }),
  });
  if (!r.ok) throw new Error(`/segment ${r.status}: ${await r.text()}`);
  return (await r.json()) as SegmentResponse;
}

export type PitchResponse = {
  pitch: string;
  angleDegrees: number;
  confidence: 'low' | 'medium' | 'high';
  reasoning: string;
  elapsedMs: number;
};

export async function cachyPitch(pngBytes: Uint8Array): Promise<PitchResponse> {
  const imageB64 = Buffer.from(pngBytes).toString('base64');
  const r = await fetch(`${BASE}/pitch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageB64 }),
  });
  if (!r.ok) throw new Error(`/pitch ${r.status}: ${await r.text()}`);
  return (await r.json()) as PitchResponse;
}

export async function cachyHealth(): Promise<{ ok: boolean; vram_used_mb?: number }> {
  const r = await fetch(`${BASE}/health`);
  return (await r.json()) as any;
}
