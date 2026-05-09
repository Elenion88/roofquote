import { num } from '../lib/format';
import type { Estimate } from '../lib/types';

const LABELS: { key: keyof Estimate['lineItems']; label: string }[] = [
  { key: 'ridge', label: 'Ridge' },
  { key: 'hip', label: 'Hip' },
  { key: 'valleys', label: 'Valleys' },
  { key: 'rakes', label: 'Rakes' },
  { key: 'eaves', label: 'Eaves' },
  { key: 'flashing', label: 'Flashing' },
  { key: 'stepFlashing', label: 'Step Flashing' },
];

export function MeasurementBreakdownCard({ estimate }: { estimate: Estimate }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-medium text-stone-900">Measurement breakdown</h3>
      <p className="mt-1 text-sm text-stone-600">Linear feet by element, derived from the vision-LLM analysis.</p>
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
        {LABELS.map(({ key, label }) => {
          const v = estimate.lineItems[key] ?? 0;
          return (
            <div key={key} className="rounded-xl bg-stone-50 px-3 py-3">
              <div className="text-xs uppercase tracking-wider text-stone-500">{label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-stone-900">{num(v)}<span className="text-sm text-stone-400 ml-1">lf</span></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
