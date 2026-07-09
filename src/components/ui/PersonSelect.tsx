import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, User } from "lucide-react";
import { cn } from "../../lib/cn";

export type Person = { clerkId: string; name: string; imageUrl?: string | null };

/** Sélection d'un collègue (annuaire), avec option « Moi-même ». */
export function PersonSelect({
  people,
  value,
  onChange,
  selfLabel = "Moi-même",
}: {
  people: Person[];
  /**
   * Personne sélectionnée (objet complet) — on l'affiche directement, sans la
   * rechercher dans `people`. La sélection reste donc stable même si l'annuaire
   * se recharge ou si un clerkId change (artefacts de migration Clerk dev/prod).
   */
  value: Person | null;
  onChange: (person: Person | null) => void;
  selfLabel?: string;
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

  const selected = value;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((person) => person.name.toLowerCase().includes(needle));
  }, [people, query]);

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
        <Avatar name={selected?.name ?? selfLabel} src={selected?.imageUrl} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--foreground)]">
          {selected?.name ?? selfLabel}
        </span>
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
                placeholder="Rechercher un collègue..."
                className="w-full bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
              />
            </label>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false); setQuery(""); }}
              className={cn("flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition", value === null ? "bg-[var(--selected)]" : "hover:bg-[var(--accent)]")}
            >
              <Avatar name={selfLabel} />
              <span className="flex-1 text-sm font-semibold text-[var(--foreground)]">{selfLabel}</span>
              {value === null ? <Check className="h-4 w-4 text-brand-600" /> : null}
            </button>
            {filtered.map((person) => {
              const isActive = person.clerkId === value?.clerkId;
              return (
                <button
                  key={person.clerkId}
                  type="button"
                  onClick={() => { onChange(person); setOpen(false); setQuery(""); }}
                  className={cn("flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition", isActive ? "bg-[var(--selected)]" : "hover:bg-[var(--accent)]")}
                >
                  <Avatar name={person.name} src={person.imageUrl} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--foreground)]">{person.name}</span>
                  {isActive ? <Check className="h-4 w-4 text-brand-600" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Avatar({ name, src }: { name: string; src?: string | null }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-600 text-xs font-semibold text-white">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : name.slice(0, 2).toUpperCase() || <User className="h-4 w-4" />}
    </span>
  );
}
