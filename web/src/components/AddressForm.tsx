import { useState } from 'react';
import { Search, MapPin } from 'lucide-react';

const SAMPLE_ADDRESSES = [
  '6310 Laguna Bay Court, Houston, TX 77041',
  '3561 E 102nd Ct, Thornton, CO 80229',
  '1612 S Canton Ave, Springfield, MO 65802',
];

export function AddressForm({ onSubmit, pending }: { onSubmit: (addr: string) => void; pending: boolean }) {
  const [address, setAddress] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (address.trim()) onSubmit(address.trim());
      }}
      className="space-y-4"
    >
      <div className="relative">
        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-stone-400" />
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter a property address"
          disabled={pending}
          className="w-full rounded-2xl border border-stone-300 bg-white pl-12 pr-4 py-4 text-lg shadow-sm focus:border-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-300 disabled:opacity-50"
        />
      </div>
      <button
        type="submit"
        disabled={!address.trim() || pending}
        className="w-full rounded-2xl bg-stone-900 px-6 py-4 text-lg font-medium text-white shadow-sm hover:bg-stone-800 active:bg-stone-950 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {pending ? (
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            Analyzing aerial imagery and generating estimate...
          </span>
        ) : (
          <span className="inline-flex items-center gap-2"><Search className="h-5 w-5" /> Generate roof estimate</span>
        )}
      </button>
      {!pending && (
        <div className="text-sm text-stone-500 space-x-2">
          <span>Try a sample:</span>
          {SAMPLE_ADDRESSES.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAddress(a)}
              className="text-stone-700 underline decoration-stone-300 hover:decoration-stone-700"
            >
              {a.split(',')[1].trim()}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
