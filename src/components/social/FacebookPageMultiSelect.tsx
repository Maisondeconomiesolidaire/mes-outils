import { Check } from "lucide-react";
import { InstagramIcon } from "../icons/InstagramIcon";
import { FacebookIcon } from "../icons/FacebookIcon";
import { cn } from "../../lib/cn";

export function FacebookPageMultiSelect({ pages, value, onChange, disabled = false, network = "facebook" }: {
  pages: { pageId: string; name: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  network?: "facebook" | "instagram";
}) {
  const allSelected = pages.length > 0 && pages.every((page) => value.includes(page.pageId));
  return (
    <div className="space-y-3" role="group" aria-label={network === "facebook" ? "Pages Facebook" : "Pages avec un compte Instagram"}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-[var(--muted-foreground)]">{value.length} Page{value.length > 1 ? "s" : ""} sélectionnée{value.length > 1 ? "s" : ""}</span>
        <button type="button" disabled={disabled} onClick={() => onChange(allSelected ? [] : pages.map((page) => page.pageId))} className="rounded px-2 py-1 font-semibold text-brand-700 hover:bg-[var(--accent)] focus-visible:outline-brand-500 disabled:opacity-50">
          {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
        </button>
      </div>
      <div className="grid max-h-72 gap-2 overflow-y-auto rounded-2xl border border-[var(--border)] p-2">
        {pages.map((page) => {
          const checked = value.includes(page.pageId);
          return <button key={page.pageId} type="button" role="checkbox" aria-checked={checked} disabled={disabled} onClick={() => onChange(checked ? value.filter((id) => id !== page.pageId) : [...value, page.pageId])} className={cn("flex items-center gap-3 rounded-xl border p-3 text-left transition focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60", checked ? "border-brand-500 bg-brand-500/5" : "border-transparent hover:bg-[var(--accent)]")}>
            {network === "facebook" ? <FacebookIcon className="h-5 w-5 shrink-0" /> : <InstagramIcon className="h-5 w-5 shrink-0" />}
            <span className="flex-1 text-sm font-medium">{page.name}</span>
            <span aria-hidden="true" className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", checked ? "border-brand-500 bg-brand-500 text-white" : "border-[var(--border)]")}>
              {checked && <Check className="h-3.5 w-3.5" />}
            </span>
          </button>;
        })}
      </div>
    </div>
  );
}
