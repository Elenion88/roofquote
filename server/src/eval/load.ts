import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalRecord } from './types.ts';

export function loadEvalSet(): EvalRecord[] {
  const path = join(import.meta.dirname, '../../../eval/addresses.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function bestKnownReference(r: EvalRecord): number {
  // Prefer published references when available; fall back to Solar oracle.
  if (r.refA && r.refB) return (r.refA + r.refB) / 2;
  if (r.refA) return r.refA;
  if (r.refB) return r.refB;
  if (r.solarOracle?.areaSqft) return r.solarOracle.areaSqft;
  throw new Error(`No reference for ${r.id}`);
}
