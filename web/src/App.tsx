import { useState } from 'react';
import { Sparkles, Printer } from 'lucide-react';
import { AddressForm } from './components/AddressForm';
import { LoadingStages } from './components/LoadingStages';
import { CalibrationCard } from './components/CalibrationCard';
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
    setRun(null);
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
        <header className="flex items-center justify-between gap-2 print:hidden">
          <div className="flex items-center gap-2 text-stone-700">
            <Sparkles className="h-5 w-5 text-emerald-600" />
            <span className="font-mono tracking-tight">RoofQuote</span>
          </div>
          {run && (
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:border-emerald-600 hover:text-emerald-700 transition"
            >
              <Printer className="h-4 w-4" /> Save as PDF
            </button>
          )}
        </header>

        {!run && (
          <>
            <h1 className="mt-8 text-4xl sm:text-5xl font-semibold tracking-tight text-stone-900 leading-tight print:hidden">
              Address in. <span className="text-emerald-700">Customer-ready estimate</span> out.
            </h1>
            <p className="mt-3 text-lg text-stone-600 max-w-2xl print:hidden">
              Open building geometry × LLM-detected roof pitch. ~30 seconds. ~5% accuracy on commercial reference data.
            </p>
            <div className="mt-10 print:hidden">
              <AddressForm onSubmit={handle} pending={pending} />
            </div>
          </>
        )}

        {run && (
          <div className="mt-6 print:mt-0">
            <h1 className="hidden print:block text-2xl font-semibold mb-2">RoofQuote — Estimate for {run.formattedAddress}</h1>
            <div className="print:hidden">
              <AddressForm onSubmit={handle} pending={pending} />
            </div>
          </div>
        )}

        {pending && (
          <div className="mt-12">
            <LoadingStages />
          </div>
        )}

        {error && (
          <div className="mt-8 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {run && !pending && (
          <div className="mt-8 space-y-6">
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

        <div className="mt-12 print:hidden"><CalibrationCard /></div>
        <footer className="mt-16 pt-8 border-t border-stone-200 text-sm text-stone-500 print:hidden">
          Built for the JobNimbus AI Hackathon 2026 ·{' '}
          <a href="https://github.com/Elenion88/roofquote" className="underline decoration-stone-300 hover:decoration-emerald-600 hover:text-emerald-700">
            github.com/Elenion88/roofquote
          </a>
        </footer>
      </div>
    </main>
  );
}
