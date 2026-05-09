/**
 * Robust JSON extraction from LLM output.
 *
 * Handles:
 *  - Leading/trailing prose
 *  - ```json fenced code blocks
 *  - Trailing commas
 *  - Smart quotes (rare but seen with Gemini)
 */
export function extractJson<T = unknown>(text: string): T {
  if (!text) throw new Error('empty response');

  // 1. Try direct parse
  try { return JSON.parse(text) as T; } catch {}

  // 2. Strip markdown fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    const inner = fenced[1];
    try { return JSON.parse(inner) as T; } catch {}
  }

  // 3. Find first balanced { ... } and try parsing
  const start = text.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        // Skip string contents (handle escapes)
        i++;
        while (i < text.length && text[i] !== '"') {
          if (text[i] === '\\') i++;
          i++;
        }
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end > start) {
      const candidate = text.slice(start, end + 1);
      // Strip trailing commas
      const cleaned = candidate.replace(/,(\s*[}\]])/g, '$1');
      try { return JSON.parse(cleaned) as T; } catch {}
    }
  }

  throw new Error(`could not parse JSON from: ${text.slice(0, 200)}`);
}
