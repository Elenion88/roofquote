import { slug } from '../lib/format';
import type { QuoteRun } from '../lib/types';

export function AerialCard({ run }: { run: QuoteRun }) {
  const s = slug(run.address);
  const usedMS = run.results.some((r) => r.method === 'footprint_msbuildings' && r.totalSqft != null);
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-medium text-stone-900">Aerial imagery</h3>
      <p className="mt-1 text-sm text-stone-600">
        {usedMS
          ? 'Top-down satellite tile with the Microsoft Buildings polygon (green) overlaid — exactly the footprint we measured.'
          : 'Top-down satellite tiles fed to the vision model — same pixels, different zooms.'}
      </p>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[19, 20].map((z) => (
          <figure key={z} className="overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
            <img
              src={usedMS ? `/api/tile/${s}/${z}/overlay` : `/api/tile/${s}/${z}`}
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
