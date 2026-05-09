import { num, usd } from '../lib/format';
import type { Estimate } from '../lib/types';

export function EstimateCard({ estimate }: { estimate: Estimate }) {
  const tableRow = (li: { description: string; quantity: number; unit: string; unitCost: number; totalCost: number }, i: number) => (
    <tr key={i} className="border-t border-stone-100">
      <td className="py-2.5 pr-4 text-stone-800">{li.description}</td>
      <td className="py-2.5 px-2 text-right tabular-nums text-stone-600 whitespace-nowrap">{num(li.quantity, li.unit === 'sq' ? 1 : 0)} <span className="text-stone-400">{li.unit}</span></td>
      <td className="py-2.5 px-2 text-right tabular-nums text-stone-600 whitespace-nowrap">{usd(li.unitCost, { fractionDigits: 2 })}</td>
      <td className="py-2.5 pl-2 text-right tabular-nums text-stone-900 font-medium whitespace-nowrap">{usd(li.totalCost, { fractionDigits: 2 })}</td>
    </tr>
  );

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <header className="flex items-baseline justify-between">
        <h3 className="text-lg font-medium text-stone-900">Estimate</h3>
        <span className="text-sm text-stone-500">Asphalt shingle full tear-off & install · {estimate.warrantyYears}-yr warranty</span>
      </header>

      <table className="mt-5 w-full text-sm">
        <thead>
          <tr className="text-stone-500 text-left text-xs uppercase tracking-wider">
            <th className="pb-2 pr-4 font-medium">Materials</th>
            <th className="pb-2 px-2 text-right font-medium">Qty</th>
            <th className="pb-2 px-2 text-right font-medium">Unit</th>
            <th className="pb-2 pl-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>{estimate.materials.map(tableRow)}</tbody>
      </table>

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="text-stone-500 text-left text-xs uppercase tracking-wider">
            <th className="pb-2 pr-4 font-medium">Labor & Overhead</th>
            <th className="pb-2 px-2 text-right font-medium">Qty</th>
            <th className="pb-2 px-2 text-right font-medium">Unit</th>
            <th className="pb-2 pl-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>{estimate.labor.map(tableRow)}</tbody>
      </table>

      <div className="mt-6 ml-auto max-w-xs space-y-1 text-sm tabular-nums">
        <div className="flex justify-between text-stone-700"><span>Subtotal</span><span>{usd(estimate.subtotal, { fractionDigits: 2 })}</span></div>
        <div className="flex justify-between text-stone-500"><span>Tax</span><span>{usd(estimate.tax, { fractionDigits: 2 })}</span></div>
        <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-semibold text-stone-900"><span>Total</span><span>{usd(estimate.total, { fractionDigits: 2 })}</span></div>
      </div>

      {estimate.notes.length > 0 && (
        <details className="mt-6 group" open>
          <summary className="cursor-pointer text-sm font-medium text-stone-700 hover:text-stone-900">
            Notes & assumptions ({estimate.notes.length})
          </summary>
          <ul className="mt-3 space-y-2 text-sm text-stone-600 list-disc pl-5">
            {estimate.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
