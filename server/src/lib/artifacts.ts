import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const EVAL_RUNS_ROOT = join(import.meta.dirname, '../../../eval/runs');

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function saveArtifact(addressSlug: string, name: string, data: Buffer | string | object) {
  const path = join(EVAL_RUNS_ROOT, addressSlug, name);
  mkdirSync(dirname(path), { recursive: true });
  if (Buffer.isBuffer(data)) writeFileSync(path, data);
  else if (typeof data === 'string') writeFileSync(path, data, 'utf8');
  else writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  return path;
}
