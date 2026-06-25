import { useEffect, useMemo, useRef, useState } from "react";
import { CarFront, Check, ChevronDown, Search } from "lucide-react";
import { cn } from "../../lib/cn";

export type VehicleOption = {
  _id: string;
  name: string;
  brand?: string;
  model?: string;
  plate?: string;
  photoUrl?: string | null;
};

/**
 * Sélecteur de véhicule par recherche : au focus, la liste complète s'affiche
 * (avec photos) ; on tape pour filtrer par marque / modèle / immatriculation.
 */
export function VehicleSearchSelect({
  vehicles,
  value,
  onChange,
  placeholder = "Rechercher un véhicule...",
}: {
  vehicles: VehicleOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const selected = vehicles.find((vehicle) => vehicle._id === value) ?? null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return vehicles;
    return vehicles.filter((vehicle) =>
      [vehicle.name, vehicle.brand, vehicle.model, vehicle.plate].filter(Boolean).join(" ").toLowerCase().includes(needle),
    );
  }, [vehicles, query]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-11 w-full items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 text-left transition",
          "hover:border-brand-400 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/15",
          open && "border-brand-500 ring-4 ring-brand-500/15",
        )}
      >
        {selected ? (
          <>
            <Thumb photoUrl={selected.photoUrl} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--foreground)]">
              {selected.name}
              {selected.plate ? <span className="text-[var(--muted-foreground)]"> · {selected.plate}</span> : null}
            </span>
          </>
        ) : (
          <span className="flex-1 text-sm text-[var(--muted-foreground)]">{placeholder}</span>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
      </button>

      {open ? (
        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-strong)]">
          <div className="border-b border-[var(--border)] p-2">
            <label className="flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3">
              <Search className="h-4 w-4 text-brand-600" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Marque, modèle, immatriculation..."
                className="w-full bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
              />
            </label>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-[var(--muted-foreground)]">Aucun véhicule trouvé.</p>
            ) : (
              filtered.map((vehicle) => {
                const isActive = vehicle._id === value;
                return (
                  <button
                    key={vehicle._id}
                    type="button"
                    onClick={() => {
                      onChange(vehicle._id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition",
                      isActive ? "bg-brand-50" : "hover:bg-[var(--accent)]",
                    )}
                  >
                    <Thumb photoUrl={vehicle.photoUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[var(--foreground)]">{vehicle.name}</span>
                      <span className="block truncate text-xs text-[var(--muted-foreground)]">
                        {[vehicle.brand, vehicle.model, vehicle.plate].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    {isActive ? <Check className="h-4 w-4 text-brand-600" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Thumb({ photoUrl }: { photoUrl?: string | null }) {
  return (
    <span className="flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--muted)]">
      {photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : <CarFront className="h-4 w-4 text-[var(--muted-foreground)]" />}
    </span>
  );
}
