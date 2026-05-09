import { slug } from '../lib/format';
import type { QuoteRun } from '../lib/types';

export function AerialCard({ run }: { run: QuoteRun }) {
  const s = slug(run.address);
  const usedMS = run.results.some((r) => r.method === 'footprint_msbuildings' && r.totalSqft != null);
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-stone-900">Aerial imagery</h3>
      <p className="mt-1 text-sm text-stone-600">
        {usedMS
          ? 'The green outline is the Microsoft Open Buildings polygon we measured. The pin marks the geocoded address.'
          : 'The pin marks the geocoded address; aerial tiles fed to the vision model.'}
      </p>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[20, 21].map((z) => (
          <figure key={z} className="overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
            <img
              src={`/api/tile/${s}/${z}/overlay`}
              alt={`zoom ${z}`}
              className="block w-full h-auto"
              loading="lazy"
            />
            <figcaption className="px-3 py-2 text-xs text-stone-500">zoom {z}{usedMS ? ' · with footprint overlay' : ''}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
