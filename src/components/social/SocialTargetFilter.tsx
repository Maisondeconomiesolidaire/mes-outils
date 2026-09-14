import { Select } from "radix-ui";
import { Check, ChevronDown, Globe } from "lucide-react";
import { FacebookIcon } from "../icons/FacebookIcon";
import { InstagramIcon } from "../icons/InstagramIcon";

export type SocialTarget = { id: string; name: string; network: "facebook" | "instagram" };

/** Valeur réservée : aucune page filtrée. */
export const ALL_TARGETS = "all";

function TargetLabel({ target }: { target: SocialTarget | null }) {
  return <span className="flex min-w-0 items-center gap-2">
    {target === null ? <Globe className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
      : target.network === "facebook" ? <FacebookIcon className="h-4 w-4 shrink-0" />
      : <InstagramIcon className="h-4 w-4 shrink-0" />}
    <span className="truncate">{target?.name ?? "Toutes les pages"}</span>
  </span>;
}

/**
 * Filtre du calendrier et de l'historique par page Facebook ou compte
 * Instagram. Les pages viennent des publications elles-mêmes : une page
 * désactivée garde ainsi ses anciens posts consultables.
 */
export function SocialTargetFilter({ targets, value, onChange }: {
  targets: SocialTarget[];
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = targets.find(target => target.id === value) ?? null;
  return <Select.Root value={value} onValueChange={onChange}>
    <Select.Trigger
      aria-label="Filtrer par page"
      className="flex h-10 min-w-52 max-w-full items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-medium outline-none transition hover:bg-[var(--accent)] focus-visible:ring-2 focus-visible:ring-brand-500/35"
    >
      <Select.Value asChild><TargetLabel target={selected} /></Select.Value>
      <Select.Icon><ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content position="popper" sideOffset={6} collisionPadding={12} className="z-[80] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 text-[var(--foreground)] shadow-lg">
        <Select.Viewport className="max-h-72 overflow-y-auto">
          <Select.Item value={ALL_TARGETS} className="relative cursor-pointer rounded-lg py-2.5 pl-3 pr-9 text-sm outline-none data-[highlighted]:bg-[var(--accent)]">
            <Select.ItemText><TargetLabel target={null} /></Select.ItemText>
            <Select.ItemIndicator className="absolute right-3 top-3"><Check className="h-4 w-4" /></Select.ItemIndicator>
          </Select.Item>
          {targets.map(target => (
            <Select.Item key={target.id} value={target.id} className="relative cursor-pointer rounded-lg py-2.5 pl-3 pr-9 text-sm outline-none data-[highlighted]:bg-[var(--accent)]">
              <Select.ItemText><TargetLabel target={target} /></Select.ItemText>
              <Select.ItemIndicator className="absolute right-3 top-3"><Check className="h-4 w-4" /></Select.ItemIndicator>
            </Select.Item>
          ))}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}
