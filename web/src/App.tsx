import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { AddressForm } from './components/AddressForm';
import { HeroResult } from './components/HeroResult';
import { MethodsCard } from './components/MethodsCard';
import { AerialCard } from './components/AerialCard';
import { EstimateCard } from './components/EstimateCard';
import { MeasurementBreakdownCard } from './components/MeasurementBreakdownCard';
import { fetchQuote } from './lib/api';
import type { QuoteRun } from './lib/types';

export default function App() {
  const [pending, setPending] = useState(false);
  const [run, setRun] = useState<QuoteRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = async (address: string) => {
    setPending(true);
    setError(null);
    try {
      const r = await fetchQuote(address);
      setRun(r);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="min-h-screen bg-stone-50">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10 sm:py-16">
        <header className="flex items-center gap-2 text-stone-700">
          <Sparkles className="h-5 w-5" />
          <span className="font-mono tracking-tight">RoofQuote</span>
        </header>

        <h1 className="mt-8 text-4xl sm:text-5xl font-semibold tracking-tight text-stone-900 leading-tight">
          Address in. Customer-ready estimate out.
        </h1>
        <p className="mt-3 text-lg text-stone-600 max-w-2xl">
          Aerial imagery, multi-zoom vision LLM analysis, ensemble consensus, and a contractor-grade quote.
          No site visit, no ladder, under thirty seconds.
        </p>

        <div className="mt-10">
          <AddressForm onSubmit={handle} pending={pending} />
        </div>

        {error && (
          <div className="mt-8 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {run && (
          <div className="mt-12 space-y-6">
            <HeroResult run={run} />
            <MethodsCard run={run} />
            <AerialCard run={run} />
            {run.estimate && (
              <>
                <MeasurementBreakdownCard estimate={run.estimate} />
                <EstimateCard estimate={run.estimate} />
              </>
            )}
          </div>
        )}

        <footer className="mt-16 pt-8 border-t border-stone-200 text-sm text-stone-500">
          Built for the JobNimbus AI Hackathon 2026 ·{' '}
          <a href="https://github.com/Elenion88/roofquote" className="underline decoration-stone-300 hover:decoration-stone-700">
            github.com/Elenion88/roofquote
          </a>
        </footer>
      </div>
    </main>
  );
}
