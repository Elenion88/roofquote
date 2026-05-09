import { useEffect, useRef, useState } from 'react';
import { Search, MapPin } from 'lucide-react';
import { fetchAutocomplete, type Suggestion } from '../lib/api';

const SAMPLE_ADDRESSES = [
  '6310 Laguna Bay Court, Houston, TX 77041',
  '1261 20th Street, Newport News, VA 23607',
  '14132 Trenton Ave, Orland Park, IL 60462',
];

export function AddressForm({ onSubmit, pending }: { onSubmit: (addr: string) => void; pending: boolean }) {
  const [address, setAddress] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSelectedRef = useRef<string | null>(null);

  // Debounced fetch
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!address || address.trim().length < 3 || pending) {
      setSuggestions([]);
      return;
    }
    if (lastSelectedRef.current === address) {
      // user just selected this; don't re-fetch
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      try {
        const s = await fetchAutocomplete(address);
        setSuggestions(s);
        setShowSuggestions(s.length > 0);
        setActiveIdx(-1);
      } catch {
        setSuggestions([]);
      }
    }, 220);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [address, pending]);

  // Click-outside closes suggestions
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function pick(s: Suggestion) {
    lastSelectedRef.current = s.text;
    setAddress(s.text);
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveIdx(-1);
    // Auto-submit on selection — feels like Google flight search
    onSubmit(s.text);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      pick(suggestions[activeIdx]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (address.trim()) onSubmit(address.trim());
      }}
      className="space-y-4"
    >
      <div ref={containerRef} className="relative">
        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-stone-400 pointer-events-none" />
        <input
          type="text"
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            lastSelectedRef.current = null;
          }}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          onKeyDown={onKeyDown}
          placeholder="Enter a property address"
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
          className="w-full rounded-2xl border border-stone-300 bg-white pl-12 pr-4 py-4 text-lg shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:opacity-50"
        />
        {showSuggestions && suggestions.length > 0 && (
          <ul
            role="listbox"
            className="absolute z-20 mt-1 w-full rounded-xl border border-stone-200 bg-white shadow-lg overflow-hidden"
          >
            {suggestions.map((s, i) => (
              <li
                key={s.placeId}
                role="option"
                aria-selected={i === activeIdx}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent input blur
                  pick(s);
                }}
                onMouseEnter={() => setActiveIdx(i)}
                className={`px-4 py-3 cursor-pointer flex items-start gap-3 ${
                  i === activeIdx ? 'bg-stone-100' : 'hover:bg-stone-50'
                }`}
              >
                <MapPin className="h-4 w-4 text-stone-400 mt-1 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-stone-900 font-medium truncate">{s.mainText}</div>
                  <div className="text-stone-500 text-sm truncate">{s.secondaryText}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="submit"
        disabled={!address.trim() || pending}
        className="w-full rounded-2xl bg-emerald-600 px-6 py-4 text-lg font-medium text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
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
              onClick={() => {
                lastSelectedRef.current = a;
                setAddress(a);
                onSubmit(a);
              }}
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
