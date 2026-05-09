import { useState } from 'react';

export default function App() {
  const [address, setAddress] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setResult(null);
    try {
      const r = await fetch('/api/health');
      const d = await r.json();
      setResult({ ping: d, address });
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="min-h-screen bg-stone-50 text-stone-900">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">RoofQuote</h1>
        <p className="mt-2 text-stone-600">
          Address in. Customer-ready estimate out. Ensemble of independent measurement methods.
        </p>

        <form onSubmit={submit} className="mt-10 flex gap-3">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St, Springfield, MO 65802"
            className="flex-1 rounded-md border border-stone-300 bg-white px-4 py-3 text-base shadow-sm focus:border-stone-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!address || pending}
            className="rounded-md bg-stone-900 px-5 py-3 text-white font-medium disabled:opacity-50"
          >
            {pending ? 'Estimating…' : 'Generate estimate'}
          </button>
        </form>

        {result && (
          <pre className="mt-8 rounded-md bg-stone-900 p-4 text-stone-100 text-sm overflow-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    </main>
  );
}
