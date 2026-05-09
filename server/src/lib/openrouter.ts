import { env } from './env.ts';

/** Minimal OpenRouter chat client w/ vision support and structured JSON output. */

export type ChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'user'; content: Array<TextPart | ImagePart> };

export type TextPart = { type: 'text'; text: string };
export type ImagePart = { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' } | { type: 'json_schema'; json_schema: any };
  /** Optional fallback chain of model IDs */
  models?: string[];
};

export type ChatResponse = {
  id: string;
  model: string;
  choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export async function openrouterChat(req: ChatRequest): Promise<ChatResponse> {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://roofquote.kokomo.quest',
      'X-Title': 'RoofQuote (JobNimbus Hackathon 2026)',
    },
    body: JSON.stringify(req),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`OpenRouter ${r.status}: ${body.slice(0, 400)}`);
  }
  return (await r.json()) as ChatResponse;
}

export function pngToDataUrl(bytes: Uint8Array): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return `data:image/png;base64,${b64}`;
}


export function jpegToDataUrl(bytes: Uint8Array): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return `data:image/jpeg;base64,${b64}`;
}
