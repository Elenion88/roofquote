import { Check, AlertCircle } from 'lucide-react';
import { num } from '../lib/format';
import type { QuoteRun, MethodResult } from '../lib/types';

const MODEL_LABELS: Record<string, string> = {
  'anthropic/claude-opus-4-7': 'Claude Opus 4.7',
  'anthropic/claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'openai/gpt-4o': 'GPT-4o',
  'google/gemini-2.5-pro': 'Gemini 2.5 Pro',
};

function methodLabel(r: MethodResult): string {
  if (r.method.startsWith('vision_direct')) return 'Vision direct';
  if (r.method === 'vision_polygon') return 'Vision polygon';
  return r.method;
}

export function MethodsCard({ run }: { run: QuoteRun }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <header className="flex items-baseline justify-between">
        <h3 className="text-lg font-medium text-stone-900">Independent measurements</h3>
        <span className="text-sm text-stone-500">{run.combiner ?? 'consensus'}</span>
      </header>
      <p className="mt-1 text-sm text-stone-600">Each row is an independent vision-LLM run on a different satellite tile zoom. Consensus = median.</p>

      <div className="mt-5 divide-y divide-stone-100">
        {run.results.map((r, i) => (
          <div key={i} className="py-3 flex items-center gap-4">
            <div className="flex-1">
              <div className="font-medium text-stone-900">
                {methodLabel(r)} <span className="text-stone-400">·</span> <span className="text-stone-600">zoom {r.zoom}</span>
              </div>
              <div className="text-sm text-stone-500">{MODEL_LABELS[r.model ?? ''] ?? r.model}</div>
              {r.reasoning && <div className="mt-1 text-xs text-stone-500 italic line-clamp-2">{r.reasoning}</div>}
            </div>
            <div className="text-right tabular-nums">
              {r.totalSqft != null ? (
                <>
                  <div className="text-xl font-semibold text-stone-900">{num(r.totalSqft)}<span className="text-sm text-stone-400 ml-1">sqft</span></div>
                  <div className="text-xs text-stone-500">{(r.durationMs / 1000).toFixed(1)}s</div>
                </>
              ) : (
                <div className="text-amber-600 inline-flex items-center gap-1 text-sm"><AlertCircle className="h-4 w-4" /> err</div>
              )}
            </div>
            {r.totalSqft != null && (
              <Check className="h-5 w-5 text-emerald-500" />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
