import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Button } from "./ui/Button";
import { cn } from "../lib/cn";

/** Champs d'un évènement saisis dans une liste déroulante. */
export type EventOptionField =
  | "animationType"
  | "structure"
  | "activity"
  | "targetAudience";

/**
 * Options livrées d'origine, identiques à celles du calendrier de la
 * Recyclerie : les deux calendriers se lisent côte à côte dans l'espace
 * partagé, ils décrivent donc les animations avec le même vocabulaire. Celles
 * ajoutées à la main vivent dans `recycappCalendarOptions` et complètent ces
 * listes des deux côtés.
 */
export const DEFAULT_EVENT_OPTIONS: Record<EventOptionField, string[]> = {
  animationType: [
    "Atelier réparation",
    "Atelier rencontre",
    "Formation",
    "Vente à thèmes",
  ],
  structure: [
    "Recyclerie",
    "Maison d'Economie Solidaire",
    "Alicias",
    "Pays de bray emploi",
    "Pays de bray service",
    "Les sens du bray",
    "Materiosol",
  ],
  activity: [
    "Repair Café",
    "Connect en Bray",
    "Formation",
    "Cycle en Bray",
    "Animations autres",
  ],
  targetAudience: ["Tout public", "Professionnels", "Particulier"],
};

export const EVENT_OPTION_LABELS: Array<[EventOptionField, string]> = [
  ["animationType", "Type d'animation"],
  ["structure", "Structure MES"],
  ["activity", "Activité"],
  ["targetAudience", "Public(s) ciblé(s)"],
];

/**
 * Liste déroulante d'un champ d'évènement, avec ajout d'option à la volée.
 *
 * « Nouvelle option » enregistre le libellé côté serveur : il est ensuite
 * proposé à toute l'équipe, ici comme dans Recycapp.
 */
export function EventOptionSelect({
  field,
  value,
  onChange,
  extraOptions,
  canCreateOption = true,
}: {
  field: EventOptionField;
  value: string;
  onChange: (value: string) => void;
  extraOptions: string[];
  canCreateOption?: boolean;
}) {
  const addOption = useMutation(api.community.addEventOption);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => {
    const seen = new Set<string>();
    const all: string[] = [];
    for (const label of [
      ...DEFAULT_EVENT_OPTIONS[field],
      ...extraOptions,
      // Une valeur déjà enregistrée reste proposée même si l'option a disparu.
      ...(value ? [value] : []),
    ]) {
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(label);
    }
    return all;
  }, [field, extraOptions, value]);

  useEffect(() => {
    if (!open) {
      setCreating(false);
      setDraft("");
    }
  }, [open]);

  async function create() {
    const label = draft.trim();
    if (!label) return;
    setSaving(true);
    try {
      await addOption({ field, label });
      onChange(label);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 text-left text-sm text-[var(--foreground)] transition-colors hover:border-brand-400",
          open && "border-brand-500 ring-2 ring-brand-500/20",
        )}
      >
        <span className={cn("min-w-0 truncate", !value && "text-[var(--muted-foreground)]")}>
          {value || "Sélectionner…"}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <>
          {/* Fermeture au clic extérieur, sans écouteur global : la carte est
              posée au-dessus d'une couche transparente qui prend le clic. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-xl">
            <div className="max-h-64 overflow-y-auto">
              {value ? (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="w-full rounded-xl px-3 py-2 text-left text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                >
                  Aucune valeur
                </button>
              ) : null}
              {options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]",
                    option === value && "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
                  )}
                >
                  <span className="truncate">{option}</span>
                  {option === value ? <Check className="h-4 w-4 shrink-0" /> : null}
                </button>
              ))}
            </div>

            {canCreateOption ? (
              <div className="mt-1 border-t border-[var(--border)] pt-1">
                {creating ? (
                  <div className="flex items-center gap-2 p-1">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void create();
                        }
                      }}
                      placeholder="Libellé de l'option"
                      className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 text-sm"
                    />
                    <Button size="sm" onClick={() => void create()} disabled={saving || !draft.trim()}>
                      Ajouter
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-brand-600 hover:bg-[var(--accent)]"
                  >
                    <Plus className="h-4 w-4" /> Nouvelle option
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
