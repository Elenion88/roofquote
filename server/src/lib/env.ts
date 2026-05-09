import 'node:process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Tiny .env loader (avoid extra dependency)
function loadDotenv() {
  try {
    const path = join(import.meta.dirname, '../../../.env');
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* fine — env may already be set externally */
  }
}
loadDotenv();

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

export const env = {
  GOOGLE_PLACES_API_KEY: need('GOOGLE_PLACES_API_KEY'),
  OPENROUTER_API_KEY: need('OPENROUTER_API_KEY'),
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  PORT: parseInt(process.env.PORT || '4006', 10),
};
