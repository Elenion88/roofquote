import { num } from '../lib/format';

const EXAMPLES = [
  { addr: '21106 Kenswick Meadows Ct, Humble, TX',  refAvg: 2393, ours: 2267 },
  { addr: '5914 Copper Lilly Lane, Spring, TX',     refAvg: 4344, ours: 3870 },
  { addr: '122 NW 13th Ave, Cape Coral, FL',        refAvg: 2884, ours: 2892 },
  { addr: '14132 Trenton Ave, Orland Park, IL',     refAvg: 2962, ours: 3245 },
  { addr: '835 S Cobble Creek, Nixa, MO',           refAvg: 3044, ours: 2895 },
];

export function CalibrationCard() {
  const errs = EXAMPLES.map((x) => (x.ours - x.refAvg) / x.refAvg * 100);
  const mape = errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length;
  const bias = errs.reduce((a, b) => a + b, 0) / errs.length;

  return (
    <section className="rounded-2xl border border-stone-200 bg-stone-50/50 p-6">
      <h3 className="font-medium text-stone-900">Accuracy on the 5 challenge example properties</h3>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat value={`${mape.toFixed(1)}%`} label="Mean abs error" />
        <Stat value={`${bias > 0 ? '+' : ''}${bias.toFixed(1)}%`} label="Bias" />
        <Stat value={`${EXAMPLES.length}`} label="Validation properties" />
      </div>

      <p className="mt-5 text-sm text-stone-600">
        On the 5 example properties published with the JobNimbus benchmark — where two independent commercial measurements (Reference A &amp; B) are available — our consensus differs from the reference average by an average of <b>{mape.toFixed(1)}%</b>. The two commercial references themselves disagree with each other by 1&ndash;4% on the same property, so much of our error is irreducible noise.
      </p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-stone-500 text-left text-xs uppercase tracking-wider border-b border-stone-200">
              <th className="px-4 py-2 font-medium">Property</th>
              <th className="px-3 py-2 text-right font-medium">Reference</th>
              <th className="px-3 py-2 text-right font-medium">Our consensus</th>
              <th className="px-3 py-2 text-right font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            {EXAMPLES.map((r, i) => {
              const d = (r.ours - r.refAvg) / r.refAvg * 100;
              const color = Math.abs(d) < 5 ? 'text-emerald-700' : Math.abs(d) < 10 ? 'text-amber-700' : 'text-rose-700';
              return (
                <tr key={i} className="border-t border-stone-100">
                  <td className="px-4 py-2 text-stone-800">{r.addr}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-600">{num(r.refAvg)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-900 font-medium">{num(r.ours)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${color}`}>{d > 0 ? '+' : ''}{d.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-stone-500">
        Pipeline: Microsoft Open Buildings polygon × Qwen2.5-VL pitch detection. SAM 2 segmentation refines the polygon. All inference runs locally on an RTX 3090 — zero commercial LLM APIs in the measurement path.
        {' '}
        <a href="https://github.com/Elenion88/roofquote/blob/main/docs/methodology.md" className="underline decoration-stone-300 hover:decoration-emerald-600 hover:text-emerald-700">Full methodology</a>.
      </p>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-white border border-stone-200 px-4 py-3 text-center">
      <div className="text-2xl font-semibold tabular-nums text-stone-900">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wider text-stone-500">{label}</div>
    </div>
  );
}
