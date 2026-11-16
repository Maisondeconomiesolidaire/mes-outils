import { useEffect, useMemo, useRef, useState } from "react";
import { useAction } from "convex/react";
import { Loader2, MapPin, Search, Store, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";

export type Destination = { label: string; address?: string; longitude: number; latitude: number };

type Suggestion = { id: string; name: string; address: string; kind: string; category?: string };

function newSessionToken() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * Champ « Où allez-vous ? » : recherche de lieux (« Starbucks », « Leroy Merlin
 * Beauvais »…) ET d'adresses, façon Google Maps. Les suggestions viennent de
 * Mapbox via Convex (le jeton ne quitte pas le serveur).
 */
export function PlaceSearch({
  value,
  onChange,
  placeholder = "Lieu ou adresse : Starbucks Beauvais, 12 rue…",
  autoFocus,
}: {
  value: Destination | null;
  onChange: (destination: Destination | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const search = useAction(api.navettes.searchPlaces);
  const retrieve = useAction(api.navettes.retrievePlace);
  const sessionToken = useMemo(newSessionToken, []);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      search({ q, sessionToken })
        .then((results) => {
          if (id !== requestId.current) return;
          setSuggestions(results);
          setActive(0);
          setError(null);
        })
        .catch((caught) => {
          if (id === requestId.current) setError(caught instanceof Error ? caught.message : "Recherche impossible.");
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, search, sessionToken]);

  async function pick(suggestion: Suggestion) {
    setOpen(false);
    setLoading(true);
    try {
      const place = await retrieve({ id: suggestion.id, sessionToken });
      onChange({ ...place, label: suggestion.name || place.label, address: suggestion.address || place.address });
      setQuery("");
      setSuggestions([]);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lieu introuvable.");
    } finally {
      setLoading(false);
    }
  }

  if (value) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--foreground)]">{value.label}</p>
          {value.address ? <p className="truncate text-xs text-[var(--muted-foreground)]">{value.address}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded-full p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          aria-label="Changer de destination"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          type="text"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-autocomplete="list"
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!suggestions.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, suggestions.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              void pick(suggestions[active]);
            }
          }}
          placeholder={placeholder}
          className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--card)] pl-9 pr-9 text-sm text-[var(--foreground)] outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        />
        {loading ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--muted-foreground)]" /> : null}
      </div>
      {open && suggestions.length > 0 ? (
        <ul role="listbox" className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] py-1 shadow-xl">
          {suggestions.map((s, index) => (
            <li key={s.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void pick(s)}
                onMouseEnter={() => setActive(index)}
                className={`flex w-full items-start gap-3 px-3 py-2 text-left ${index === active ? "bg-[var(--accent)]" : ""}`}
              >
                {s.kind === "poi" ? <Store className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> : <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[var(--foreground)]">{s.name}</span>
                  <span className="block truncate text-xs text-[var(--muted-foreground)]">{s.address}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
