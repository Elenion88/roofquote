import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

type Stage = { label: string; durationMs: number };
const STAGES: Stage[] = [
  { label: 'Locating address', durationMs: 1500 },
  { label: 'Pulling aerial imagery', durationMs: 1500 },
  { label: 'Analyzing roof at zoom 19', durationMs: 9000 },
  { label: 'Analyzing roof at zoom 20', durationMs: 9000 },
  { label: 'Generating estimate', durationMs: 9000 },
];

export function LoadingStages() {
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    let i = 0;
    let alive = true;
    function step() {
      if (!alive) return;
      if (i >= STAGES.length - 1) return;
      setTimeout(() => {
        if (!alive) return;
        i += 1;
        setActiveIdx(i);
        step();
      }, STAGES[i].durationMs);
    }
    step();
    return () => { alive = false; };
  }, []);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3 text-stone-700">
        <Loader2 className="h-5 w-5 animate-spin text-stone-700" />
        <h3 className="font-medium">Generating estimate…</h3>
      </div>
      <ol className="mt-5 space-y-2.5">
        {STAGES.map((s, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          return (
            <li key={s.label} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full ${
                  done ? 'bg-emerald-100 text-emerald-700' : active ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-400'
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="block h-1.5 w-1.5 rounded-full bg-current" />}
              </span>
              <span className={done ? 'text-stone-500 line-through decoration-stone-300' : active ? 'text-stone-900 font-medium' : 'text-stone-400'}>
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-5 text-xs text-stone-500">
        We run vision-LLM measurements at two satellite zooms in parallel, take the median, then generate a contractor-grade estimate. Typical wall-clock: 18–28 seconds.
      </p>
    </div>
  );
}
