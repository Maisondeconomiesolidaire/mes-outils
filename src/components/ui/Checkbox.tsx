import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Case à cocher stylée (carte cliquable) — pas la checkbox native du navigateur.
 * Cliquer n'importe où sur la carte bascule l'état.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border bg-[var(--input)] px-3.5 py-3 text-left shadow-sm transition",
        "focus:outline-none focus:ring-4 focus:ring-brand-500/10",
        checked
          ? "border-brand-500 bg-brand-500/5"
          : "border-[var(--border)] hover:border-brand-500/50",
        className,
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition",
          checked
            ? "border-brand-500 bg-brand-500 text-white"
            : "border-[var(--border)] bg-[var(--card)]",
        )}
      >
        <Check
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            checked ? "scale-100" : "scale-0",
          )}
          strokeWidth={3}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--foreground)]">
          {label}
        </span>
        {description ? (
          <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}
