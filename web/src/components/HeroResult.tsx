import { Home, Layers } from 'lucide-react';
import { num, usd } from '../lib/format';
import type { QuoteRun } from '../lib/types';

export function HeroResult({ run }: { run: QuoteRun }) {
  const e = run.estimate;
  return (
    <section className="rounded-3xl bg-gradient-to-br from-stone-900 via-stone-800 to-stone-700 p-8 sm:p-10 text-stone-100 shadow-xl">
      <div className="text-sm uppercase tracking-widest text-stone-300/80">Estimate ready</div>
      <h2 className="mt-1 text-2xl sm:text-3xl font-medium leading-tight">{run.formattedAddress}</h2>

      <div className="mt-8 grid sm:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center gap-2 text-stone-300/80 text-sm">
            <Home className="h-4 w-4" /> Roof material area
          </div>
          <div className="mt-1 text-5xl font-semibold tabular-nums">{num(run.consensusSqft ?? 0)}<span className="text-2xl text-stone-300/70 ml-1">sqft</span></div>
          {e && <div className="mt-1 text-stone-300 text-sm">≈ {e.measurement.squares.toFixed(1)} squares · {e.measurement.pitch} pitch</div>}
        </div>
        {e && (
          <div className="sm:text-right">
            <div className="flex items-center sm:justify-end gap-2 text-stone-300/80 text-sm">
              <Layers className="h-4 w-4" /> Total project cost
            </div>
            <div className="mt-1 text-5xl font-semibold tabular-nums">{usd(e.total)}</div>
            <div className="mt-1 text-stone-300 text-sm">{e.region.city}, {e.region.state} · {e.region.pricingTier} tier · valid {e.validityDays} days</div>
          </div>
        )}
      </div>
    </section>
  );
}
