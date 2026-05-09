import { Check, AlertCircle, Cpu, Eye } from 'lucide-react';
import { num } from '../lib/format';
import type { QuoteRun, MethodResult } from '../lib/types';

const MODEL_LABELS: Record<string, string> = {
  'anthropic/claude-opus-4-7': 'Claude Opus 4.7',
  'anthropic/claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'openai/gpt-4o': 'GPT-4o',
  'google/gemini-2.5-pro': 'Gemini 2.5 Pro',
};

function methodLabel(r: MethodResult & { validation?: string }): string {
  if (r.method === 'footprint_msbuildings') return 'MS Buildings × pitch';
  if (r.method.startsWith('vision_direct')) return 'Vision direct';
  if (r.method === 'vision_polygon') return 'Vision polygon';
  return r.method;
}

function methodKind(r: MethodResult): 'deterministic' | 'vision' {
  if (r.method === 'footprint_msbuildings') return 'deterministic';
  return 'vision';
}

export function MethodsCard({ run }: { run: QuoteRun }) {
  const usedMS = run.results.some(
    (r) => r.method === 'footprint_msbuildings' && (r.totalSqft as number | null) != null
  );
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <header className="flex items-baseline justify-between flex-wrap gap-2">
        <h3 className="text-lg font-medium text-stone-900">Methods used</h3>
        <span className="text-sm text-stone-500 font-mono">{run.combiner}</span>
      </header>
      <p className="mt-1 text-sm text-stone-600">
        {usedMS
          ? 'Building footprint comes from Microsoft Open Buildings (deterministic geometry). The vision model only estimates the pitch and validates the outline.'
          : 'Independent vision-LLM measurements at different satellite zooms.'}
      </p>

      <div className="mt-5 divide-y divide-stone-100">
        {run.results.map((r, i) => {
          const kind = methodKind(r);
          return (
            <div key={i} className="py-3 flex items-center gap-4">
              <div className={`flex-shrink-0 h-9 w-9 rounded-lg flex items-center justify-center ${kind === 'deterministic' ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-600'}`}>
                {kind === 'deterministic' ? <Cpu className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-stone-900">
                  {methodLabel(r)}
                  {r.zoom && <span className="text-stone-400"> · zoom {r.zoom}</span>}
                </div>
                <div className="text-sm text-stone-500">
                  {MODEL_LABELS[r.model ?? ''] ?? r.model}
                  {kind === 'deterministic' && <span className="ml-2 inline-block text-xs bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">deterministic geometry</span>}
                </div>
                {r.reasoning && <div className="mt-1 text-xs text-stone-500 italic line-clamp-2">{r.reasoning}</div>}
                {r.errorMessage && <div className="mt-1 text-xs text-amber-700">{r.errorMessage}</div>}
              </div>
              <div className="text-right tabular-nums flex-shrink-0">
                {r.totalSqft != null ? (
                  <>
                    <div className="text-xl font-semibold text-stone-900">{num(r.totalSqft)}<span className="text-sm text-stone-400 ml-1">sqft</span></div>
                    <div className="text-xs text-stone-500">{(r.durationMs / 1000).toFixed(1)}s</div>
                  </>
                ) : (
                  <div className="text-amber-600 inline-flex items-center gap-1 text-sm"><AlertCircle className="h-4 w-4" /> n/a</div>
                )}
              </div>
              {r.totalSqft != null && (
                <Check className="h-5 w-5 text-emerald-500 flex-shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
