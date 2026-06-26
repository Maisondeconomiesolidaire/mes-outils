import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

export type UnderlineTabItem<T extends string> = {
  key: T;
  label: string;
  icon?: LucideIcon;
};

/**
 * Onglets soulignés (même style que les sous-pages de recycapp) : barre
 * inférieure fine, onglet actif souligné en vert de marque.
 */
export function UnderlineTabs<T extends string>({
  items,
  value,
  onChange,
  counts,
  className,
  size = "md",
}: {
  items: UnderlineTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  counts?: Partial<Record<T, number>>;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cn("border-b border-[var(--border)]", className)}>
      <div className="flex flex-wrap items-end gap-6 overflow-x-auto">
        {items.map((item) => {
          const active = item.key === value;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap border-b-2 pb-3 font-semibold transition-colors",
                size === "sm" ? "text-sm" : "text-[15px]",
                active
                  ? "border-brand-500 text-[var(--foreground)]"
                  : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {Icon ? <Icon className="h-[18px] w-[18px]" /> : null}
              <span>{item.label}</span>
              {counts?.[item.key] !== undefined && (
                <span className="text-xs text-[var(--muted-foreground)]">{counts[item.key]}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
